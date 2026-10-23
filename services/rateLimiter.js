const db = require('../db/database');
const config = require('../config');

class RateLimiter {
  /**
   * Check if an action key (e.g., ip:pin_entry or ip:passcode) is currently rate limited
   */
  static checkRateLimit(key) {
    const now = Date.now();
    const row = db.prepare('SELECT attempts, first_attempt_at, locked_until FROM rate_limits WHERE key = ?').get(key);

    if (!row) {
      return { allowed: true, remainingAttempts: config.RATE_LIMIT.MAX_ATTEMPTS, retryAfterSeconds: 0 };
    }

    // If currently locked
    if (row.locked_until && row.locked_until > now) {
      const retryAfterSeconds = Math.ceil((row.locked_until - now) / 1000);
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds
      };
    }

    // If window expired, reset attempts
    if (now - row.first_attempt_at > config.RATE_LIMIT.WINDOW_MS) {
      db.prepare('DELETE FROM rate_limits WHERE key = ?').run(key);
      return { allowed: true, remainingAttempts: config.RATE_LIMIT.MAX_ATTEMPTS, retryAfterSeconds: 0 };
    }

    const remaining = Math.max(0, config.RATE_LIMIT.MAX_ATTEMPTS - row.attempts);
    return {
      allowed: remaining > 0,
      remainingAttempts: remaining,
      retryAfterSeconds: 0
    };
  }

  /**
   * Record a failed attempt. Locks if threshold is reached.
   */
  static recordFailure(key) {
    const now = Date.now();
    const row = db.prepare('SELECT attempts, first_attempt_at FROM rate_limits WHERE key = ?').get(key);

    if (!row) {
      db.prepare('INSERT INTO rate_limits (key, attempts, first_attempt_at, locked_until) VALUES (?, 1, ?, 0)').run(key, now);
      return { remainingAttempts: config.RATE_LIMIT.MAX_ATTEMPTS - 1, locked: false };
    }

    // If window expired, restart counter
    if (now - row.first_attempt_at > config.RATE_LIMIT.WINDOW_MS) {
      db.prepare('UPDATE rate_limits SET attempts = 1, first_attempt_at = ?, locked_until = 0 WHERE key = ?').run(now, key);
      return { remainingAttempts: config.RATE_LIMIT.MAX_ATTEMPTS - 1, locked: false };
    }

    const newAttempts = row.attempts + 1;
    let lockedUntil = 0;
    let isLocked = false;

    if (newAttempts >= config.RATE_LIMIT.MAX_ATTEMPTS) {
      lockedUntil = now + config.RATE_LIMIT.LOCKOUT_MS;
      isLocked = true;
    }

    db.prepare('UPDATE rate_limits SET attempts = ?, locked_until = ? WHERE key = ?').run(newAttempts, lockedUntil, key);
    return {
      remainingAttempts: Math.max(0, config.RATE_LIMIT.MAX_ATTEMPTS - newAttempts),
      locked: isLocked,
      lockoutSeconds: Math.ceil(config.RATE_LIMIT.LOCKOUT_MS / 1000)
    };
  }

  /**
   * Reset rate limit after successful authentication
   */
  static reset(key) {
    db.prepare('DELETE FROM rate_limits WHERE key = ?').run(key);
  }

  /**
   * Clean up expired rate limits
   */
  static cleanup() {
    const cutoff = Date.now() - (config.RATE_LIMIT.WINDOW_MS + config.RATE_LIMIT.LOCKOUT_MS);
    db.prepare('DELETE FROM rate_limits WHERE first_attempt_at < ? AND locked_until < ?').run(cutoff, Date.now());
  }
}

module.exports = RateLimiter;
