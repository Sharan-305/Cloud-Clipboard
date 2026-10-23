/**
 * Quick Access Controller: Retrieve items via PIN, Passcode, or URL Token
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const subtabBtns = document.querySelectorAll('.access-subtab-btn');
  const subtabPanels = document.querySelectorAll('.access-subtab-panel');

  const pinForm = document.getElementById('pin-access-form');
  const pinInput = document.getElementById('access-pin-input');
  const pinSubmitBtn = document.getElementById('pin-submit-btn');
  const pinAlert = document.getElementById('pin-alert');

  const passcodeForm = document.getElementById('passcode-access-form');
  const passcodeInput = document.getElementById('access-passcode-input');
  const passcodeSubmitBtn = document.getElementById('passcode-submit-btn');
  const passcodeAlert = document.getElementById('passcode-alert');

  const urlForm = document.getElementById('url-access-form');
  const urlInput = document.getElementById('access-url-input');

  const retrievedContainer = document.getElementById('retrieved-item-container');

  // Subtab switching with ARIA synchronization & arrow key support
  function selectSubtab(btn) {
    subtabBtns.forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    subtabPanels.forEach(p => p.style.display = 'none');

    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const targetId = btn.getAttribute('data-subtab');
    const targetPanel = document.getElementById(targetId);
    if (targetPanel) targetPanel.style.display = 'block';

    clearAlerts();
  }

  subtabBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => selectSubtab(btn));
    btn.addEventListener('keydown', (e) => {
      let targetIndex = -1;
      if (e.key === 'ArrowRight') targetIndex = (index + 1) % subtabBtns.length;
      if (e.key === 'ArrowLeft') targetIndex = (index - 1 + subtabBtns.length) % subtabBtns.length;
      if (targetIndex !== -1) {
        e.preventDefault();
        subtabBtns[targetIndex].focus();
        selectSubtab(subtabBtns[targetIndex]);
      }
    });
  });

  function clearAlerts() {
    if (pinAlert) { pinAlert.style.display = 'none'; pinAlert.textContent = ''; }
    if (passcodeAlert) { passcodeAlert.style.display = 'none'; passcodeAlert.textContent = ''; }
  }

  function showAlert(alertEl, message, isWarning = false) {
    if (!alertEl) return;
    alertEl.className = isWarning ? 'alert alert-warning' : 'alert alert-danger';
    alertEl.textContent = message;
    alertEl.style.display = 'block';
  }

  // Handle Rate Limit Lockout Countdown
  function handleLockout(button, alertEl, seconds) {
    let remaining = seconds;
    button.disabled = true;

    const interval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(interval);
        button.disabled = false;
        alertEl.style.display = 'none';
      } else {
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        const timeStr = `${m}:${s < 10 ? '0' : ''}${s}`;
        showAlert(alertEl, `Too many failed attempts. Locked out for ${timeStr}`, true);
      }
    }, 1000);
  }

  // 1. PIN Access Handler
  if (pinForm) {
    pinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlerts();

      const pin = pinInput.value.trim();
      if (!pin) {
        showAlert(pinAlert, 'Please enter a PIN');
        return;
      }

      pinSubmitBtn.disabled = true;
      pinSubmitBtn.textContent = 'Verifying PIN...';

      try {
        const data = await window.CC_API.accessByPin(pin);

        if (!data || !data.success) {
          throw new Error((data && data.error) || 'Failed to verify PIN');
        }

        // Render share
        renderRetrievedShare(data.share);
        window.showToast('Item retrieved successfully!', 'success');
      } catch (err) {
        if (err.status === 429) {
          handleLockout(pinSubmitBtn, pinAlert, 600);
          return;
        }
        showAlert(pinAlert, err.message || 'Invalid PIN or error retrieving item');
      } finally {
        if (!pinSubmitBtn.disabled) {
          pinSubmitBtn.textContent = 'Unlock with PIN';
        }
      }
    });
  }

  // 2. Passcode Access Handler
  if (passcodeForm) {
    passcodeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlerts();

      const passcode = passcodeInput.value.trim();
      if (!passcode) {
        showAlert(passcodeAlert, 'Please enter a passcode');
        return;
      }

      passcodeSubmitBtn.disabled = true;
      passcodeSubmitBtn.textContent = 'Verifying Passcode...';

      try {
        const data = await window.CC_API.accessByPasscode(passcode);

        if (!data || !data.success) {
          throw new Error((data && data.error) || 'Failed to verify Passcode');
        }

        renderRetrievedShare(data.share);
        window.showToast('Item retrieved successfully!', 'success');
      } catch (err) {
        if (err.status === 429) {
          handleLockout(passcodeSubmitBtn, passcodeAlert, 600);
          return;
        }
        showAlert(passcodeAlert, err.message || 'Invalid Passcode or error retrieving item');
      } finally {
        if (!passcodeSubmitBtn.disabled) {
          passcodeSubmitBtn.textContent = 'Unlock with Passcode';
        }
      }
    });
  }

  // 3. Direct URL / Token Handler
  if (urlForm) {
    urlForm.addEventListener('submit', (e) => {
      e.preventDefault();
      let inputVal = urlInput.value.trim();
      if (!inputVal) return;

      if (inputVal.includes('/s/')) {
        const parts = inputVal.split('/s/');
        inputVal = parts[1];
      }

      window.location.href = `/s/${encodeURIComponent(inputVal)}`;
    });
  }

  // Render Retrieved Share UI
  function renderRetrievedShare(share) {
    if (!retrievedContainer) return;

    retrievedContainer.style.display = 'block';
    retrievedContainer.scrollIntoView({ behavior: 'smooth' });

    const timeLeftMin = Math.max(0, Math.round((share.expiresAt - Date.now()) / 60000));
    const downloadsLeft = share.maxDownloads !== null ? Math.max(0, share.maxDownloads - share.downloadCount) : 'Unlimited';

    let filesHtml = '';
    if (share.files && share.files.length > 0) {
      filesHtml = `
        <div style="margin-top: 20px;">
          <h4 style="font-size: 0.95rem; font-weight:600; margin-bottom: 12px; color: var(--color-light); display:flex; align-items:center; gap:8px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:16px; height:16px;">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>Attached Files (${share.files.length})</span>
          </h4>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${share.files.map(f => `
              <div class="file-item" style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:18px; height:18px; color:var(--color-accent); flex-shrink:0;">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <div>
                    <div style="font-weight:600; font-size:0.92rem; color:var(--text-primary);">${escapeHtml(f.original_name)}</div>
                    <div style="font-size:0.75rem; color:var(--text-tertiary); display:flex; gap:10px; margin-top:2px; font-family:var(--font-mono);">
                      <span>${formatBytes(f.file_size)}</span>
                      ${f.checksum_sha256 ? `<span title="SHA256: ${f.checksum_sha256}">SHA: ${f.checksum_sha256.slice(0, 8)}...</span>` : ''}
                    </div>
                  </div>
                </div>
                <button type="button" class="btn btn-accent btn-sm access-file-dl-btn" data-file-id="${f.id}" data-file-name="${escapeHtml(f.original_name)}">
                  <span>Download</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:14px; height:14px;">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    let textHtml = '';
    if (share.contentText) {
      textHtml = `
        <div style="margin-top: 18px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
            <h4 style="font-size: 0.95rem; font-weight:600; color: var(--color-light);">Shared Text / Clipboard</h4>
            <button type="button" class="btn btn-secondary btn-sm" id="copy-retrieved-text-btn">Copy Text</button>
          </div>
          <pre style="background:var(--color-surface-input); border:1px solid var(--border-subtle); padding:16px; border-radius:var(--radius-sm); font-family:var(--font-mono); font-size:0.9rem; line-height:1.6; white-space:pre-wrap; word-break:break-all; max-height:280px; overflow-y:auto; color:var(--text-primary);">${escapeHtml(share.contentText)}</pre>
        </div>
      `;
    }

    retrievedContainer.innerHTML = `
      <div class="card" style="border-color: var(--color-accent); box-shadow: var(--shadow-glow);">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-subtle); padding-bottom:12px; margin-bottom:14px;">
          <h3 style="font-size: 1.25rem; letter-spacing:-0.02em; color: var(--text-primary);">${escapeHtml(share.title || 'Shared Clipboard Item')}</h3>
          <span style="font-size:0.78rem; background:rgba(186,73,23,0.22); border:1px solid rgba(215,139,86,0.45); color:var(--color-light); padding:3px 10px; border-radius:var(--radius-pill); font-weight:600;">Active</span>
        </div>

        <div style="display:flex; gap:16px; font-size:0.84rem; color:var(--text-tertiary); margin-bottom:14px; font-variant-numeric: tabular-nums;">
          <span>Expires in: <strong style="color:var(--text-primary);">${timeLeftMin} mins</strong></span>
          <span>&middot;</span>
          <span>Downloads remaining: <strong style="color:var(--text-primary);">${downloadsLeft}</strong></span>
        </div>

        ${textHtml}
        ${filesHtml}
      </div>
    `;

    // Download handlers
    retrievedContainer.querySelectorAll('.access-file-dl-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const fileId = btn.getAttribute('data-file-id');
        const fileName = btn.getAttribute('data-file-name');
        window.CC_API.downloadFile(share.token, fileId, fileName, share.isStandalone).catch(err => {
          alert(err.message);
        });
      });
    });

    const copyBtn = document.getElementById('copy-retrieved-text-btn');
    if (copyBtn && share.contentText) {
      copyBtn.addEventListener('click', () => {
        window.copyToClipboard(share.contentText, 'Text copied to clipboard!', copyBtn);
      });
    }
  }

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
});
