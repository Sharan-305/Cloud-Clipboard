const crypto = require('crypto');
const db = require('../db/database');
const AuthService = require('./authService');
const RateLimiter = require('./rateLimiter');
const config = require('../config');

class ShareService {
  /**
   * Create a new share record
   */
  static async createShare({
    title,
    contentText,
    pin,
    passcode,
    maxDownloads,
    expiryMinutes = 1440, // 24 hours default
    baseUrl = null
  }) {
    const shareId = crypto.randomUUID();
    const token = AuthService.generateToken(18);
    const now = Date.now();

    // Calculate expiry timestamp
    const parsedExpiry = parseInt(expiryMinutes, 10);
    const validExpiryMinutes = (!isNaN(parsedExpiry) && parsedExpiry > 0) ? parsedExpiry : 1440;
    const expiresAt = now + (validExpiryMinutes * 60 * 1000);

    // Parse max downloads
    let validMaxDownloads = null;
    if (maxDownloads !== undefined && maxDownloads !== null && maxDownloads !== '') {
      const parsed = parseInt(maxDownloads, 10);
      if (!isNaN(parsed) && parsed > 0) {
        validMaxDownloads = parsed;
      }
    }

    // Hash PIN & Passcode with bcrypt and compute lookup hashes
    let pinHash = null;
    let pinLookupHash = null;
    let hasPin = 0;
    if (pin && pin.toString().trim().length > 0) {
      const cleanPin = pin.toString().trim();
      pinHash = await AuthService.hashSecret(cleanPin);
      pinLookupHash = AuthService.computeLookupHash(cleanPin);
      hasPin = 1;
    }

    let passcodeHash = null;
    let passcodeLookupHash = null;
    let hasPasscode = 0;
    if (passcode && passcode.toString().trim().length > 0) {
      const cleanPasscode = passcode.toString().trim();
      passcodeHash = await AuthService.hashSecret(cleanPasscode);
      passcodeLookupHash = AuthService.computeLookupHash(cleanPasscode);
      hasPasscode = 1;
    }

    const stmt = db.prepare(`
      INSERT INTO shares (
        id, token, title, content_text,
        pin_hash, pin_lookup_hash,
        passcode_hash, passcode_lookup_hash,
        has_pin, has_passcode,
        max_downloads, download_count,
        expires_at, is_expired, created_at
      ) VALUES (
        @id, @token, @title, @content_text,
        @pin_hash, @pin_lookup_hash,
        @passcode_hash, @passcode_lookup_hash,
        @has_pin, @has_passcode,
        @max_downloads, 0,
        @expires_at, 0, @created_at
      )
    `);

    stmt.run({
      id: shareId,
      token,
      title: title ? title.trim() : null,
      content_text: contentText || null,
      pin_hash: pinHash,
      pin_lookup_hash: pinLookupHash,
      passcode_hash: passcodeHash,
      passcode_lookup_hash: passcodeLookupHash,
      has_pin: hasPin,
      has_passcode: hasPasscode,
      max_downloads: validMaxDownloads,
      expires_at: expiresAt,
      created_at: now
    });

    return {
      id: shareId,
      token,
      shareUrl: `${baseUrl || config.BASE_URL}/s/${token}`,
      pin: pin || null,
      passcode: passcode || null,
      hasPin: hasPin === 1,
      hasPasscode: hasPasscode === 1,
      maxDownloads: validMaxDownloads,
      expiresAt
    };
  }

