/**
 * Universal API and Storage Adapter for Cloud Clipboard
 * 
 * Supports two operational modes:
 * 1. BACKEND MODE: Connects to Node.js/Express REST API (supports chunked 500 MB uploads,
 *    SQLite persistence, bcrypt/HMAC, sliding-window rate limiting, and HTTP 206 streaming).
 * 2. STANDALONE CLIENT MODE: Automatically activates when hosted on static CDN/Jamstack
 *    platforms (like VibeHost Cloudflare R2) where /api/* returns 404.
 *    Uses browser IndexedDB + Web Crypto API (SHA-256) + URL hash replication.
 * 
 * Safe JSON parser ensures "Unexpected token 'N', 'Not Found' is not valid JSON" NEVER occurs.
 */
(function() {
  'use strict';

  const STORAGE_KEY_API_BASE = 'cc_api_base';
  const STORAGE_KEY_SHARES = 'cc_client_shares';
  const IDB_NAME = 'CloudClipboardDB';
  const IDB_STORE_FILES = 'files';

  let currentMode = 'auto'; // 'backend' | 'standalone'
  let cachedApiBase = localStorage.getItem(STORAGE_KEY_API_BASE) || '';

  // -------------------------------------------------------------
  // IndexedDB Helper for Large Files in Standalone Mode
  // -------------------------------------------------------------
  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE_FILES)) {
          db.createObjectStore(IDB_STORE_FILES, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSaveFile(fileRecord) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_FILES, 'readwrite');
      tx.objectStore(IDB_STORE_FILES).put(fileRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGetFile(id) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_FILES, 'readonly');
      const req = tx.objectStore(IDB_STORE_FILES).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------------------------------------------------
  // Web Crypto Hash for Standalone Mode (SHA-256)
  // -------------------------------------------------------------
  async function sha256(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function randomToken(len = 24) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    let str = '';
    for (let i = 0; i < len; i++) {
      str += chars[bytes[i] % chars.length];
    }
    return str;
  }

  // -------------------------------------------------------------
  // Base API Configuration
  // -------------------------------------------------------------
  function getApiBase() {
    return cachedApiBase ? cachedApiBase.trim().replace(/\/+$/, '') : '';
  }

  function setApiBase(url) {
    if (!url || !url.trim()) {
      cachedApiBase = '';
      localStorage.removeItem(STORAGE_KEY_API_BASE);
    } else {
      cachedApiBase = url.trim().replace(/\/+$/, '');
      localStorage.setItem(STORAGE_KEY_API_BASE, cachedApiBase);
    }
  }

  function isStaticHost() {
    const h = window.location.hostname;
    return h !== 'localhost' && h !== '127.0.0.1' && !h.startsWith('192.168.');
  }

  function generateClientSecrets() {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const pin = (100000 + (arr[0] % 900000)).toString();

    const words = [
      'amber', 'summit', 'falcon', 'nebula', 'orbit', 'pulse',
      'zenith', 'beacon', 'canyon', 'harbor', 'shadow', 'timber',
      'aurora', 'breeze', 'stride', 'vector', 'matrix', 'quartz'
    ];
    const w1 = words[Math.floor(Math.random() * words.length)];
    const w2 = words[Math.floor(Math.random() * words.length)];
    const num = Math.floor(100 + Math.random() * 900);
    return { suggestedPin: pin, suggestedPasscode: `${w1}-${w2}-${num}` };
  }

  // -------------------------------------------------------------
  // Safe JSON Fetch Parser (Guards against HTML / 404 plain text)
  // -------------------------------------------------------------
  async function safeFetchJson(path, options = {}) {
    const base = getApiBase();
    const fullUrl = base ? `${base}${path.startsWith('/') ? path : '/' + path}` : path;

    try {
      const res = await fetch(fullUrl, options);
      const contentType = res.headers.get('content-type') || '';

      if (!contentType.includes('application/json')) {
        const text = await res.text();
        if (res.status === 404) {
          const err = new Error(
            `Endpoint not found (404) at ${path}. ` +
            `If deployed statically on VibeHost, the backend server is not connected.`
          );
          err.status = 404;
          err.is404 = true;
          throw err;
        }
        const err = new Error(`Server returned HTTP ${res.status}: ${text.slice(0, 100) || 'Non-JSON response'}`);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      if (err.name === 'TypeError' && (err.message.includes('fetch') || err.message.includes('NetworkError') || err.message.includes('Failed to fetch'))) {
        const netErr = new Error(`Unable to reach backend server at ${fullUrl}.`);
        netErr.isNetworkError = true;
        throw netErr;
      }
      throw err;
    }
  }

  // -------------------------------------------------------------
  // High-Level Service Methods (Unified for Backend & Standalone)
  // -------------------------------------------------------------

  /**
   * Generates or fetches suggested PIN and passcode
   */
  async function getSecrets() {
    try {
      const { data } = await safeFetchJson('/api/shares/meta/generate-secrets');
      if (data && data.success) return data;
    } catch (e) {
      // Fallback seamlessly to local Web Crypto generator
    }
    const fallback = generateClientSecrets();
    return { success: true, ...fallback };
  }

  /**
   * Creates a share. Tries backend first; falls back to Standalone client mode on 404 / static host.
   */
  async function createShare(shareData, files = []) {
    // 1. If not forced to standalone, try backend API
    if (currentMode !== 'standalone') {
      try {
        const { data } = await safeFetchJson('/api/shares', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(shareData)
        });

        if (data && data.success) {
          currentMode = 'backend';
          return { mode: 'backend', share: data.share };
        }
      } catch (err) {
        // If 404 or network error on static host, activate Standalone Client Mode!
        if (err.is404 || err.isNetworkError || isStaticHost()) {
          console.info('Backend not available. Falling back to Standalone Client Storage Mode.');
          currentMode = 'standalone';
        } else {
          throw err;
        }
      }
    }

    // 2. Standalone Client Storage Mode (IndexedDB + Web Crypto + URL Hash)
    const token = randomToken(24);
    const now = Date.now();
    const expiryMinutes = parseInt(shareData.expiryMinutes, 10) || 1440;
    const expiresAt = now + (expiryMinutes * 60 * 1000);

    let pinHash = null;
    if (shareData.pin) {
      pinHash = await sha256(shareData.pin.trim());
    }

    let passcodeHash = null;
    if (shareData.passcode) {
      passcodeHash = await sha256(shareData.passcode.trim());
    }

    // Save attached files to IndexedDB
    const savedFiles = [];
    for (const f of files) {
      const fileId = randomToken(16);
      const fileRecord = {
        id: fileId,
        shareToken: token,
        name: f.name,
        size: f.size,
        type: f.type || 'application/octet-stream',
        blob: f,
        createdAt: now
      };
      await idbSaveFile(fileRecord);
      savedFiles.push({
        id: fileId,
        original_name: f.name,
        file_size: f.size,
        mime_type: f.type || 'application/octet-stream'
      });
    }

    const share = {
      id: 'local_' + token,
      token,
      title: shareData.title || null,
      contentText: shareData.contentText || null,
      hasPin: !!shareData.pin,
      hasPasscode: !!shareData.passcode,
      pinHash,
      passcodeHash,
      maxDownloads: shareData.maxDownloads ? parseInt(shareData.maxDownloads, 10) : null,
      downloadCount: 0,
      expiresAt,
      createdAt: now,
      files: savedFiles,
      isStandalone: true
    };

    // Save share record to localStorage index
    const clientShares = JSON.parse(localStorage.getItem(STORAGE_KEY_SHARES) || '[]');
    clientShares.unshift(share);
    // Keep last 50 local shares
    if (clientShares.length > 50) clientShares.pop();
    localStorage.setItem(STORAGE_KEY_SHARES, JSON.stringify(clientShares));

    // Embed content in hash payload for universal zero-backend cross-device shareability
    if (share.contentText && (!share.files || share.files.length === 0)) {
      try {
        const payload = {
          t: share.title,
          c: share.contentText,
          hp: share.hasPasscode ? passcodeHash : null,
          exp: expiresAt
        };
        const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
        share.hashPayload = encoded;
      } catch (e) {
        console.warn('Could not encode hash payload:', e);
      }
    }

    return { mode: 'standalone', share };
  }

  /**
   * Retrieve share via URL Token (supports backend, local IndexedDB, and URL hash)
   */
  async function getShareByToken(token, hashStr = '') {
    // Check URL hash payload first (universal standalone link)
    if (hashStr && hashStr.includes('share=')) {
      try {
        const b64 = hashStr.split('share=')[1].split('&')[0];
        const json = decodeURIComponent(atob(b64));
        const payload = JSON.parse(json);
        if (payload.exp && Date.now() > payload.exp) {
          throw new Error('This shared item has expired.');
        }
        return {
          success: true,
          share: {
            token,
            title: payload.t,
            contentText: payload.c,
            isLocked: !!payload.hp,
            passcodeHash: payload.hp,
            expiresAt: payload.exp || (Date.now() + 3600000),
            downloadCount: 0,
            maxDownloads: null,
            files: [],
            isStandalone: true
          }
        };
      } catch (e) {
        console.warn('Could not parse hash payload:', e);
      }
    }

    // Try backend API
    try {
      const { data } = await safeFetchJson(`/api/shares/${encodeURIComponent(token)}`);
      if (data && data.success) return data;
    } catch (err) {
      if (!err.is404 && !err.isNetworkError && !isStaticHost()) {
        throw err;
      }
    }

    // Check client-side storage
    const clientShares = JSON.parse(localStorage.getItem(STORAGE_KEY_SHARES) || '[]');
    const found = clientShares.find(s => s.token === token);
    if (found) {
      if (Date.now() > found.expiresAt) {
        throw new Error('This share has expired.');
      }
      return {
        success: true,
        share: {
          token: found.token,
          title: found.title,
          contentText: found.hasPasscode ? null : found.contentText,
          isLocked: found.hasPasscode,
          expiresAt: found.expiresAt,
          downloadCount: found.downloadCount || 0,
          maxDownloads: found.maxDownloads,
          files: found.files || [],
          isStandalone: true
        }
      };
    }

    throw new Error('Share not found or expired.');
  }

  /**
   * Unlock passcode-protected share
   */
  async function unlockShare(token, passcode) {
    // Try backend
    try {
      const { data } = await safeFetchJson(`/api/shares/${encodeURIComponent(token)}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode })
      });
      if (data && data.success) return data;
    } catch (err) {
      if (!err.is404 && !err.isNetworkError && !isStaticHost()) {
        throw err;
      }
    }

    // Check client-side storage
    const clientShares = JSON.parse(localStorage.getItem(STORAGE_KEY_SHARES) || '[]');
    const found = clientShares.find(s => s.token === token);
    if (found) {
      const enteredHash = await sha256(passcode.trim());
      if (found.passcodeHash && found.passcodeHash !== enteredHash) {
        throw new Error('Incorrect passcode.');
      }
      return {
        success: true,
        share: {
          token: found.token,
          title: found.title,
          contentText: found.contentText,
          isLocked: false,
          expiresAt: found.expiresAt,
          downloadCount: found.downloadCount || 0,
          maxDownloads: found.maxDownloads,
          files: found.files || [],
          isStandalone: true
        }
      };
    }

    throw new Error('Share not found or expired.');
  }

  /**
   * Retrieve item by PIN
   */
  async function accessByPin(pin) {
    try {
      const { data } = await safeFetchJson('/api/access/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      if (data) return data;
    } catch (err) {
      if (!err.is404 && !err.isNetworkError && !isStaticHost()) {
        throw err;
      }
    }

    // Check local client storage
    const enteredHash = await sha256(pin.trim());
    const clientShares = JSON.parse(localStorage.getItem(STORAGE_KEY_SHARES) || '[]');
    const found = clientShares.find(s => s.pinHash === enteredHash);
    if (found) {
      if (Date.now() > found.expiresAt) {
        throw new Error('This PIN has expired.');
      }
      return {
        success: true,
        share: {
          token: found.token,
          title: found.title,
          contentText: found.contentText,
          expiresAt: found.expiresAt,
          downloadCount: found.downloadCount || 0,
          maxDownloads: found.maxDownloads,
          files: found.files || [],
          isStandalone: true
        }
      };
    }

    throw new Error('Invalid PIN or share has expired.');
  }

  /**
   * Retrieve item by Passcode
   */
  async function accessByPasscode(passcode) {
    try {
      const { data } = await safeFetchJson('/api/access/passcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode })
      });
      if (data) return data;
    } catch (err) {
      if (!err.is404 && !err.isNetworkError && !isStaticHost()) {
        throw err;
      }
    }

    // Check local client storage
    const enteredHash = await sha256(passcode.trim());
    const clientShares = JSON.parse(localStorage.getItem(STORAGE_KEY_SHARES) || '[]');
    const found = clientShares.find(s => s.passcodeHash === enteredHash);
    if (found) {
      if (Date.now() > found.expiresAt) {
        throw new Error('This passcode has expired.');
      }
      return {
        success: true,
        share: {
          token: found.token,
          title: found.title,
          contentText: found.contentText,
          expiresAt: found.expiresAt,
          downloadCount: found.downloadCount || 0,
          maxDownloads: found.maxDownloads,
          files: found.files || [],
          isStandalone: true
        }
      };
    }

    throw new Error('Invalid passcode or share has expired.');
  }

  /**
   * Download a file (supports backend streaming and IndexedDB blob download)
   */
  async function downloadFile(token, fileId, originalName, isStandalone = false) {
    if (isStandalone) {
      const fileRecord = await idbGetFile(fileId);
      if (!fileRecord || !fileRecord.blob) {
        throw new Error('File not found in local browser storage.');
      }
      const url = URL.createObjectURL(fileRecord.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = originalName || fileRecord.name || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return;
    }

    // Backend download URL
    const base = getApiBase();
    const downloadUrl = `${base}/api/shares/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/download`;
    window.location.href = downloadUrl;
  }

  // -------------------------------------------------------------
  // Public API Export
  // -------------------------------------------------------------
  window.CC_API = {
    getApiBase,
    setApiBase,
    isStaticHost,
    safeFetchJson,
    generateClientSecrets,
    getSecrets,
    createShare,
    getShareByToken,
    unlockShare,
    accessByPin,
    accessByPasscode,
    downloadFile,
    idbGetFile
  };
})();
