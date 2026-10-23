const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const ShareService = require('../services/shareService');
const config = require('../config');

// POST /api/access/pin
// Retrieve share by 6-digit numeric PIN
router.post('/pin', async (req, res) => {
  const { pin } = req.body;
  const ip = req.ip || req.connection.remoteAddress;

  if (!pin || pin.toString().trim().length === 0) {
    return res.status(400).json({ success: false, error: 'PIN is required' });
  }

  try {
    const share = await ShareService.getShareByPin(pin, ip);
    res.json({ success: true, share });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      error: err.message,
      retryAfter: err.retryAfter || undefined
    });
  }
});

// POST /api/access/passcode
// Retrieve share by text passcode
router.post('/passcode', async (req, res) => {
  const { passcode } = req.body;
  const ip = req.ip || req.connection.remoteAddress;

  if (!passcode || passcode.toString().trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Passcode is required' });
  }

  try {
    const share = await ShareService.getShareByPasscode(passcode, ip);
    res.json({ success: true, share });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      error: err.message,
      retryAfter: err.retryAfter || undefined
    });
  }
});

// GET /api/access/qr
// Generate QR code for any target text or token URL
router.get('/qr', async (req, res) => {
  try {
    const { text, format } = req.query;
    if (!text) {
      return res.status(400).json({ success: false, error: 'text query parameter is required' });
    }

    if (format === 'png') {
      res.setHeader('Content-Type', 'image/png');
      return QRCode.toFileStream(res, text, {
        margin: 2,
        width: 320,
        color: {
          dark: '#101518',
          light: '#ffffff'
        }
      });
    }

    const dataUrl = await QRCode.toDataURL(text, {
      margin: 2,
      width: 320,
      color: {
        dark: '#101518',
        light: '#ffffff'
      }
    });

    res.json({ success: true, dataUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
