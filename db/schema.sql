-- Relational Schema for Cloud Clipboard Platform

CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  title TEXT,
  content_text TEXT,
  pin_hash TEXT,
  pin_lookup_hash TEXT,
  passcode_hash TEXT,
  passcode_lookup_hash TEXT,
  has_pin INTEGER NOT NULL DEFAULT 0,
  has_passcode INTEGER NOT NULL DEFAULT 0,
  max_downloads INTEGER DEFAULT NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  is_expired INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  checksum_sha256 TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id TEXT,
  ip_address TEXT NOT NULL,
  access_method TEXT NOT NULL, -- 'url', 'pin', 'passcode', 'qr'
  status TEXT NOT NULL,        -- 'success', 'failed_auth', 'expired', 'limit_reached', 'rate_limited'
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 1,
  first_attempt_at INTEGER NOT NULL,
  locked_until INTEGER DEFAULT 0
);

-- Performance & Lookup Indexes
CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
CREATE INDEX IF NOT EXISTS idx_shares_pin_lookup ON shares(pin_lookup_hash);
CREATE INDEX IF NOT EXISTS idx_shares_passcode_lookup ON shares(passcode_lookup_hash);
CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON shares(expires_at, is_expired);
CREATE INDEX IF NOT EXISTS idx_files_share_id ON files(share_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_ip ON access_logs(ip_address, created_at);
