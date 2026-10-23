const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const config = require('../config');
const RateLimiter = require('./rateLimiter');

class CleanupService {
  /**
   * Run full cleanup sweep
   */
  static runCleanup() {
    const now = Date.now();

    // 1. Mark and clean expired shares
    try {
      const expiredShares = db.prepare(`
        SELECT id FROM shares
        WHERE (expires_at < ? OR (max_downloads IS NOT NULL AND download_count >= max_downloads))
      `).all(now);

      for (const share of expiredShares) {
        // Mark as expired
        db.prepare('UPDATE shares SET is_expired = 1 WHERE id = ?').run(share.id);

        // Delete physical files
        const shareDir = path.join(config.UPLOADS_DIR, share.id);
        if (fs.existsSync(shareDir)) {
          fs.rmSync(shareDir, { recursive: true, force: true });
        }
      }
    } catch (err) {
      console.error('Error during expired share cleanup:', err.message);
    }

    // 2. Clean abandoned chunk directories
    try {
      if (fs.existsSync(config.TEMP_CHUNKS_DIR)) {
        const uploadDirs = fs.readdirSync(config.TEMP_CHUNKS_DIR);
        for (const dirName of uploadDirs) {
          const dirPath = path.join(config.TEMP_CHUNKS_DIR, dirName);
          const metaPath = path.join(dirPath, 'metadata.json');

          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
              if (now - meta.createdAt > config.TEMP_CHUNK_TTL_MS) {
                fs.rmSync(dirPath, { recursive: true, force: true });
              }
            } catch {
              // If metadata invalid, check dir mtime
              const stats = fs.statSync(dirPath);
              if (now - stats.mtimeMs > config.TEMP_CHUNK_TTL_MS) {
                fs.rmSync(dirPath, { recursive: true, force: true });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Error during temp chunk cleanup:', err.message);
    }

    // 3. Clean stale rate limits
    try {
      RateLimiter.cleanup();
    } catch (err) {
      console.error('Error cleaning rate limits:', err.message);
    }
  }

  /**
   * Start recurring background worker
   */
  static startScheduler() {
    // Run immediately on boot
    this.runCleanup();
    // Schedule periodic sweeps
    setInterval(() => {
      this.runCleanup();
    }, config.CLEANUP_INTERVAL_MS);
  }
}

module.exports = CleanupService;
