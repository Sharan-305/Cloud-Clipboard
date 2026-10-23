/**
 * Main Application Controller for Share Creation & UI State
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // Elements
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const fileListContainer = document.getElementById('file-list');
  const shareForm = document.getElementById('share-form');
  const shareBtn = document.getElementById('share-btn');

  // Security option elements
  const enablePinCheck = document.getElementById('enable-pin');
  const pinInput = document.getElementById('pin-input');
  const genPinBtn = document.getElementById('gen-pin-btn');
  const enablePasscodeCheck = document.getElementById('enable-passcode');
  const passcodeInput = document.getElementById('passcode-input');
  const genPasscodeBtn = document.getElementById('gen-passcode-btn');

  // Success Modal Elements
  const modalOverlay = document.getElementById('share-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalUrlInput = document.getElementById('modal-share-url');
  const modalCopyUrlBtn = document.getElementById('modal-copy-url');
  const modalPinCard = document.getElementById('modal-pin-card');
  const modalPinDisplay = document.getElementById('modal-pin-display');
  const modalCopyPinBtn = document.getElementById('modal-copy-pin');
  const modalPasscodeCard = document.getElementById('modal-passcode-card');
  const modalPasscodeDisplay = document.getElementById('modal-passcode-display');
  const modalCopyPasscodeBtn = document.getElementById('modal-copy-passcode');
  const qrCanvas = document.getElementById('qr-canvas');
  const qrToggleBtn = document.getElementById('qr-toggle-btn');
  const downloadQrBtn = document.getElementById('download-qr-btn');

  // Server Status & Settings Elements
  const serverStatusPill = document.getElementById('server-status-pill');
  const serverModal = document.getElementById('server-settings-modal');
  const serverModalClose = document.getElementById('server-settings-close');
  const serverUrlInput = document.getElementById('server-url-input');
  const saveServerBtn = document.getElementById('save-server-btn');
  const testServerBtn = document.getElementById('test-server-btn');
  const serverFeedback = document.getElementById('server-settings-feedback');

  // State
  let queuedFiles = [];
  let currentShareData = null;
  let qrMode = 'url'; // 'url' or 'pin'

  // Tab switching with ARIA synchronization & arrow key support
  function selectTab(btn) {
    tabBtns.forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    tabContents.forEach(c => c.style.display = 'none');

    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const targetId = btn.getAttribute('data-tab');
    const targetContent = document.getElementById(targetId);
    if (targetContent) targetContent.style.display = 'block';

    if (targetId === 'tab-recent') {
      renderRecentShares();
    }
  }

  tabBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => selectTab(btn));
    btn.addEventListener('keydown', (e) => {
      let targetIndex = -1;
      if (e.key === 'ArrowRight') targetIndex = (index + 1) % tabBtns.length;
      if (e.key === 'ArrowLeft') targetIndex = (index - 1 + tabBtns.length) % tabBtns.length;
      if (targetIndex !== -1) {
        e.preventDefault();
        tabBtns[targetIndex].focus();
        selectTab(tabBtns[targetIndex]);
      }
    });
  });

  // Fetch or generate suggested PIN and Passcode
  async function loadSuggestedSecrets() {
    try {
      const data = await window.CC_API.getSecrets();
      if (pinInput && !pinInput.value) pinInput.value = data.suggestedPin;
      if (passcodeInput && !passcodeInput.value) passcodeInput.value = data.suggestedPasscode;
    } catch (e) {
      console.warn('Could not fetch suggested secrets:', e);
    }
  }
  loadSuggestedSecrets();

  if (genPinBtn) {
    genPinBtn.addEventListener('click', async () => {
      const data = await window.CC_API.getSecrets();
      pinInput.value = data.suggestedPin;
    });
  }

  if (genPasscodeBtn) {
    genPasscodeBtn.addEventListener('click', async () => {
      const data = await window.CC_API.getSecrets();
      passcodeInput.value = data.suggestedPasscode;
    });
  }

  // Toggle PIN and Passcode input disabled states
  if (enablePinCheck) {
    enablePinCheck.addEventListener('change', () => {
      pinInput.disabled = !enablePinCheck.checked;
      genPinBtn.disabled = !enablePinCheck.checked;
    });
  }

  if (enablePasscodeCheck) {
    enablePasscodeCheck.addEventListener('change', () => {
      passcodeInput.disabled = !enablePasscodeCheck.checked;
      genPasscodeBtn.disabled = !enablePasscodeCheck.checked;
    });
  }

  // Dropzone file handling
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('drag-over');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer.files || []);
      handleFilesSelected(files);
    });

    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      handleFilesSelected(files);
      fileInput.value = ''; // Reset input to allow re-selection
    });
  }

  // Client-Side 500 MB Validation Guard
  const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

  function handleFilesSelected(files) {
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        showToast(`File "${file.name}" exceeds the 500 MB limit (${formatBytes(file.size)}).`, 'error');
        continue;
      }
      queuedFiles.push(file);
    }
    renderFileList();
  }

  function renderFileList() {
    if (!fileListContainer) return;
    fileListContainer.innerHTML = '';

    if (queuedFiles.length === 0) {
      fileListContainer.style.display = 'none';
      return;
    }

    fileListContainer.style.display = 'flex';

    queuedFiles.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; width: 100%;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width: 18px; height: 18px; color: var(--color-accent); flex-shrink: 0;">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; font-size: 0.92rem; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(file.name)}</div>
            <div style="font-size: 0.78rem; color: var(--text-tertiary);">${formatBytes(file.size)}</div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm remove-file-btn" data-index="${index}" aria-label="Remove ${escapeHtml(file.name)}" style="padding: 4px 8px; flex-shrink: 0;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width: 14px; height: 14px;">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="progress-wrap" id="prog-wrap-${index}" style="display: none; margin-top: 8px;">
          <div class="progress-bar" id="prog-bar-${index}"></div>
        </div>
        <div class="progress-meta" id="prog-meta-${index}" style="display: none; font-size: 0.74rem; color: var(--text-tertiary); justify-content: space-between; margin-top: 4px;">
          <span id="prog-pct-${index}">0%</span>
          <span id="prog-speed-${index}">0 MB/s</span>
        </div>
      `;

      item.querySelector('.remove-file-btn').addEventListener('click', () => {
        queuedFiles.splice(index, 1);
        renderFileList();
      });

      fileListContainer.appendChild(item);
    });
  }

  // Handle Share Creation Form Submission
  if (shareForm) {
    shareForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const title = document.getElementById('share-title').value.trim();
      const contentText = document.getElementById('share-content').value.trim();
      const hasPin = enablePinCheck ? enablePinCheck.checked : false;
      const pin = hasPin ? pinInput.value.trim() : null;
      const hasPasscode = enablePasscodeCheck ? enablePasscodeCheck.checked : false;
      const passcode = hasPasscode ? passcodeInput.value.trim() : null;
      const maxDownloadsVal = document.getElementById('max-downloads').value.trim();
      const maxDownloads = maxDownloadsVal ? parseInt(maxDownloadsVal, 10) : null;
      const expiryMinutes = parseInt(document.getElementById('expiry-time').value, 10) || 1440;

      if (!contentText && queuedFiles.length === 0) {
        showToast('Please enter text content or attach at least one file.', 'warning');
        return;
      }

      if (hasPin && (!pin || pin.length < 4 || pin.length > 8)) {
        showToast('PIN must be 4 to 8 digits.', 'warning');
        return;
      }

      shareBtn.disabled = true;
      shareBtn.textContent = 'Creating Share...';

      try {
        // Step 1: Create share record (backend or standalone client storage)
        const { mode, share } = await window.CC_API.createShare({
          title,
          contentText,
          pin,
          passcode,
          maxDownloads: maxDownloads || null,
          expiryMinutes
        }, queuedFiles);

        // Step 2: Upload files if any exist and running in backend mode
        if (mode === 'backend' && queuedFiles.length > 0) {
          shareBtn.textContent = `Uploading Files (0/${queuedFiles.length})...`;
          for (let i = 0; i < queuedFiles.length; i++) {
            const file = queuedFiles[i];
            const progWrap = document.getElementById(`prog-wrap-${i}`);
            const progBar = document.getElementById(`prog-bar-${i}`);
            const progMeta = document.getElementById(`prog-meta-${i}`);
            const progPct = document.getElementById(`prog-pct-${i}`);
            const progSpeed = document.getElementById(`prog-speed-${i}`);

            if (progWrap) progWrap.style.display = 'block';
            if (progMeta) progMeta.style.display = 'flex';

            shareBtn.textContent = `Uploading File ${i + 1} of ${queuedFiles.length}...`;

            await new Promise((resolve, reject) => {
              const uploader = new ChunkedUploader(file, {
                shareId: share.id,
                onProgress: ({ percent, speedBytesPerSec }) => {
                  if (progBar) progBar.style.width = `${percent}%`;
                  if (progPct) progPct.textContent = `${percent}%`;
                  if (progSpeed) progSpeed.textContent = `${(speedBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
                },
                onError: (err) => reject(err),
                onSuccess: () => resolve()
              });

              uploader.start();
            });
          }
        }

        // Attach plaintext credentials for instant display in modal
        share.pin = pin;
        share.passcode = passcode;

        // Step 3: Success! Display Modal with 4 sharing methods
        currentShareData = share;
        saveToRecentShares(share);
        displaySuccessModal(share);

        // Reset form
        shareForm.reset();
        queuedFiles = [];
        renderFileList();
        loadSuggestedSecrets();
        showToast('Share created successfully!', 'success');

      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      } finally {
        shareBtn.disabled = false;
        shareBtn.textContent = 'Create Share';
      }
    });
  }

  // Display Success Modal with the 4 sharing methods
  function displaySuccessModal(share) {
    modalUrlInput.value = share.shareUrl;

    // PIN Card
    if (share.hasPin && share.pin) {
      modalPinCard.style.display = 'block';
      modalPinDisplay.textContent = share.pin;
    } else {
      modalPinCard.style.display = 'none';
    }

    // Passcode Card
    if (share.hasPasscode && share.passcode) {
      modalPasscodeCard.style.display = 'block';
      modalPasscodeDisplay.value = share.passcode;
    } else {
      modalPasscodeCard.style.display = 'none';
    }

    // Render QR Code (prefer LAN URL if local, otherwise public URL)
    qrMode = 'url';
    const qrTargetUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? (share.lanShareUrl || share.shareUrl)
      : share.shareUrl;
    renderQrCode(qrTargetUrl);

    modalOverlay.classList.add('active');
  }

  function renderQrCode(targetText) {
    if (window.QRCodeRenderer && qrCanvas) {
      QRCodeRenderer.renderToCanvas(qrCanvas, targetText, {
        size: 220,
        darkColor: '#101518',
        lightColor: '#ffffff'
      });
    }
  }

  // QR Toggle between Link and PIN
  if (qrToggleBtn) {
    qrToggleBtn.addEventListener('click', () => {
      if (!currentShareData) return;
      if (qrMode === 'url' && currentShareData.hasPin && currentShareData.pin) {
        qrMode = 'pin';
        renderQrCode(currentShareData.pin);
        qrToggleBtn.textContent = 'Switch to Link QR';
      } else {
        qrMode = 'url';
        renderQrCode(currentShareData.shareUrl);
        qrToggleBtn.textContent = 'Switch to PIN QR';
      }
    });
  }

  // Download QR Code image
  if (downloadQrBtn && qrCanvas) {
    downloadQrBtn.addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = `share-qr-${currentShareData ? currentShareData.token : 'code'}.png`;
      link.href = qrCanvas.toDataURL('image/png');
      link.click();
    });
  }

  // Copy buttons
  if (modalCopyUrlBtn) {
    modalCopyUrlBtn.addEventListener('click', () => {
      copyToClipboard(modalUrlInput.value, 'Share URL copied to clipboard!', modalCopyUrlBtn);
    });
  }

  if (modalCopyPinBtn) {
    modalCopyPinBtn.addEventListener('click', () => {
      copyToClipboard(modalPinDisplay.textContent, 'PIN copied to clipboard!', modalCopyPinBtn);
    });
  }

  if (modalCopyPasscodeBtn) {
    modalCopyPasscodeBtn.addEventListener('click', () => {
      copyToClipboard(modalPasscodeDisplay.value, 'Passcode copied to clipboard!', modalCopyPasscodeBtn);
    });
  }

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', () => {
      modalOverlay.classList.remove('active');
    });
  }

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.classList.remove('active');
    }
  });

  // Recent Shares Manager (Local History)
  function saveToRecentShares(share) {
    let recent = JSON.parse(localStorage.getItem('recent_shares') || '[]');
    recent.unshift({
      token: share.token,
      title: share.title || 'Untitled Share',
      shareUrl: share.shareUrl,
      pin: share.pin,
      hasPin: share.hasPin,
      passcode: share.passcode,
      hasPasscode: share.hasPasscode,
      expiresAt: share.expiresAt,
      createdAt: Date.now()
    });
    if (recent.length > 20) recent.pop();
    localStorage.setItem('recent_shares', JSON.stringify(recent));
  }

  function renderRecentShares() {
    const container = document.getElementById('recent-shares-list');
    if (!container) return;

    const recent = JSON.parse(localStorage.getItem('recent_shares') || '[]');
    if (recent.length === 0) {
      container.innerHTML = '<p style="color: var(--text-tertiary); text-align: center; padding: 32px 0;">No recent shares recorded in this browser.</p>';
      return;
    }

    container.innerHTML = '';
    recent.forEach((item) => {
      const isExpired = Date.now() > item.expiresAt;
      const el = document.createElement('div');
      el.className = 'card';
      el.style.marginBottom = '12px';
      el.style.padding = '16px';

      el.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h4 style="font-size:1rem; font-weight:600; color:var(--text-primary);">${escapeHtml(item.title)}</h4>
          <span style="font-size:0.75rem; padding:2px 8px; border-radius:var(--radius-pill); ${isExpired ? 'background:rgba(185,38,36,0.18); color:var(--color-primary);' : 'background:rgba(186,73,23,0.18); color:var(--color-light);'}">
            ${isExpired ? 'Expired' : 'Active'}
          </span>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:0.82rem; color:var(--text-secondary); margin-bottom:12px;">
          ${item.hasPin && item.pin ? `<span>PIN: <strong style="color:var(--text-primary);">${item.pin}</strong></span>` : ''}
          ${item.hasPasscode && item.passcode ? `<span>Passcode: <strong style="color:var(--text-primary);">${item.passcode}</strong></span>` : ''}
          <span>Token: <code style="font-family:var(--font-mono);">${item.token}</code></span>
        </div>
        <div style="display:flex; gap:8px;">
          <a href="/s/${item.token}" class="btn btn-secondary btn-sm" target="_blank">Open Link</a>
          <button type="button" class="btn btn-secondary btn-sm copy-recent-link-btn" data-url="${escapeHtml(item.shareUrl)}">Copy Link</button>
        </div>
      `;

      el.querySelector('.copy-recent-link-btn').addEventListener('click', (e) => {
        copyToClipboard(e.currentTarget.getAttribute('data-url'), 'Link copied to clipboard!', e.currentTarget);
      });

      container.appendChild(el);
    });
  }

  // -------------------------------------------------------------
  // Server Status & Settings Dialog
  // -------------------------------------------------------------
  async function checkServerStatus() {
    if (!serverStatusPill) return;

    const label = document.getElementById('server-status-label');
    const dot = serverStatusPill.querySelector('.status-dot');

    try {
      const { ok } = await window.CC_API.safeFetchJson('/api/shares/meta/generate-secrets');
      if (ok) {
        dot.className = 'status-dot online';
        const base = window.CC_API.getApiBase();
        label.textContent = base ? `Backend Connected (${base})` : 'Backend Connected';
        return;
      }
    } catch (e) {
      // Backend not responding directly
    }

    if (window.CC_API.isStaticHost()) {
      dot.className = 'status-dot standalone';
      label.textContent = 'Standalone Mode (VibeHost)';
    } else {
      dot.className = 'status-dot offline';
      label.textContent = 'Backend Offline';
    }
  }

  checkServerStatus();

  if (serverStatusPill && serverModal) {
    serverStatusPill.addEventListener('click', () => {
      serverUrlInput.value = window.CC_API.getApiBase() || '';
      if (serverFeedback) { serverFeedback.textContent = ''; serverFeedback.style.display = 'none'; }
      serverModal.classList.add('active');
    });
  }

  if (serverModalClose && serverModal) {
    serverModalClose.addEventListener('click', () => {
      serverModal.classList.remove('active');
    });
  }

  if (saveServerBtn) {
    saveServerBtn.addEventListener('click', () => {
      const val = serverUrlInput.value.trim();
      window.CC_API.setApiBase(val);
      serverModal.classList.remove('active');
      checkServerStatus();
      showToast(val ? `Backend URL set to ${val}` : 'Using default backend URL', 'success');
      loadSuggestedSecrets();
    });
  }

  if (testServerBtn) {
    testServerBtn.addEventListener('click', async () => {
      const orig = window.CC_API.getApiBase();
      const testVal = serverUrlInput.value.trim();
      window.CC_API.setApiBase(testVal);
      try {
        const { ok } = await window.CC_API.safeFetchJson('/api/shares/meta/generate-secrets');
        if (ok) {
          serverFeedback.className = 'alert alert-success';
          serverFeedback.textContent = '✓ Backend server reachable and responding!';
          serverFeedback.style.display = 'block';
        }
      } catch (err) {
        serverFeedback.className = 'alert alert-danger';
        serverFeedback.textContent = `✗ Cannot reach server: ${err.message}`;
        serverFeedback.style.display = 'block';
      } finally {
        window.CC_API.setApiBase(orig);
      }
    });
  }

  // Utilities
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function copyToClipboard(text, successMsg, buttonElement) {
    navigator.clipboard.writeText(text).then(() => {
      if (buttonElement) {
        const originalText = buttonElement.innerHTML;
        buttonElement.innerHTML = '<span>Copied ✓</span>';
        setTimeout(() => { buttonElement.innerHTML = originalText; }, 1800);
      }
      showToast(successMsg || 'Copied to clipboard!', 'success');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (buttonElement) {
        const originalText = buttonElement.innerHTML;
        buttonElement.innerHTML = '<span>Copied ✓</span>';
        setTimeout(() => { buttonElement.innerHTML = originalText; }, 1800);
      }
      showToast(successMsg || 'Copied to clipboard!', 'success');
    });
  }

  function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type === 'error') toast.style.borderColor = 'var(--color-primary)';
    if (type === 'success') toast.style.borderColor = 'var(--color-accent)';
    toast.textContent = message;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  window.showToast = showToast;
  window.copyToClipboard = copyToClipboard;
});
