const express = require('express');
const router = express.Router();
const UploadService = require('../services/uploadService');
const config = require('../config');

// POST /api/upload/init
// Begin a chunked upload session
router.post('/init', (req, res) => {
  try {
    const { shareId, fileName, fileSize, mimeType, totalChunks } = req.body;

    if (!shareId) {
      return res.status(400).json({ success: false, error: 'shareId is required' });
    }

    if (fileSize > config.MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        error: `File size exceeds the 500 MB limit (declared: ${(fileSize / (1024 * 1024)).toFixed(1)} MB)`
      });
    }

    const session = UploadService.initUpload({
      shareId,
      fileName,
      fileSize,
      mimeType,
      totalChunks
    });

    res.json({ success: true, session });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/upload/status/:uploadId
// Check uploaded chunks to support resuming dropped connections
router.get('/status/:uploadId', (req, res) => {
  try {
    const { uploadId } = req.params;
    const status = UploadService.getUploadStatus(uploadId);
    res.json({ success: true, status });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// POST /api/upload/chunk
// Streams a raw chunk directly to disk
router.post('/chunk', async (req, res) => {
  const uploadId = req.headers['x-upload-id'];
  const chunkIndex = parseInt(req.headers['x-chunk-index'], 10);

  if (!uploadId || isNaN(chunkIndex)) {
    return res.status(400).json({ success: false, error: 'Missing x-upload-id or x-chunk-index headers' });
  }

  try {
    const result = await UploadService.saveChunkStream(uploadId, chunkIndex, req);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/upload/complete
// Assemble and verify all chunks
router.post('/complete', async (req, res) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) {
      return res.status(400).json({ success: false, error: 'uploadId is required' });
    }

    const fileRecord = await UploadService.completeUpload(uploadId);
    res.json({ success: true, file: fileRecord });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
