const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');

class AuthService {
  /**
   * Generates a cryptographically unguessable URL token
   */
  static generateToken(byteLength = 16) {
    return crypto.randomBytes(byteLength).toString('base64url');
  }

  /**
   * Generates a secure 6-digit numeric PIN
   */
  static generatePin() {
    // 100000 to 999999
    return crypto.randomInt(100000, 1000000).toString();
  }

  /**
   * Generates a memorable text passcode
   */
  static generatePasscode() {
    const adjectives = ['blue', 'swift', 'silent', 'amber', 'cosmic', 'bright', 'frost', 'shadow', 'golden', 'neon'];
    const nouns = ['tiger', 'river', 'falcon', 'nebula', 'shield', 'echo', 'summit', 'haven', 'spark', 'breeze'];
    const adj = adjectives[crypto.randomInt(0, adjectives.length)];
    const noun = nouns[crypto.randomInt(0, nouns.length)];
    const num = crypto.randomInt(10, 99);
    return `${adj}-${noun}-${num}`;
  }

  /**
   * Asynchronously hashes a secret (PIN or passcode) using bcrypt
   */
  static async hashSecret(secret) {
    if (!secret) return null;
    return bcrypt.hash(secret.toString(), 10);
  }

  /**
   * Synchronously hashes a secret
   */
  static hashSecretSync(secret) {
    if (!secret) return null;
    return bcrypt.hashSync(secret.toString(), 10);
  }

  /**
   * Verifies plain text secret against bcrypt hash
   */
  static async verifySecret(plain, hash) {
    if (!plain || !hash) return false;
    return bcrypt.compare(plain.toString(), hash);
  }

  /**
   * Computes a keyed HMAC-SHA256 blind lookup index.
   * Allows constant-time indexed DB lookups for PINs and passcodes without
   * exposing the raw secret, protected by server pepper.
   */
  static computeLookupHash(secret) {
    if (!secret) return null;
    return crypto
      .createHmac('sha256', config.APP_SECRET)
      .update(secret.toString().trim())
      .digest('hex');
  }
}

module.exports = AuthService;
