const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db/database');

class UploadService {
  /**
   * Initialize a new chunked upload session
   */
  static initUpload({ shareId, fileName, fileSize, mimeType, totalChunks }) {
    if (!fileSize || fileSize > config.MAX_FILE_SIZE_BYTES) {
      throw new Error(`File size exceeds maximum allowed limit of ${config.MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`);
    }

    if (!fileName || typeof fileName !== 'string') {
      throw new Error('Valid fileName is required');
    }

    const uploadId = crypto.randomUUID();
    const sanitizedName = path.basename(fileName).replace(/[^a-zA-Z0-9._\- ]/g, '_');
    const uploadDir = path.join(config.TEMP_CHUNKS_DIR, uploadId);

    fs.mkdirSync(uploadDir, { recursive: true });

    const metadata = {
      uploadId,
      shareId,
      fileName: sanitizedName,
      fileSize: parseInt(fileSize, 10),
      mimeType: mimeType || 'application/octet-stream',
      totalChunks: parseInt(totalChunks, 10),
      createdAt: Date.now()
    };

    fs.writeFileSync(path.join(uploadDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

    return {
      uploadId,
      chunkSize: config.DEFAULT_CHUNK_SIZE_BYTES,
      totalChunks: metadata.totalChunks,
      maxFileSizeBytes: config.MAX_FILE_SIZE_BYTES
    };
  }

  /**
   * Get list of already uploaded chunks for resumability
   */
  static getUploadStatus(uploadId) {
    const uploadDir = path.join(config.TEMP_CHUNKS_DIR, uploadId);
    if (!fs.existsSync(uploadDir)) {
      throw new Error('Upload session not found or expired');
    }

    const metaPath = path.join(uploadDir, 'metadata.json');
    if (!fs.existsSync(metaPath)) {
      throw new Error('Upload metadata missing');
    }

    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const files = fs.readdirSync(uploadDir);
    const uploadedChunks = files
      .filter(f => f.startsWith('chunk_'))
      .map(f => parseInt(f.replace('chunk_', ''), 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    return {
      uploadId,
      uploadedChunks,
      totalChunks: metadata.totalChunks,
      fileSize: metadata.fileSize,
      fileName: metadata.fileName
    };
  }

  /**
   * Save incoming chunk stream directly to temporary storage
   */
  static saveChunkStream(uploadId, chunkIndex, stream) {
    return new Promise((resolve, reject) => {
      const uploadDir = path.join(config.TEMP_CHUNKS_DIR, uploadId);
      if (!fs.existsSync(uploadDir)) {
        return reject(new Error('Upload session not found or expired'));
      }

      const chunkPath = path.join(uploadDir, `chunk_${chunkIndex}`);
      const writeStream = fs.createWriteStream(chunkPath);

      stream.pipe(writeStream);

      writeStream.on('finish', () => {
        resolve({ chunkIndex, success: true });
      });

      writeStream.on('error', (err) => {
        // Remove corrupted chunk on error
        if (fs.existsSync(chunkPath)) {
          fs.unlinkSync(chunkPath);
        }
        reject(err);
      });
    });
  }

  /**
   * Merge all chunks into final file, verify size and checksum, and record in DB
   */
  static async completeUpload(uploadId) {
    const uploadDir = path.join(config.TEMP_CHUNKS_DIR, uploadId);
    if (!fs.existsSync(uploadDir)) {
      throw new Error('Upload session not found or expired');
    }

    const metaPath = path.join(uploadDir, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const { shareId, fileName, fileSize, mimeType, totalChunks } = metadata;

    // Verify all chunks exist
    for (let i = 0; i < totalChunks; i++) {
      const chunkFile = path.join(uploadDir, `chunk_${i}`);
      if (!fs.existsSync(chunkFile)) {
        throw new Error(`Missing chunk ${i} of ${totalChunks}. Please resume upload.`);
      }
    }

    // Target storage directory
    const fileId = crypto.randomUUID();
    const finalDir = path.join(config.UPLOADS_DIR, shareId);
    fs.mkdirSync(finalDir, { recursive: true });

    const finalPath = path.join(finalDir, `${fileId}_${fileName}`);
    const finalWriteStream = fs.createWriteStream(finalPath);
    const hash = crypto.createHash('sha256');

    let totalWritten = 0;

    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(uploadDir, `chunk_${i}`);
      const chunkData = fs.readFileSync(chunkPath);
      totalWritten += chunkData.length;

      if (totalWritten > config.MAX_FILE_SIZE_BYTES) {
        finalWriteStream.destroy();
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
        throw new Error(`Assembled file exceeds 500 MB limit`);
      }

      hash.update(chunkData);
      finalWriteStream.write(chunkData);
    }

    await new Promise((resolve) => finalWriteStream.end(resolve));

    const finalHash = hash.digest('hex');

    // Remove temp directory and chunks
    fs.rmSync(uploadDir, { recursive: true, force: true });

    // Store relative path for portability
    const relativePath = path.relative(config.STORAGE_DIR, finalPath);

    // Insert file metadata into database
    const fileRecord = {
      id: fileId,
      share_id: shareId,
      original_name: fileName,
      file_size: totalWritten,
      mime_type: mimeType,
      storage_path: relativePath,
      checksum_sha256: finalHash,
      created_at: Date.now()
    };

    const stmt = db.prepare(`
      INSERT INTO files (id, share_id, original_name, file_size, mime_type, storage_path, checksum_sha256, created_at)
      VALUES (@id, @share_id, @original_name, @file_size, @mime_type, @storage_path, @checksum_sha256, @created_at)
    `);
    stmt.run(fileRecord);

    return fileRecord;
  }
}

module.exports = UploadService;
