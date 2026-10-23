# Cloud Clipboard & File Share Platform

A fast, lightweight, and resilient mini cloud clipboard platform for sharing text snippets and large files across devices. Built with **vanilla JavaScript, HTML5, CSS3, Node.js, Express**, and a relational **SQLite** schema.

Supports files up to **500 MB** with chunked/resumable uploads and downloads, with four unified sharing methods: **Numeric PIN**, **Text Passcode**, **QR Code**, and **Direct URL Link**.

---

## Key Features

- **500 MB File Uploads & Downloads**: Enforces the 500 MB ceiling both client-side and server-side.
- **Chunked & Resumable Uploads**: Splits files into 5 MB chunks with network retry, pause/resume, and real-time speed/ETA gauges. Dropped connections resume without re-uploading completed chunks.
- **Resumable HTTP Range Streaming Downloads**: Full support for `HTTP 206 Partial Content` and `Range: bytes=start-end` headers for large file transfer stability.
- **Four Unified Sharing Methods**:
  1. **6-Digit PIN**: Short numeric code with brute-force rate-limiting and blind indexed lookup.
  2. **Text Passcode**: Custom or generated mnemonic passcode with bcrypt hashing.
  3. **QR Code**: Instant phone camera scanning, renderable client-side offline or streamed via server.
  4. **Direct URL**: Unguessable 24-character cryptographically secure token link (`/s/<token>`).
- **Flexible Expiration & Access Limits**:
  - Expiry durations: 10 minutes, 1 hour, 6 hours, 24 hours, 3 days, 7 days.
  - Download limits: 1 download (Burn After Reading / self-destruct), 3, 5, 10, or unlimited.
  - Background worker sweeps and cleans expired files from disk every 5 minutes.
- **Zero Frontend Frameworks**: 100% plain HTML5, modern CSS, and vanilla JavaScript.
- **Relational Storage**: SQLite with WAL (Write-Ahead Logging) mode, foreign key enforcement, and indexes.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Client Browser                                  │
│  ┌───────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │   uploader.js (5MB)   │  │   access.js / PIN    │  │    qr.js (Pure)  │  │
│  │  Chunk Slicing Engine │  │   Passcode & URL     │  │  Canvas QR Code  │  │
│  └───────────┬───────────┘  └──────────┬───────────┘  └─────────┬────────┘  │
└──────────────┼─────────────────────────┼────────────────────────┼───────────┘
               │ HTTP Stream             │ REST API               │
               ▼                         ▼                        │
