/**
 * Resumable Chunked Uploader with Exponential Backoff
 * Handles large files up to 500 MB in 5 MB chunks.
 */
class ChunkedUploader {
  static CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per chunk

  constructor(file, options = {}) {
    this.file = file;
    this.shareId = options.shareId;
    this.uploadId = options.uploadId || null;
    this.onProgress = options.onProgress || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onError = options.onError || (() => {});
    this.onSuccess = options.onSuccess || (() => {});

    this.totalChunks = Math.ceil(this.file.size / ChunkedUploader.CHUNK_SIZE);
    this.uploadedChunks = new Set();
    this.isPaused = false;
    this.isCancelled = false;
    this.currentXhr = null;
    this.startTime = null;
  }

  getApiUrl(path) {
    const base = (window.CC_API && window.CC_API.getApiBase) ? window.CC_API.getApiBase() : '';
    return base ? `${base}${path.startsWith('/') ? path : '/' + path}` : path;
  }

  /**
   * Start or resume the upload process
   */
  async start() {
    try {
      this.isPaused = false;
      this.isCancelled = false;
      this.onStatusChange('initializing');

      // Initialize session if not already initialized
      if (!this.uploadId) {
        const { data: initData } = await window.CC_API.safeFetchJson('/api/upload/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shareId: this.shareId,
            fileName: this.file.name,
            fileSize: this.file.size,
            mimeType: this.file.type || 'application/octet-stream',
            totalChunks: this.totalChunks
          })
        });

        if (!initData.success) {
          throw new Error(initData.error || 'Failed to initialize upload session');
        }

        this.uploadId = initData.session.uploadId;
      } else {
        // Resuming: check what chunks server already has
        await this.syncServerStatus();
      }

      this.startTime = Date.now();
      this.onStatusChange('uploading');
      await this.uploadChunks();

    } catch (err) {
      if (!this.isCancelled) {
        this.onStatusChange('error');
        this.onError(err);
      }
    }
  }

  /**
   * Check status on server to skip already uploaded chunks
   */
  async syncServerStatus() {
    try {
      const { data } = await window.CC_API.safeFetchJson(`/api/upload/status/${this.uploadId}`);
      if (data && data.success && data.status.uploadedChunks) {
        data.status.uploadedChunks.forEach(idx => this.uploadedChunks.add(idx));
      }
    } catch (e) {
      console.warn('Could not sync upload status:', e);
    }
  }

  /**
   * Loop through remaining chunks
   */
  async uploadChunks() {
    for (let index = 0; index < this.totalChunks; index++) {
      if (this.isCancelled) return;
      if (this.isPaused) {
        this.onStatusChange('paused');
        return;
      }

      // Skip already uploaded chunks
      if (this.uploadedChunks.has(index)) {
        continue;
      }

      await this.uploadSingleChunkWithRetry(index);
      this.uploadedChunks.add(index);

      // Report progress
      const uploadedBytes = Math.min(this.uploadedChunks.size * ChunkedUploader.CHUNK_SIZE, this.file.size);
      const percent = Math.min(100, Math.round((uploadedBytes / this.file.size) * 100));
      const elapsedSec = (Date.now() - this.startTime) / 1000;
      const speedBytesPerSec = elapsedSec > 0 ? (uploadedBytes / elapsedSec) : 0;
      const remainingBytes = this.file.size - uploadedBytes;
      const remainingSec = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;

      this.onProgress({
        chunkIndex: index,
        totalChunks: this.totalChunks,
        uploadedBytes,
        totalBytes: this.file.size,
        percent,
        speedBytesPerSec,
        remainingSec
      });
    }

    if (this.isCancelled || this.isPaused) return;

    // Complete upload
    this.onStatusChange('processing');
    const { data: compData } = await window.CC_API.safeFetchJson('/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: this.uploadId })
    });

    if (!compData.success) {
      throw new Error(compData.error || 'Failed to assemble uploaded chunks on server');
    }

    this.onStatusChange('completed');
    this.onSuccess(compData.file);
  }

  /**
   * Uploads one chunk, with auto-retry for resilience
   */
  async uploadSingleChunkWithRetry(chunkIndex, maxRetries = 3) {
    let attempt = 0;
    while (attempt <= maxRetries) {
      if (this.isCancelled || this.isPaused) return;
      try {
        await this.uploadSingleChunk(chunkIndex);
        return;
      } catch (err) {
        attempt++;
        if (attempt > maxRetries) {
          throw new Error(`Failed to upload chunk ${chunkIndex + 1} after ${maxRetries} retries: ${err.message}`);
        }
        // Exponential backoff delay
        await new Promise(r => setTimeout(r, attempt * 1200));
      }
    }
  }

  /**
   * Upload single chunk via XMLHttpRequest for fine-grained abort control
   */
  uploadSingleChunk(chunkIndex) {
    return new Promise((resolve, reject) => {
      const start = chunkIndex * ChunkedUploader.CHUNK_SIZE;
      const end = Math.min(start + ChunkedUploader.CHUNK_SIZE, this.file.size);
      const chunkBlob = this.file.slice(start, end);

      const xhr = new XMLHttpRequest();
      this.currentXhr = xhr;

      const chunkUrl = this.getApiUrl('/api/upload/chunk');
      xhr.open('POST', chunkUrl, true);
      xhr.setRequestHeader('x-upload-id', this.uploadId);
      xhr.setRequestHeader('x-chunk-index', chunkIndex);
      xhr.setRequestHeader('x-total-chunks', this.totalChunks);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      xhr.onload = () => {
        this.currentXhr = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.success) {
              resolve(data);
            } else {
              reject(new Error(data.error || 'Chunk upload failed'));
            }
          } catch (e) {
            reject(new Error('Invalid response from server'));
          }
        } else {
          reject(new Error(`Server returned HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => {
        this.currentXhr = null;
        reject(new Error('Network error during chunk transmission'));
      };

      xhr.onabort = () => {
        this.currentXhr = null;
        reject(new Error('Upload paused or cancelled'));
      };

      xhr.send(chunkBlob);
    });
  }

  pause() {
    this.isPaused = true;
    if (this.currentXhr) {
      this.currentXhr.abort();
    }
    this.onStatusChange('paused');
  }

  cancel() {
    this.isCancelled = true;
    if (this.currentXhr) {
      this.currentXhr.abort();
    }
    this.onStatusChange('cancelled');
  }
}

window.ChunkedUploader = ChunkedUploader;
