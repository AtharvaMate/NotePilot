// NotePilot Content Script — injected into YouTube pages
// Provides video info to popup + capture button on YT player

(function () {
    'use strict';

    // ====== Message Listener (for extension popup) ======
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'getVideoInfo') {
            const video = document.querySelector('video');
            const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
                || document.querySelector('#title h1 yt-formatted-string')
                || document.querySelector('title');

            const ytTitle = titleEl
                ? (titleEl.textContent || '').replace(' - YouTube', '').trim()
                : '';

            const urlParams = new URLSearchParams(window.location.search);

            if (video) {
                const rect = video.getBoundingClientRect();
                sendResponse({
                    hasVideo: true,
                    currentTime: video.currentTime,
                    duration: video.duration,
                    title: ytTitle,
                    videoId: urlParams.get('v') || '',
                    rect: {
                        x: rect.x, y: rect.y,
                        width: rect.width, height: rect.height
                    },
                    devicePixelRatio: window.devicePixelRatio || 1
                });
            } else {
                sendResponse({
                    hasVideo: false,
                    title: ytTitle,
                    videoId: urlParams.get('v') || ''
                });
            }
            return true;
        }
    });

    // ====== YT Player Capture Button ======
    let captureInjected = false;

    function injectCaptureButton() {
        if (captureInjected) return;
        const controls = document.querySelector('.ytp-right-controls');
        if (!controls) return;
        if (document.querySelector('.np-capture-btn')) return;

        const btn = document.createElement('button');
        btn.className = 'np-capture-btn ytp-button';
        btn.title = 'NotePilot — Capture Frame';
        btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
        </svg>`;

        controls.prepend(btn);
        captureInjected = true;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            captureAndShowPopup();
        });
    }

    async function captureAndShowPopup() {
        const video = document.querySelector('video');
        if (!video) return showPlayerToast('No video found');

        const rect = video.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // Request screenshot from background service worker
        try {
            const response = await chrome.runtime.sendMessage({ action: 'captureVisibleTab' });
            if (!response || !response.success) {
                showPlayerToast('Capture failed — try again');
                return;
            }

            // Crop to video area
            const snapshot = await cropToVideo(response.dataUrl, rect, dpr);

            const t = Math.floor(video.currentTime);
            const label = `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;

            showNotePopup(snapshot, label, t);
        } catch (err) {
            console.error('NotePilot capture error:', err);
            showPlayerToast('Capture failed');
        }
    }

    function cropToVideo(dataUrl, rect, dpr) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                const sx = Math.round(rect.x * dpr);
                const sy = Math.round(rect.y * dpr);
                const sw = Math.round(rect.width * dpr);
                const sh = Math.round(rect.height * dpr);
                c.width = sw; c.height = sh;
                c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
                resolve(c.toDataURL('image/jpeg', 0.88));
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    // ====== Note Popup Overlay ======
    function showNotePopup(snapshot, label, videoTime) {
        // Remove existing popup
        const existing = document.getElementById('np-popup-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'np-popup-overlay';
        overlay.innerHTML = `
            <div id="np-popup">
                <div class="np-popup-header">
                    <div class="np-popup-title">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                        </svg>
                        NOTEPILOT CAPTURE
                    </div>
                    <button class="np-popup-close" id="np-popup-close">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="np-popup-preview">
                    <img src="${snapshot}" alt="Captured frame"/>
                    <div class="np-popup-badge">${label}</div>
                </div>
                <textarea class="np-popup-note" id="np-popup-note" placeholder="Add your note for this frame..." rows="3"></textarea>
                <div class="np-popup-actions">
                    <button class="np-popup-btn np-popup-cancel" id="np-popup-cancel">Cancel</button>
                    <button class="np-popup-btn np-popup-save" id="np-popup-save">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Save Note
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('np-visible'));

        // Focus textarea
        setTimeout(() => document.getElementById('np-popup-note').focus(), 300);

        // Close handlers
        document.getElementById('np-popup-close').onclick = () => closePopup(overlay);
        document.getElementById('np-popup-cancel').onclick = () => closePopup(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closePopup(overlay);
        });

        // Save handler
        document.getElementById('np-popup-save').onclick = async () => {
            const note = document.getElementById('np-popup-note').value;
            await saveCapture(snapshot, label, videoTime, note);
            closePopup(overlay);
            showPlayerToast('✓ Captured & saved!');
        };

        // Escape key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closePopup(overlay);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    function closePopup(overlay) {
        overlay.classList.remove('np-visible');
        setTimeout(() => overlay.remove(), 250);
    }

    // ====== Save Capture to chrome.storage ======
    async function saveCapture(snapshot, label, videoTime, note) {
        const urlParams = new URLSearchParams(window.location.search);
        const vId = urlParams.get('v') || '';
        if (!vId) return;

        const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
            || document.querySelector('#title h1 yt-formatted-string')
            || document.querySelector('title');
        const ytTitle = titleEl ? (titleEl.textContent || '').replace(' - YouTube', '').trim() : '';

        const key = `np_${vId}`;
        const result = await chrome.storage.local.get(key);
        const data = result[key] || {
            timestamps: [],
            aiResponses: [],
            videoTitle: ytTitle,
            videoId: vId,
            pdfTitleVal: ytTitle,
            savedAt: Date.now()
        };

        data.timestamps.push({
            id: Date.now().toString(),
            timestamp: label,
            videoTime: videoTime,
            note: note || '',
            snapshot: snapshot,
            ocrText: ''
        });
        data.savedAt = Date.now();

        await chrome.storage.local.set({ [key]: data });
    }

    // ====== Player Toast ======
    function showPlayerToast(msg) {
        let toast = document.getElementById('np-player-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'np-player-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('np-toast-visible');
        setTimeout(() => toast.classList.remove('np-toast-visible'), 2000);
    }

    // ====== Injection Lifecycle (YouTube SPA) ======
    function tryInject() {
        if (window.location.pathname === '/watch') {
            injectCaptureButton();
        }
    }

    // Re-inject on SPA navigation
    const observer = new MutationObserver(() => tryInject());
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial injection with retries (YT loads controls dynamically)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInject);
    } else {
        setTimeout(tryInject, 1000);
        setTimeout(tryInject, 2500);
        setTimeout(tryInject, 5000);
    }
})();
