const express = require('express');
const router = express.Router();
const os = require('os');
const ShareService = require('../services/shareService');
const AuthService = require('../services/authService');
const RateLimiter = require('../services/rateLimiter');
const config = require('../config');

// Helper to get local network IP
function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name in ifaces) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// GET /api/shares/meta/network-info
router.get('/meta/network-info', (req, res) => {
  const lanIp = getLanIp();
  res.json({
    lanIp,
    port: config.PORT,
    lanBaseUrl: `http://${lanIp}:${config.PORT}`
  });
});

// GET /api/shares/meta/generate-secrets
// Generate pre-populated suggested PIN & Passcode for frontend form
router.get('/meta/generate-secrets', (req, res) => {
  res.json({
    suggestedPin: AuthService.generatePin(),
    suggestedPasscode: AuthService.generatePasscode(),
    lanIp: getLanIp()
  });
});

// POST /api/shares
// Create a new clipboard / file share
router.post('/', async (req, res) => {
  try {
    const { title, contentText, pin, passcode, maxDownloads, expiryMinutes } = req.body;
    const hostHeader = req.get('host') || `localhost:${config.PORT}`;
    const protocol = req.protocol || 'http';
    const dynamicBaseUrl = `${protocol}://${hostHeader}`;

    const result = await ShareService.createShare({
      title,
      contentText,
      pin,
      passcode,
      maxDownloads,
      expiryMinutes,
      baseUrl: dynamicBaseUrl
    });

    // Provide LAN URL specifically for mobile QR code scanning
    const lanIp = getLanIp();
    result.lanShareUrl = `http://${lanIp}:${config.PORT}/s/${result.token}`;

    res.status(201).json({
      success: true,
      share: result
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/shares/:token
// Retrieve share metadata by unguessable URL token
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const passcode = req.query.passcode || req.headers['x-share-passcode'];
    const ip = req.ip || req.connection.remoteAddress;

    const share = ShareService.getShareByToken(token, { verifyPasscode: passcode });
    if (!share) {
      ShareService.logAccess(null, ip, 'url', 'not_found');
      return res.status(404).json({ success: false, error: 'Share not found' });
    }

    ShareService.logAccess(share.id, ip, 'url', 'success');
    res.json({ success: true, share });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// POST /api/shares/:token/unlock
// Unlock passcode-protected share
router.post('/:token/unlock', async (req, res) => {
  try {
    const { token } = req.params;
    const { passcode } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    const rateKey = `unlock:${ip}:${token}`;
    const rateCheck = RateLimiter.checkRateLimit(rateKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: `Too many attempts. Please wait ${rateCheck.retryAfterSeconds} seconds.`
      });
    }

    if (!passcode) {
      return res.status(400).json({ success: false, error: 'Passcode is required' });
    }

    try {
      const share = ShareService.getShareByToken(token, { verifyPasscode: passcode });
      RateLimiter.reset(rateKey);
      ShareService.logAccess(share.id, ip, 'passcode_unlock', 'success');
      res.json({ success: true, share });
    } catch (err) {
      RateLimiter.recordFailure(rateKey);
      ShareService.logAccess(null, ip, 'passcode_unlock', 'failed');
      throw err;
    }
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
