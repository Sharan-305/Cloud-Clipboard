/**
 * View / Download Shared Item Page Controller
 * Supports Direct URL, Passcode Unlock, and Standalone Hash/IndexedDB shares.
 */
document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  const pathParts = window.location.pathname.split('/');
  const tokenIndex = pathParts.indexOf('s') + 1;
  const token = (tokenIndex > 0 && pathParts[tokenIndex]) ? pathParts[tokenIndex] : null;

  const loadingEl = document.getElementById('view-loading');
  const errorEl = document.getElementById('view-error');
  const unlockCard = document.getElementById('view-unlock-card');
  const contentCard = document.getElementById('view-content-card');
  const passcodeForm = document.getElementById('unlock-passcode-form');
  const passcodeInput = document.getElementById('unlock-passcode-input');
  const unlockSubmitBtn = document.getElementById('unlock-submit-btn');
  const unlockAlert = document.getElementById('unlock-alert');

  if (!token) {
    showError('Invalid share link: no token provided.');
    return;
  }

  try {
    const data = await window.CC_API.getShareByToken(token, window.location.hash);

    if (!data.success) {
      showError(data.error || 'Share not found or expired.');
      return;
    }

    const share = data.share;
    loadingEl.style.display = 'none';

    if (share.isLocked) {
      // Passcode required
      unlockCard.style.display = 'block';
      setupUnlockHandler(share);
    } else {
      // Direct access allowed
      renderShareContent(share);
    }

  } catch (err) {
    showError(err.message || 'Error connecting to share service.');
  }

  function showError(msg) {
    loadingEl.style.display = 'none';
    unlockCard.style.display = 'none';
    contentCard.style.display = 'none';
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }

  function setupUnlockHandler(share) {
    if (!passcodeForm) return;

    passcodeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      unlockAlert.style.display = 'none';

      const passcode = passcodeInput.value.trim();
      if (!passcode) {
        unlockAlert.textContent = 'Please enter the passcode';
        unlockAlert.style.display = 'block';
        return;
      }

      unlockSubmitBtn.disabled = true;
      unlockSubmitBtn.textContent = 'Verifying...';

      try {
        const data = await window.CC_API.unlockShare(token, passcode);

        if (!data.success) {
          throw new Error(data.error || 'Incorrect passcode');
        }

        // Unlocked!
        unlockCard.style.display = 'none';
        renderShareContent(data.share, passcode);

      } catch (err) {
        unlockAlert.textContent = err.message || 'Incorrect passcode or error unlocking';
        unlockAlert.style.display = 'block';
      } finally {
        unlockSubmitBtn.disabled = false;
        unlockSubmitBtn.textContent = 'Unlock Share';
      }
    });
  }

  function renderShareContent(share, verifiedPasscode = null) {
    contentCard.style.display = 'block';

    const titleEl = document.getElementById('view-title');
    const expiryEl = document.getElementById('view-expiry');
    const downloadsEl = document.getElementById('view-downloads');
    const textContainer = document.getElementById('view-text-container');
    const textContent = document.getElementById('view-text-content');
    const copyTextBtn = document.getElementById('view-copy-text-btn');
    const filesContainer = document.getElementById('view-files-container');
    const fileList = document.getElementById('view-file-list');

    // Title
    titleEl.textContent = share.title || 'Shared Clipboard Item';

    // Expiry badge
    const timeLeftMin = Math.max(0, Math.round((share.expiresAt - Date.now()) / 60000));
    expiryEl.querySelector('span').textContent = `Expires in ${timeLeftMin} mins`;

    // Download limits
    if (share.maxDownloads !== null) {
      const remaining = Math.max(0, share.maxDownloads - share.downloadCount);
      downloadsEl.querySelector('span').textContent = `${remaining} download${remaining === 1 ? '' : 's'} remaining`;
    } else {
      downloadsEl.querySelector('span').textContent = 'Unlimited downloads';
    }

    // Text content
    if (share.contentText) {
      textContainer.style.display = 'block';
      textContent.textContent = share.contentText;

      copyTextBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(share.contentText);
          const orig = copyTextBtn.textContent;
          copyTextBtn.textContent = 'Copied ✓';
          setTimeout(() => { copyTextBtn.textContent = orig; }, 1800);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = share.contentText;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          copyTextBtn.textContent = 'Copied ✓';
        }
      });
    }

    // Files list
    if (share.files && share.files.length > 0) {
      filesContainer.style.display = 'block';
      fileList.innerHTML = '';

      share.files.forEach(f => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';

        item.innerHTML = `
          <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width: 18px; height: 18px; color: var(--color-accent); flex-shrink: 0;">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            <div style="overflow: hidden;">
              <div style="font-weight: 600; font-size: 0.92rem; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(f.original_name)}</div>
              <div style="font-size: 0.75rem; color: var(--text-tertiary); display: flex; gap: 10px; margin-top: 2px; font-family: var(--font-mono);">
                <span>${formatBytes(f.file_size)}</span>
                ${f.checksum_sha256 ? `<span>SHA: ${f.checksum_sha256.slice(0, 8)}...</span>` : ''}
              </div>
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm view-file-dl-btn" data-file-id="${f.id}" data-file-name="${escapeHtml(f.original_name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width: 14px; height: 14px;">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>Download</span>
          </button>
        `;

        const dlBtn = item.querySelector('.view-file-dl-btn');
        dlBtn.addEventListener('click', (e) => {
          e.preventDefault();
          window.CC_API.downloadFile(share.token, f.id, f.original_name, share.isStandalone).catch(err => {
            alert(err.message);
          });
        });

        fileList.appendChild(item);
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