  /**
   * Retrieve share by token with expiry and access limit verification
   */
  static getShareByToken(token, { verifyPasscode = null, checkOnly = false } = {}) {
    const row = db.prepare('SELECT * FROM shares WHERE token = ?').get(token);
    if (!row) {
      return null;
    }

    const now = Date.now();

    // Check expiry
    if (row.is_expired || now > row.expires_at) {
      if (!row.is_expired) {
        db.prepare('UPDATE shares SET is_expired = 1 WHERE id = ?').run(row.id);
      }
      const err = new Error('This shared item has expired');
      err.status = 410;
      throw err;
    }

    // Check download count limit
    if (row.max_downloads !== null && row.download_count >= row.max_downloads) {
      if (!row.is_expired) {
        db.prepare('UPDATE shares SET is_expired = 1 WHERE id = ?').run(row.id);
      }
      const err = new Error('Download limit for this item has been reached');
      err.status = 410;
      throw err;
    }

    // Check passcode protection
    const isLocked = row.has_passcode === 1;
    let unlocked = false;

    if (isLocked && verifyPasscode) {
      const match = AuthService.verifySecret(verifyPasscode, row.passcode_hash);
      if (!match) {
        const err = new Error('Invalid passcode');
        err.status = 401;
        throw err;
      }
      unlocked = true;
    }

    // Fetch attached files
    const files = db.prepare(`
      SELECT id, original_name, file_size, mime_type, checksum_sha256, created_at
      FROM files WHERE share_id = ?
    `).all(row.id);

    return {
      id: row.id,
      token: row.token,
      title: row.title,
      // If locked and not unlocked, hide content_text
      contentText: (isLocked && !unlocked) ? null : row.content_text,
      hasPin: row.has_pin === 1,
      hasPasscode: row.has_passcode === 1,
      isLocked: isLocked && !unlocked,
      maxDownloads: row.max_downloads,
      downloadCount: row.download_count,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      files
    };
  }

  /**
   * Retrieve share using PIN with brute-force rate limit protection
   */
  static async getShareByPin(pin, ip) {
    const rateLimitKey = `pin:${ip}`;
    const rateStatus = RateLimiter.checkRateLimit(rateLimitKey);

    if (!rateStatus.allowed) {
      const err = new Error(`Too many PIN attempts. Locked out for ${rateStatus.retryAfterSeconds} seconds.`);
      err.status = 429;
      err.retryAfter = rateStatus.retryAfterSeconds;
      throw err;
    }

    const cleanPin = pin.toString().trim();
    const lookupHash = AuthService.computeLookupHash(cleanPin);

    // Find active shares matching PIN lookup hash
    const rows = db.prepare(`
      SELECT * FROM shares
      WHERE pin_lookup_hash = ? AND is_expired = 0 AND expires_at > ?
    `).all(lookupHash, Date.now());

    let matchedShare = null;
    for (const row of rows) {
      const matches = await AuthService.verifySecret(cleanPin, row.pin_hash);
      if (matches) {
        matchedShare = row;
        break;
      }
    }

    if (!matchedShare) {
      const failStatus = RateLimiter.recordFailure(rateLimitKey);
      this.logAccess(null, ip, 'pin', 'failed_auth');
      
      let message = 'Invalid PIN.';
      if (failStatus.locked) {
        message = `Incorrect PIN. Max attempts reached. Locked for ${failStatus.lockoutSeconds} seconds.`;
      } else {
        message = `Incorrect PIN. ${failStatus.remainingAttempts} attempts remaining.`;
      }
      
      const err = new Error(message);
      err.status = failStatus.locked ? 429 : 401;
      if (failStatus.locked) {
        err.retryAfter = failStatus.lockoutSeconds;
      }
      throw err;
    }

    // Check download limits
    if (matchedShare.max_downloads !== null && matchedShare.download_count >= matchedShare.max_downloads) {
      db.prepare('UPDATE shares SET is_expired = 1 WHERE id = ?').run(matchedShare.id);
      const err = new Error('This share has reached its download limit');
      err.status = 410;
      throw err;
    }

    // Reset rate limiter on success
    RateLimiter.reset(rateLimitKey);
    this.logAccess(matchedShare.id, ip, 'pin', 'success');

    // Fetch attached files
    const files = db.prepare(`
      SELECT id, original_name, file_size, mime_type, checksum_sha256, created_at
      FROM files WHERE share_id = ?
    `).all(matchedShare.id);

    return {
      id: matchedShare.id,
      token: matchedShare.token,
      title: matchedShare.title,
      contentText: matchedShare.content_text,
      hasPin: true,
      hasPasscode: matchedShare.has_passcode === 1,
      isLocked: false,
      maxDownloads: matchedShare.max_downloads,
      downloadCount: matchedShare.download_count,
      expiresAt: matchedShare.expires_at,
      createdAt: matchedShare.created_at,
      files
    };
  }

