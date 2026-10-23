const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const ShareService = require('../services/shareService');
const config = require('../config');

// GET /api/shares/:token/files/:fileId/download
// Resumable streaming download supporting HTTP Range headers
router.get('/:token/files/:fileId/download', (req, res) => {
  const { token, fileId } = req.params;
  const passcode = req.query.passcode || req.headers['x-share-passcode'];

  try {
    // 1. Validate share access
    const share = ShareService.getShareByToken(token, { verifyPasscode: passcode });
    if (!share) {
      return res.status(404).json({ success: false, error: 'Share not found' });
    }

    // If passcode required and not provided/invalid
    if (share.isLocked) {
      return res.status(401).json({ success: false, error: 'Passcode required to download file' });
    }

    // 2. Locate file record
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND share_id = ?').get(fileId, share.id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File record not found' });
    }

    // 3. Resolve physical path
    const filePath = path.resolve(config.STORAGE_DIR, file.storage_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File data missing from storage' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Sanitize filename for Content-Disposition header
    const safeFilename = encodeURIComponent(file.original_name);

    // Support HTTP Range requests (crucial for 500 MB resumable downloads)
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.status(416).send('Requested Range Not Satisfiable');
      }

      const chunkSize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${file.original_name}"; filename*=UTF-8''${safeFilename}`
      });

      // Increment count on initial download start (not for each sub-range chunk)
      if (start === 0) {
        ShareService.incrementDownloadCount(share.id);
      }

      fileStream.pipe(res);
    } else {
      // Normal full streaming response
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${file.original_name}"; filename*=UTF-8''${safeFilename}`
      });

      ShareService.incrementDownloadCount(share.id);

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    }
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
