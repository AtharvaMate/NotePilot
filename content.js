// NotePilot Content Script — injected into YouTube pages
// Provides video info to popup + capture button on YT player

(function () {
    'use strict';


    // ====== Message Listener (for extension popup) ======
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

        // ── Transcript fetcher: reads caption track URLs from ytInitialPlayerResponse ──
        if (msg.action === 'getTranscript') {
            (async () => {
                try {
                    // 1. Get player data (already in page memory)
                    const playerData = window.ytInitialPlayerResponse || (() => {
                        for (const s of document.querySelectorAll('script')) {
                            const m = s.textContent.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
                            if (m) { try { return JSON.parse(m[1]); } catch { continue; } }
                        }
                        return null;
                    })();

                    if (!playerData) { sendResponse({ success: false, text: '', reason: 'no_player_data' }); return; }

                    const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                    if (!tracks?.length) { sendResponse({ success: false, text: '', reason: 'no_captions' }); return; }

                    // 2. Pick best English track (manual > auto-generated > any)
                    const rank = t => {
                        const lc = (t.languageCode || '').toLowerCase();
                        const isEn = lc.startsWith('en');
                        const isAsr = t.kind === 'asr' || (t.vssId || '').startsWith('a.');
                        if (isEn && !isAsr) return 0;
                        if (isEn && isAsr) return 1;
                        if (!isAsr) return 2;
                        return 3;
                    };
                    const track = [...tracks].sort((a, b) => rank(a) - rank(b))[0];
                    if (!track?.baseUrl) { sendResponse({ success: false, text: '', reason: 'no_track_url' }); return; }

                    // 3. Fetch as json3
                    const url = track.baseUrl.replace(/[&?]fmt=[^&]*/g, '') +
                        (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3';
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();

                    if (!data?.events?.length) { sendResponse({ success: false, text: '', reason: 'empty_events' }); return; }

                    // 4. Flatten to plain text
                    const text = data.events
                        .filter(e => Array.isArray(e.segs))
                        .map(e => e.segs.map(s => (s.utf8 || '').replace(/\n/g, ' ')).join(''))
                        .join(' ')
                        .replace(/\s{2,}/g, ' ')
                        .trim();

                    sendResponse({ success: true, text, trackKind: track.kind || 'manual', langCode: track.languageCode || 'en' });
                } catch (err) {
                    sendResponse({ success: false, text: '', reason: err.message });
                }
            })();
            return true; // keep channel open
        }

        if (msg.action === 'seekTo') {
            const video = document.querySelector('video');
            if (video) {
                video.currentTime = msg.time;
                video.play();
            }
            sendResponse({ success: !!video });
            return true;
        }

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
                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    devicePixelRatio: window.devicePixelRatio || 1
                });
            } else {
                sendResponse({ hasVideo: false, title: ytTitle, videoId: urlParams.get('v') || '' });
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
        try {
            const response = await chrome.runtime.sendMessage({ action: 'captureVisibleTab' });
            if (!response || !response.success) { showPlayerToast('Capture failed — try again'); return; }
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
                const sx = Math.round(rect.x * dpr), sy = Math.round(rect.y * dpr);
                const sw = Math.round(rect.width * dpr), sh = Math.round(rect.height * dpr);
                c.width = sw; c.height = sh;
                c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
                resolve(c.toDataURL('image/jpeg', 0.88));
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    function showNotePopup(snapshot, label, videoTime) {
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
        setTimeout(() => document.getElementById('np-popup-note').focus(), 300);

        document.getElementById('np-popup-close').onclick = () => closePopup(overlay);
        document.getElementById('np-popup-cancel').onclick = () => closePopup(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup(overlay); });

        document.getElementById('np-popup-save').onclick = async () => {
            const note = document.getElementById('np-popup-note').value;
            await saveCapture(snapshot, label, videoTime, note);
            closePopup(overlay);
            showPlayerToast('✓ Captured & saved!');
        };

        const escHandler = (e) => {
            if (e.key === 'Escape') { closePopup(overlay); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);
    }

    function closePopup(overlay) {
        overlay.classList.remove('np-visible');
        setTimeout(() => overlay.remove(), 250);
    }

    // Backend URL — must match config.js
    const CONTENT_BACKEND_URL = 'http://localhost:3001';

    async function saveCapture(snapshot, label, videoTime, note) {
        const urlParams = new URLSearchParams(window.location.search);
        const vId = urlParams.get('v') || '';
        if (!vId) return;

        const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
            || document.querySelector('#title h1 yt-formatted-string')
            || document.querySelector('title');
        const ytTitle = titleEl ? (titleEl.textContent || '').replace(' - YouTube', '').trim() : '';

        try {
            // Load existing data from backend
            const loadRes = await fetch(`${CONTENT_BACKEND_URL}/api/videos/${vId}`);
            const existing = await loadRes.json();
            const timestamps = existing?.timestamps || [];
            const aiResponses = existing?.aiResponses || [];

            timestamps.push({
                id: Date.now().toString(), timestamp: label, videoTime,
                note: note || '', snapshot, ocrText: ''
            });

            // Save back to backend
            await fetch(`${CONTENT_BACKEND_URL}/api/videos/${vId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoTitle: ytTitle,
                    timestamps,
                    aiResponses,
                    pdfTitleVal: ytTitle
                })
            });
        } catch (err) {
            console.error('[NotePilot] saveCapture error:', err);
        }
    }

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

    function tryInject() {
        if (window.location.pathname === '/watch') injectCaptureButton();
    }

    const observer = new MutationObserver(() => tryInject());
    observer.observe(document.body, { childList: true, subtree: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInject);
    } else {
        setTimeout(tryInject, 1000);
        setTimeout(tryInject, 2500);
        setTimeout(tryInject, 5000);
    }
})();