  /**
   * Retrieve share using text passcode directly
   */
  static async getShareByPasscode(passcode, ip) {
    const rateLimitKey = `passcode:${ip}`;
    const rateStatus = RateLimiter.checkRateLimit(rateLimitKey);

    if (!rateStatus.allowed) {
      const err = new Error(`Too many failed attempts. Locked out for ${rateStatus.retryAfterSeconds} seconds.`);
      err.status = 429;
      err.retryAfter = rateStatus.retryAfterSeconds;
      throw err;
    }

    const cleanPasscode = passcode.toString().trim();
    const lookupHash = AuthService.computeLookupHash(cleanPasscode);

    const rows = db.prepare(`
      SELECT * FROM shares
      WHERE passcode_lookup_hash = ? AND is_expired = 0 AND expires_at > ?
    `).all(lookupHash, Date.now());

    let matchedShare = null;
    for (const row of rows) {
      const matches = await AuthService.verifySecret(cleanPasscode, row.passcode_hash);
      if (matches) {
        matchedShare = row;
        break;
      }
    }

    if (!matchedShare) {
      const failStatus = RateLimiter.recordFailure(rateLimitKey);
      this.logAccess(null, ip, 'passcode', 'failed_auth');

      let message = 'Invalid passcode.';
      if (failStatus.locked) {
        message = `Incorrect passcode. Max attempts reached. Locked for ${failStatus.lockoutSeconds} seconds.`;
      } else {
        message = `Incorrect passcode. ${failStatus.remainingAttempts} attempts remaining.`;
      }

      const err = new Error(message);
      err.status = failStatus.locked ? 429 : 401;
      if (failStatus.locked) {
        err.retryAfter = failStatus.lockoutSeconds;
      }
      throw err;
    }

    if (matchedShare.max_downloads !== null && matchedShare.download_count >= matchedShare.max_downloads) {
      db.prepare('UPDATE shares SET is_expired = 1 WHERE id = ?').run(matchedShare.id);
      const err = new Error('This share has reached its download limit');
      err.status = 410;
      throw err;
    }

    RateLimiter.reset(rateLimitKey);
    this.logAccess(matchedShare.id, ip, 'passcode', 'success');

    const files = db.prepare(`
      SELECT id, original_name, file_size, mime_type, checksum_sha256, created_at
      FROM files WHERE share_id = ?
    `).all(matchedShare.id);

    return {
      id: matchedShare.id,
      token: matchedShare.token,
      title: matchedShare.title,
      contentText: matchedShare.content_text,
      hasPin: matchedShare.has_pin === 1,
      hasPasscode: true,
      isLocked: false,
      maxDownloads: matchedShare.max_downloads,
      downloadCount: matchedShare.download_count,
      expiresAt: matchedShare.expires_at,
      createdAt: matchedShare.created_at,
      files
    };
  }

  /**
   * Increment download counter and automatically expire if limit hit
   */
  static incrementDownloadCount(shareId) {
    db.prepare('UPDATE shares SET download_count = download_count + 1 WHERE id = ?').run(shareId);
    
    // Check if limit reached
    const row = db.prepare('SELECT download_count, max_downloads FROM shares WHERE id = ?').get(shareId);
    if (row && row.max_downloads !== null && row.download_count >= row.max_downloads) {
      db.prepare('UPDATE shares SET is_expired = 1 WHERE id = ?').run(shareId);
    }
  }

  /**
   * Log access attempt
   */
  static logAccess(shareId, ip, method, status) {
    try {
      db.prepare(`
        INSERT INTO access_logs (share_id, ip_address, access_method, status, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(shareId, ip, method, status, Date.now());
    } catch (e) {
      // Don't fail the request if logging fails
      console.error('Error recording access log:', e.message);
    }
  }
}

module.exports = ShareService;
