const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
  
  // Security secret used for HMAC blind index lookups
  APP_SECRET: process.env.APP_SECRET || 'clip-platform-secret-salt-key-2026',
  
  // Storage paths
  STORAGE_DIR: path.join(__dirname, 'storage'),
  UPLOADS_DIR: path.join(__dirname, 'storage', 'uploads'),
  TEMP_CHUNKS_DIR: path.join(__dirname, 'storage', 'temp_chunks'),
  DB_PATH: path.join(__dirname, 'storage', 'clipboard.db'),
  
  // Limits
  MAX_FILE_SIZE_BYTES: 500 * 1024 * 1024, // 500 MB hard limit
  DEFAULT_CHUNK_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB chunks
  
  // Rate limiting for PIN & passcode brute-force protection
  RATE_LIMIT: {
    MAX_ATTEMPTS: 5,               // Max failed attempts before lockout
    WINDOW_MS: 10 * 60 * 1000,     // 10 minutes window
    LOCKOUT_MS: 15 * 60 * 1000,    // 15 minutes lockout
  },
  
  // Cleanup intervals
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // Check for expired items every 5 minutes
  TEMP_CHUNK_TTL_MS: 12 * 60 * 60 * 1000 // Remove abandoned chunks after 12 hours
};