┌─────────────────────────────────────────────────────────────────┼───────────┐
│                       Express 5 Server (Node.js)                │           │
│  ┌───────────────────┐  ┌───────────────────┐  ┌────────────────┼────────┐  │
│  │   uploadRoutes    │  │    shareRoutes    │  │  accessRoutes  │        │  │
│  │ /api/upload/*     │  │   /api/shares/*   │  │ /api/access/*  │        │  │
│  └─────────┬─────────┘  └─────────┬─────────┘  └────────┬───────┴────────┘  │
│            ▼                      ▼                     ▼                   │
│  ┌───────────────────┐  ┌───────────────────┐  ┌─────────────────────────┐  │
│  │   UploadService   │  │   ShareService    │  │       AuthService       │  │
│  │ Stream Pipe & SHA │  │ Expiry & Download │  │ Bcrypt + HMAC Lookup    │  │
│  └─────────┬─────────┘  └─────────┬─────────┘  └────────┬────────────────┘  │
│            │                      │                     │                   │
│            │                      ▼                     │                   │
│            │            ┌───────────────────┐           │                   │
│            │            │    RateLimiter    │◄──────────┘                   │
│            │            │ 5 Fail / 10m Lock │                               │
│            │            └─────────┬─────────┘                               │
│            ▼                      ▼                                         │
│   ┌─────────────────┐   ┌────────────────────────────────────────────────┐  │
│   │ File System FS  │   │          SQLite Relational Database            │  │
│   │ uploads/<share> │   │ shares | files | access_logs | rate_limits     │  │
│   │ temp_chunks/    │   │ WAL Mode + Foreign Keys                        │  │
│   └─────────────────┘   └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

Database engine: **SQLite3** with WAL mode enabled. Stored in `storage/clipboard.db`.

### 1. `shares` Table
Stores share records, access credentials, and expiration metadata.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Unique UUID identifier |
| `token` | TEXT | UNIQUE NOT NULL | 24-character unguessable URL token |
| `title` | TEXT | NULLABLE | Optional human-readable title |
| `content_text` | TEXT | NULLABLE | Raw clipboard / code snippet |
| `pin_hash` | TEXT | NULLABLE | Bcrypt hash of 6-digit numeric PIN |
| `pin_lookup_hash` | TEXT | NULLABLE | HMAC-SHA256 blind index for constant-time lookup |
| `passcode_hash` | TEXT | NULLABLE | Bcrypt hash of text passcode |
| `passcode_lookup_hash` | TEXT | NULLABLE | HMAC-SHA256 blind index for passcode lookup |
| `has_pin` | INTEGER | NOT NULL DEFAULT 0 | Flag indicating PIN protection |
| `has_passcode` | INTEGER | NOT NULL DEFAULT 0 | Flag indicating passcode protection |
| `max_downloads` | INTEGER | NULLABLE | Max download limit (NULL = unlimited) |
| `download_count` | INTEGER | NOT NULL DEFAULT 0 | Current number of downloads/accesses |
| `expires_at` | INTEGER | NOT NULL | Unix epoch timestamp (ms) of expiration |
| `is_expired` | INTEGER | NOT NULL DEFAULT 0 | 1 if expired or limit exhausted |
| `created_at` | INTEGER | NOT NULL | Creation timestamp (ms) |

### 2. `files` Table
Stores binary file metadata linked to parent shares.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Unique UUID identifier |
| `share_id` | TEXT | NOT NULL REFERENCES shares(id) ON DELETE CASCADE | Parent share foreign key |
| `original_name` | TEXT | NOT NULL | Sanitized user file name |
| `file_size` | INTEGER | NOT NULL | Size in bytes (max 524,288,000) |
| `mime_type` | TEXT | NOT NULL | MIME content type |
| `storage_path` | TEXT | NOT NULL | Relative disk storage path |
| `checksum_sha256` | TEXT | NULLABLE | SHA-256 integrity checksum |
| `created_at` | INTEGER | NOT NULL | Timestamp when assembled |

### 3. `access_logs` Table
Audit log tracking IP addresses, methods, and auth success/failure.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Sequential record ID |
| `share_id` | TEXT | Associated share ID |
| `ip_address` | TEXT | Client IP address |
| `access_method` | TEXT | 'url', 'pin', 'passcode', or 'qr' |
| `status` | TEXT | 'success', 'failed_auth', 'expired', 'limit_reached' |
| `created_at` | INTEGER | Timestamp |

### 4. `rate_limits` Table
Enforces sliding window lockout for brute-force prevention.

| Column | Type | Description |
|---|---|---|
| `key` | TEXT PRIMARY KEY | Target key (e.g. `pin:127.0.0.1`) |
| `attempts` | INTEGER | Number of failed attempts within window |
| `first_attempt_at` | INTEGER | Window start timestamp |
| `locked_until` | INTEGER | Lockout expiry timestamp (0 if not locked) |

---

## REST API Specification

### 1. Shares API

#### `POST /api/shares`
Create a new share item.

- **Request Body:**
  ```json
  {
    "title": "Project Notes",
    "contentText": "Clipboard contents here...",
    "pin": "492018",
    "passcode": "swift-falcon-42",
    "maxDownloads": 3,
    "expiryMinutes": 1440
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "share": {
      "id": "7bf3b0ee-7ba7-4221-a1e4-4d8b964f5012",
      "token": "cgivDILX6oml70eftaSVExWL",
      "shareUrl": "http://localhost:3000/s/cgivDILX6oml70eftaSVExWL",
      "pin": "492018",
      "passcode": "swift-falcon-42",
      "hasPin": true,
      "hasPasscode": true,
      "maxDownloads": 3,
      "expiresAt": 1729712000000
    }
  }
  ```

#### `GET /api/shares/:token`
Fetch share metadata. If passcode-protected and no matching passcode header is provided, `contentText` is omitted and `isLocked: true` is returned.

- **Optional Header:** `X-Share-Passcode: <passcode>` or query param `?passcode=<passcode>`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "share": {
      "id": "7bf3b0ee-...",
      "token": "cgivDILX6oml...",
      "title": "Project Notes",
      "contentText": "Clipboard contents here...",
      "hasPin": true,
      "hasPasscode": true,
      "isLocked": false,
      "maxDownloads": 3,
      "downloadCount": 0,
      "expiresAt": 1729712000000,
      "files": [
        {
          "id": "22351c2b-...",
          "original_name": "dataset.zip",
          "file_size": 42000000,
          "mime_type": "application/zip",
          "checksum_sha256": "56948574..."
        }
      ]
    }
  }
  ```

#### `POST /api/shares/:token/unlock`
Verify passcode and unlock protected content.

- **Request Body:** `{ "passcode": "swift-falcon-42" }`
- **Response (200 OK):** Returns full unlocked share object.

---

### 2. Chunked & Resumable Upload API

#### `POST /api/upload/init`
Initiates a chunked upload session and validates the 500 MB limit.

- **Request Body:**
  ```json
  {
    "shareId": "7bf3b0ee-...",
    "fileName": "large_video.mp4",
    "fileSize": 419430400,
    "mimeType": "video/mp4",
    "totalChunks": 80
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "session": {
      "uploadId": "0150f1c2-094f-4ece-a962-a7e8c36bd76f",
      "chunkSize": 5242880,
      "totalChunks": 80,
      "maxFileSizeBytes": 524288000
    }
  }
  ```

#### `POST /api/upload/chunk`
Transfers a raw 5 MB binary chunk directly piped to staging storage.

- **Headers:**
  - `x-upload-id: 0150f1c2-...`
  - `x-chunk-index: 0`
  - `x-total-chunks: 80`
  - `Content-Type: application/octet-stream`
- **Body:** Binary slice bytes.
- **Response (200 OK):** `{ "success": true, "result": { "chunkIndex": 0, "success": true } }`

#### `GET /api/upload/status/:uploadId`
Queries chunk status for network resumption.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "status": {
      "uploadId": "0150f1c2-...",
      "uploadedChunks": [0, 1, 2, 3],
      "totalChunks": 80,
      "fileSize": 419430400,
      "fileName": "large_video.mp4"
    }
  }
  ```

#### `POST /api/upload/complete`
Merges chunks in sequence, validates checksum and size, saves file record, and cleans staging chunks.

- **Request Body:** `{ "uploadId": "0150f1c2-..." }`
- **Response (200 OK):** `{ "success": true, "file": { "id": "...", "checksum_sha256": "..." } }`

---

### 3. Quick Access & Download API

#### `POST /api/access/pin`
Retrieve share via 6-digit numeric PIN.
- **Request Body:** `{ "pin": "492018" }`
- **Response (200 OK):** Unlocked share object.
- **Response (429 Too Many Requests):** `{ "success": false, "error": "...", "retryAfter": 900 }`

#### `POST /api/access/passcode`
Retrieve share via text passcode.
- **Request Body:** `{ "passcode": "swift-falcon-42" }`
- **Response (200 OK):** Unlocked share object.

#### `GET /api/access/qr?text=<URL_or_PIN>&format=png`
Returns a generated QR code (PNG image or JSON data URL).

#### `GET /api/shares/:token/files/:fileId/download`
Streams file download with **HTTP 206 Partial Content** and `Range` support.
- Increments download counter on start (`start === 0`).
- When `download_count >= max_downloads`, subsequent requests return **HTTP 410 Gone**.

---

## Security Architecture

1. **Bcrypt Hashing**:
   - PINs and Passcodes are never stored in plain text.
   - Hashed using bcrypt with 10 salt rounds (`bcryptjs`).
2. **Keyed HMAC-SHA256 Blind Index**:
   - To look up active shares by 6-digit PIN in $O(1)$ without storing plaintext or performing linear table scans, we store `HMAC-SHA256(pin, APP_SECRET)` as `pin_lookup_hash`.
   - Even if the SQLite file is leaked, the secret salt pepper lives outside the database, preventing offline rainbow table brute-forcing of short numeric PINs.
3. **Brute-Force Rate Limiting**:
   - Tracks failed attempts by IP and action key.
   - Max 5 failed attempts per 10-minute window.
   - On 5th failure, triggers a 15-minute hard lockout (`HTTP 429 Too Many Requests` with dynamic retry countdown).
4. **Unguessable URL Tokens**:
   - URL tokens use 18 cryptographically random bytes encoded in URL-safe base64 (`crypto.randomBytes(18)`), yielding 144 bits of entropy ($2.23 \times 10^{43}$ possibilities).
5. **Path Traversal & File Sanitization**:
   - User filenames are sanitized with `path.basename` and regex stripping `..`, slashes, and control characters.
   - Files are stored on disk under isolated directory paths: `storage/uploads/<shareId>/<fileId>_<name>`.
6. **Double-Ended 500 MB Limit**:
   - **Client-Side**: The uploader checks `file.size <= 500 * 1024 * 1024` before initializing upload.
   - **Server-Side**: Checked during `/api/upload/init`, during chunk aggregation, and verified byte-by-byte on `/api/upload/complete`.

---

## Setup & Running Locally

### Prerequisites
- **Node.js** v18+ (tested on Node v22.23.2)
- **npm** (included with Node.js)

### 1. Installation
In terminal:
```bash
cd F:\Projects\Pro-5cc
npm install
```

### 2. Run the Server
```bash
npm start
```
Output:
```
====================================================
  Cloud Clipboard & File Share Platform running
  Local URL:   http://localhost:3000
  Network:     http://0.0.0.0:3000
  Storage:     F:\Projects\Pro-5cc\storage
  Database:    F:\Projects\Pro-5cc\storage\clipboard.db
====================================================
```

### 3. Open in Browser
Open `http://localhost:3000` in any web browser.

### 4. Run Automated Test Suite
To run the automated 11-step end-to-end test suite:
```bash
npm test
```
This tests:
- Suggested secret generation
- Share creation
- URL token retrieval & passcode locking
- Passcode unlock
- Numeric PIN retrieval
- Brute-force rate limiting (HTTP 429 lockout)
- Chunked 5MB upload with pause/resume status
- SHA-256 checksum and size assembly
- 500 MB limit rejection guard
- Resumable streaming download (`HTTP 206 Partial Content`)
- Expiry and download count limit auto-burn (`HTTP 410 Gone`)
