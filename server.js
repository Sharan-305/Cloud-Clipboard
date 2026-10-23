const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const CleanupService = require('./services/cleanupService');

// Route imports
const shareRoutes = require('./routes/shareRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const accessRoutes = require('./routes/accessRoutes');
const downloadRoutes = require('./routes/downloadRoutes');

const app = express();

// Trust proxy for IP rate limiting if behind reverse proxy
app.set('trust proxy', 1);

// Standard Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static frontend assets - check public/ and root directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// API Routes
app.use('/api/shares', shareRoutes);
app.use('/api/shares', downloadRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/access', accessRoutes);

// Direct link handler: /s/:token serves the viewer page
app.get('/s/:token', (req, res) => {
  const rootFile = path.join(__dirname, 'view.html');
  if (fs.existsSync(rootFile)) {
    return res.sendFile(rootFile);
  }
  res.sendFile(path.join(__dirname, 'public', 'view.html'));
});

// Fallback for SPA routing
app.use((req, res) => {
  const rootFile = path.join(__dirname, 'index.html');
  if (fs.existsSync(rootFile)) {
    return res.sendFile(rootFile);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start background cleanup worker for expired shares & abandoned chunks
CleanupService.startScheduler();

// Start Server
app.listen(config.PORT, config.HOST, () => {
  console.log(`====================================================`);
  console.log(`  Cloud Clipboard & File Share Platform running`);
  console.log(`  Local URL:   http://localhost:${config.PORT}`);
  console.log(`  Network:     http://${config.HOST}:${config.PORT}`);
  console.log(`  Storage:     ${config.STORAGE_DIR}`);
  console.log(`  Database:    ${config.DB_PATH}`);
  console.log(`====================================================`);
});

module.exports = app;
