// ============ CONFIG ============
const BACKEND_URL = (typeof NOTEPILOT_CONFIG !== 'undefined' && NOTEPILOT_CONFIG.BACKEND_URL)
    ? NOTEPILOT_CONFIG.BACKEND_URL.replace(/\/$/, '') : 'http://localhost:3001';
const ROOM_VIEWER_URL = (typeof NOTEPILOT_CONFIG !== 'undefined' && NOTEPILOT_CONFIG.ROOM_VIEWER_URL)
    ? NOTEPILOT_CONFIG.ROOM_VIEWER_URL.replace(/\/$/, '') : '';
const GOOGLE_CLIENT_ID = (typeof NOTEPILOT_CONFIG !== 'undefined' && NOTEPILOT_CONFIG.GOOGLE_CLIENT_ID)
    ? NOTEPILOT_CONFIG.GOOGLE_CLIENT_ID : '';

// ============ AUTH ============
let authToken = localStorage.getItem('np_token') || '';
let currentUser = null;

function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (authToken) h['Authorization'] = `Bearer ${authToken}`;
    return h;
}

// ============ AI HELPER (via backend proxy) ============
async function callAI(messages, opts = {}) {
    const res = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ messages, temperature: opts.temperature ?? 0.7, max_tokens: opts.max_tokens ?? 1024 })
    });
    if (!res.ok) {
        const errBody = await res.text();
        let detail = '';
        try { detail = JSON.parse(errBody)?.error?.message || errBody; } catch (_) { detail = errBody; }
        throw new Error(`${res.status} — ${detail.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data.text) throw new Error('Empty response from AI');
    return data.text;
}

async function callAIVision(messages, opts = {}) {
    const res = await fetch(`${BACKEND_URL}/api/ai/vision`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ messages, temperature: opts.temperature ?? 0.1, max_tokens: opts.max_tokens ?? 1024 })
    });
    if (!res.ok) {
        const errBody = await res.text();
        let detail = '';
        try { detail = JSON.parse(errBody)?.error?.message || errBody; } catch (_) { detail = errBody; }
        throw new Error(`${res.status} — ${detail.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data.text) throw new Error('Empty response from AI');
    return data.text;
}

// ============ STATE ============
let videoId = '';
let videoTitle = '';
let timestamps = [];
let aiResponses = [];
let sharedRoomId = '';   // persisted per video — reused on every share

// ============ HELPERS ============
function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'); }

// ============ DOM ============
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const videoBar = document.getElementById('video-bar');
const vidTitleEl = document.getElementById('vid-title');
const captureBtn = document.getElementById('capture-btn');
const notesList = document.getElementById('notes-list');
const emptyNotes = document.getElementById('empty-notes');
const notesCount = document.getElementById('notes-count');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const pdfTitle = document.getElementById('pdf-title');
const exportBtn = document.getElementById('export-btn');
const toasts = document.getElementById('toasts');

// Auth DOM
const authOverlay = document.getElementById('auth-overlay');
const authTitle = document.getElementById('auth-title');
const authError = document.getElementById('auth-error');
const authNameInput = document.getElementById('auth-name');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authToggleText = document.getElementById('auth-toggle-text');
const authToggleLink = document.getElementById('auth-toggle-link');
const googleSignInBtn = document.getElementById('google-signin-btn');
const userInfoEl = document.getElementById('user-info');
const logoutBtn = document.getElementById('logout-btn');
let authMode = 'login'; // 'login' or 'register'

// ============ AUTH UI ============
function showAuthOverlay() {
    authOverlay.style.display = 'flex';
}
function hideAuthOverlay() {
    authOverlay.style.display = 'none';
}
function setAuthError(msg) {
    authError.textContent = msg;
    authError.style.display = msg ? 'block' : 'none';
}
function toggleAuthMode() {
    authMode = authMode === 'login' ? 'register' : 'login';
    if (authMode === 'register') {
        authTitle.textContent = 'Create your account';
        authSubmitBtn.textContent = 'Register';
        authToggleText.textContent = 'Already have an account?';
        authToggleLink.textContent = ' Sign In';
        authNameInput.style.display = 'block';
    } else {
        authTitle.textContent = 'Sign in to continue';
        authSubmitBtn.textContent = 'Sign In';
        authToggleText.textContent = "Don't have an account?";
        authToggleLink.textContent = ' Register';
        authNameInput.style.display = 'none';
    }
    setAuthError('');
}
authToggleLink.addEventListener('click', (e) => { e.preventDefault(); toggleAuthMode(); });

async function handleAuthSubmit() {
    const email = authEmailInput.value.trim();
    const password = authPasswordInput.value;
    const name = authNameInput.value.trim();
    if (!email || !password) { setAuthError('Email and password required'); return; }
    if (authMode === 'register' && password.length < 6) { setAuthError('Password must be at least 6 characters'); return; }

    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = 'Please wait...';
    setAuthError('');

    try {
        const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
        const body = authMode === 'register' ? { email, password, name } : { email, password };
        const res = await fetch(`${BACKEND_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { setAuthError(data.error || 'Auth failed'); return; }

        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('np_token', authToken);
        // Sync token to chrome.storage so content scripts on youtube.com can access it
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ np_token: authToken });
        }
        hideAuthOverlay();
        showUserInfo();
        detectVideo();
    } catch (err) {
        setAuthError('Network error — is the server running?');
    } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = authMode === 'register' ? 'Register' : 'Sign In';
    }
}
authSubmitBtn.addEventListener('click', handleAuthSubmit);
authPasswordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAuthSubmit(); });

// Google auth via chrome.identity.launchWebAuthFlow
googleSignInBtn.addEventListener('click', async () => {
    if (!GOOGLE_CLIENT_ID) {
        showToast('Google Sign-In requires a Client ID. Set up OAuth in Google Cloud Console.', 'warn');
        return;
    }

    googleSignInBtn.disabled = true;
    const origBtnHtml = googleSignInBtn.innerHTML;
    googleSignInBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Signing in...';
    setAuthError('');

    try {
        const redirectUrl = chrome.identity.getRedirectURL();
        const nonce = Math.random().toString(36).substring(2) + Date.now().toString(36);

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
        authUrl.searchParams.set('response_type', 'id_token');
        authUrl.searchParams.set('redirect_uri', redirectUrl);
        authUrl.searchParams.set('scope', 'openid email profile');
        authUrl.searchParams.set('nonce', nonce);
        authUrl.searchParams.set('prompt', 'select_account');

        const responseUrl = await chrome.identity.launchWebAuthFlow({
            url: authUrl.toString(),
            interactive: true
        });

        // Extract id_token from the redirect URL hash fragment
        const hashParams = new URLSearchParams(new URL(responseUrl).hash.substring(1));
        const idToken = hashParams.get('id_token');

        if (!idToken) throw new Error('No ID token received from Google');

        // Send the Google ID token to the backend for verification
        const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: idToken })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Google auth failed');

        // Store session
        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('np_token', authToken);
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ np_token: authToken });
        }
        hideAuthOverlay();
        showUserInfo();
        detectVideo();
        showToast(`Welcome, ${currentUser.name || currentUser.email}!`, 'success');
    } catch (err) {
        // User closed popup — not an error
        if (err.message && (err.message.includes('canceled') || err.message.includes('cancelled') || err.message.includes('closed'))) {
            // silently ignore
        } else {
            setAuthError('Google Sign-In failed: ' + (err.message || 'Unknown error').slice(0, 120));
        }
    } finally {
        googleSignInBtn.disabled = false;
        googleSignInBtn.innerHTML = origBtnHtml;
    }
});

function showUserInfo() {
    if (currentUser) {
        userInfoEl.textContent = currentUser.name || currentUser.email;
        userInfoEl.style.display = 'block';
        logoutBtn.style.display = 'inline-flex';
    }
}
logoutBtn.addEventListener('click', () => {
    authToken = '';
    currentUser = null;
    localStorage.removeItem('np_token');
    // Clear from chrome.storage too
    if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.remove('np_token');
    }
    userInfoEl.style.display = 'none';
    logoutBtn.style.display = 'none';
    showAuthOverlay();
});

// ============ INIT ============
document.addEventListener('DOMContentLoaded', init);

async function init() {
    setupShareModal();

    // Check if logged in
    if (authToken) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/auth/me`, { headers: authHeaders() });
            if (res.ok) {
                currentUser = await res.json();
                hideAuthOverlay();
                showUserInfo();
                detectVideo();
            } else {
                // Token invalid
                authToken = '';
                localStorage.removeItem('np_token');
                showAuthOverlay();
            }
        } catch (e) {
            showAuthOverlay();
        }
    } else {
        showAuthOverlay();
    }
}

async function detectVideo() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes('youtube.com/watch')) {
            setStatus(false, 'Open a YouTube video'); return;
        }
        const info = await chrome.tabs.sendMessage(tab.id, { action: 'getVideoInfo' });
        if (info && (info.hasVideo || info.videoId)) {
            videoId = info.videoId || '';
            videoTitle = info.title || '';
            setStatus(true, 'Video detected');
            videoBar.style.display = 'flex';
            vidTitleEl.textContent = videoTitle || 'YouTube Video';
            await loadData();
        } else { setStatus(false, 'No video found'); }
    } catch (err) { setStatus(false, 'Refresh YouTube tab'); }
}

function setStatus(online, text) {
    statusEl.className = `status ${online ? 'online' : 'offline'}`;
    statusText.textContent = text;
}

// ============ PERSISTENCE (Backend API with auth) ============
async function saveData() {
    if (!videoId || !authToken) return;
    try {
        await fetch(`${BACKEND_URL}/api/videos/${videoId}`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({
                videoTitle, timestamps, aiResponses,
                pdfTitleVal: pdfTitle.value,
                sharedRoomId
            })
        });
        // Keep shared room in sync (debounced to avoid excessive calls)
        debouncedSyncAllNotesToRoom();
    } catch (e) { console.error('Save error:', e); }
}

async function loadData() {
    if (!videoId) return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/videos/${videoId}`, { headers: authHeaders() });
        const data = await res.json();
        if (data) {
            timestamps = data.timestamps || [];
            aiResponses = data.aiResponses || [];
            sharedRoomId = data.sharedRoomId || '';
            if (data.videoTitle) videoTitle = data.videoTitle;
            if (data.pdfTitleVal) pdfTitle.value = data.pdfTitleVal;
            vidTitleEl.textContent = videoTitle || 'YouTube Video';

            renderNotes();
            updateExport();
            updateShareLiveIndicator();

            aiResponses.forEach((qa, idx) => {
                addMsg('user', qa.question);
                addMsg('bot', qa.answer, false, idx);
            });
            if (timestamps.length || aiResponses.length) {
                showToast(`Restored ${timestamps.length} notes`, 'info');
            }
        }
    } catch (e) { console.error('Load error:', e); }
}

// ============ TABS ============
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`panel-${tab.dataset.panel}`).classList.add('active');
    });
});

// ============ CAPTURE ============
captureBtn.addEventListener('click', captureSnapshot);

async function captureSnapshot() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url?.includes('youtube.com/watch')) { showToast('Open a YouTube video first', 'error'); return; }
        const info = await chrome.tabs.sendMessage(tab.id, { action: 'getVideoInfo' });
        if (!info || !info.hasVideo) { showToast('Video not playing yet', 'error'); return; }
        const screenshot = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 92 });
        const frame = await cropToVideo(screenshot, info.rect, info.devicePixelRatio);
        const t = Math.floor(info.currentTime);
        const label = `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
        if (info.title && !videoTitle) { videoTitle = info.title; vidTitleEl.textContent = videoTitle; }
        timestamps.push({ id: Date.now().toString(), timestamp: label, videoTime: t, note: '', snapshot: frame, ocrText: '' });
        renderNotes();
        updateExport();
        await saveData();
        pushNoteToRoom(timestamps[timestamps.length - 1]);  // live-sync if room active
        showToast(`Captured at ${label}`, 'success');
    } catch (err) { showToast('Capture failed — try refreshing YouTube', 'error'); }
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

// ============ KATEX + MARKDOWN RENDERING ============
function formatMarkdown(html) {
    html = html.replace(/^(#{1,3})\s+(.+)$/gm, (m, h, content) => {
        const sz = h.length === 1 ? '1em' : h.length === 2 ? '.92em' : '.85em';
        return `<strong style="display:block;font-size:${sz};margin:.3em 0 .15em">${content}</strong>`;
    });
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\[Diagram:\s*(.+?)\]/gi, '<span class="diagram-tag">[Diagram: $1]</span>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

function renderWithMath(text) {
    if (typeof katex === 'undefined') return formatMarkdown(escapeHtml(text));
    const parts = [];
    let lastIndex = 0;
    const regex = /\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) parts.push(formatMarkdown(escapeHtml(text.slice(lastIndex, match.index))));
        const displayMath = match[1], inlineMath = match[2];
        try {
            if (displayMath !== undefined) {
                parts.push(katex.renderToString(displayMath.trim(), { displayMode: true, throwOnError: false }));
            } else {
                parts.push(katex.renderToString(inlineMath.trim(), { displayMode: false, throwOnError: false }));
            }
        } catch (e) { parts.push(escapeHtml(match[0])); }
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) parts.push(formatMarkdown(escapeHtml(text.slice(lastIndex))));
    return parts.join('');
}

function stripMathDelimiters(text) {
    if (!text) return '';
    return text.replace(/\$\$([\s\S]*?)\$\$/g, '$1').replace(/\$([^\$\n]+?)\$/g, '$1');
}

// ============ MATH → IMAGE (PDF) ============
async function mathExprToImage(formula, isDisplay, pdfFontSizePt = 9) {
    if (typeof katex === 'undefined' || typeof html2canvas === 'undefined') return null;
    const RENDER_SCALE = 3;
    const FONT_PX = Math.round(pdfFontSizePt * (96 / 72));
    const PX_TO_MM = 25.4 / 96;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
        'position:fixed', 'left:-99999px', 'top:-99999px', 'background:#ffffff', 'color:#111119',
        `font-size:${FONT_PX}px`, `display:${isDisplay ? 'block' : 'inline-block'}`,
        `padding:${isDisplay ? '2px 4px' : '1px 2px'}`, 'line-height:1.2', 'white-space:nowrap', 'z-index:-1'
    ].join(';');
    try {
        katex.render(formula, wrapper, { displayMode: isDisplay, throwOnError: false, output: 'html', trust: false });
    } catch (e) { return null; }
    wrapper.querySelectorAll('*').forEach(el => { el.style.color = '#111119'; el.style.borderColor = '#111119'; });
    document.body.appendChild(wrapper);
    try {
        const canvas = await html2canvas(wrapper, { backgroundColor: '#ffffff', scale: RENDER_SCALE, logging: false, useCORS: false, allowTaint: false, removeContainer: false });
        document.body.removeChild(wrapper);
        return { dataUrl: canvas.toDataURL('image/png'), widthMm: (canvas.width / RENDER_SCALE) * PX_TO_MM, heightMm: (canvas.height / RENDER_SCALE) * PX_TO_MM };
    } catch (e) {
        if (document.body.contains(wrapper)) document.body.removeChild(wrapper);
        return null;
    }
}

async function addTextWithNativeMathPdf(pdf, fullText, x, y, maxW, fontSize, r, g, b, ph, m) {
    pdf.setFontSize(fontSize);
    pdf.setTextColor(r, g, b);
    const LH = fontSize * 0.43;
    const PG = LH * 0.6;
    const ensurePage = need => { if (y + need > ph - m) { pdf.addPage(); y = m; } };
    const spW = () => pdf.getTextWidth(' ');
    const tokeniseLine = line => {
        const segs = [];
        const re = /\$([^\$\n]+?)\$/g;
        let last = 0, mm;
        while ((mm = re.exec(line)) !== null) {
            if (mm.index > last) segs.push({ type: 'text', content: line.slice(last, mm.index) });
            segs.push({ type: 'math', content: mm[1].trim() });
            last = mm.index + mm[0].length;
        }
        if (last < line.length) segs.push({ type: 'text', content: line.slice(last) });
        return segs;
    };
    const paragraphs = fullText.split(/\n\n+/);
    for (let pi = 0; pi < paragraphs.length; pi++) {
        for (const rawLine of paragraphs[pi].split('\n')) {
            const line = rawLine.trim();
            if (!line) continue;
            const disp = line.match(/^\$\$([\s\S]*?)\$\$$/);
            if (disp) {
                const im = await mathExprToImage(disp[1].trim(), true, fontSize * 1.15);
                ensurePage((im?.heightMm ?? LH) + 5);
                if (im) { pdf.addImage(im.dataUrl, 'PNG', x + (maxW - im.widthMm) / 2, y + 0.5, im.widthMm, im.heightMm); y += im.heightMm + 3; }
                else { pdf.setTextColor(80, 80, 200); const tl = pdf.splitTextToSize(disp[1].trim(), maxW); pdf.text(tl, x + maxW / 2, y, { align: 'center' }); pdf.setTextColor(r, g, b); y += tl.length * LH + 2; }
                continue;
            }
            const hm = line.match(/^(#{1,3})\s+(.+)$/);
            if (hm) {
                const hSz = fontSize + (4 - hm[1].length) * 1.5;
                ensurePage(hSz * 0.45 + 2);
                pdf.setFontSize(hSz); pdf.setFont(undefined, 'bold'); pdf.setTextColor(r, g, b);
                const ht = hm[2].replace(/\*\*(.*?)\*\*/g, '$1').replace(/\$([^$]*)\$/g, '$1');
                const hl = pdf.splitTextToSize(ht, maxW);
                pdf.text(hl, x, y); y += hl.length * (hSz * 0.43) + 1;
                pdf.setFont(undefined, 'normal'); pdf.setFontSize(fontSize); pdf.setTextColor(r, g, b);
                continue;
            }
            let indent = 0, prefix = '', content = line;
            const bm = line.match(/^[-•*]\s+(.+)$/), nm = line.match(/^(\d+)\.\s+(.+)$/);
            if (bm) { indent = 4; prefix = '-'; content = bm[1]; }
            else if (nm) { indent = 4; prefix = nm[1] + '.'; content = nm[2]; }
            const indentX = x + indent;
            const hasMath = /\$/.test(content);
            ensurePage(LH + 2);
            if (!hasMath) {
                const clean = content.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`(.*?)`/g, '$1');
                if (prefix) { pdf.setTextColor(r, g, b); pdf.text(prefix, x, y); }
                const tl = pdf.splitTextToSize(clean, maxW - indent);
                pdf.text(tl, indentX, y); y += tl.length * LH;
            } else {
                const segs = tokeniseLine(content);
                const preImages = new Map();
                for (const seg of segs) { if (seg.type === 'math' && !preImages.has(seg.content)) preImages.set(seg.content, await mathExprToImage(seg.content, false, fontSize)); }
                const ABOVE = 0.78;
                let srcMaxH = 0;
                for (const im of preImages.values()) { if (im && im.heightMm > srcMaxH) srcMaxH = im.heightMm; }
                const extraAbove = Math.max(0, srcMaxH * ABOVE - LH * 0.8);
                const extraBelow = Math.max(0, srcMaxH * (1 - ABOVE) - LH * 0.2);
                const mathLH = LH + extraAbove + extraBelow;
                const newlineWithSpace = () => { st.ly += mathLH; ensurePage(mathLH + extraAbove); st.cx = indentX; };
                if (extraAbove > 0) { y += extraAbove; ensurePage(extraAbove); }
                if (prefix) { pdf.setTextColor(r, g, b); pdf.text(prefix, x, y); }
                const st = { cx: indentX, ly: y };
                for (const seg of segs) {
                    if (seg.type === 'text') {
                        const words = seg.content.replace(/\*\*(.*?)\*\*/g, '$1').split(/(\s+)/);
                        for (const w of words) {
                            if (!w) continue;
                            if (/^\s+$/.test(w)) { st.cx += spW(); continue; }
                            const ww = pdf.getTextWidth(w);
                            if (st.cx + ww > x + maxW) newlineWithSpace();
                            pdf.setTextColor(r, g, b); pdf.text(w, st.cx, st.ly); st.cx += ww;
                        }
                    } else {
                        const im = preImages.get(seg.content);
                        if (im) {
                            if (st.cx + im.widthMm > x + maxW) newlineWithSpace();
                            ensurePage(im.heightMm);
                            pdf.addImage(im.dataUrl, 'PNG', st.cx, st.ly - im.heightMm * ABOVE, im.widthMm, im.heightMm);
                            st.cx += im.widthMm + 0.8;
                        } else {
                            const plain = seg.content, pw2 = pdf.getTextWidth(plain);
                            if (st.cx + pw2 > x + maxW) newlineWithSpace();
                            pdf.setTextColor(100, 80, 200); pdf.text(plain, st.cx, st.ly); pdf.setTextColor(r, g, b); st.cx += pw2;
                        }
                    }
                }
                y = st.ly + LH + extraBelow;
            }
        }
        if (pi < paragraphs.length - 1) y += PG;
    }
    return y;
}

// ============ RENDER NOTES ============
function renderNotes() {
    if (!timestamps.length) {
        emptyNotes.style.display = 'block';
        notesCount.style.display = 'none';
        notesList.querySelectorAll('.cap-item').forEach(i => i.remove());
        return;
    }
    emptyNotes.style.display = 'none';
    notesCount.style.display = 'inline-flex';
    notesCount.textContent = timestamps.length;
    notesList.querySelectorAll('.cap-item').forEach(i => i.remove());

    timestamps.forEach((ts, i) => {
        const el = document.createElement('div');
        el.className = 'cap-item';

        let ocrHtml = '';
        if (ts.ocrText) {
            const renderedOcr = renderWithMath(ts.ocrText);
            ocrHtml = `<div class="ocr-text"><span class="ocr-label">Extracted Text</span><div class="ocr-content">${renderedOcr}</div></div>`;
        }

        let explainHtml = '';
        if (ts.aiExplanation) {
            const renderedExpl = renderWithMath(ts.aiExplanation);
            explainHtml = `<div class="explanation-text"><span class="ocr-label">✨ AI Explanation</span><div class="ocr-content">${renderedExpl}</div></div>`;
        }

        const explainBtnHtml = ts.ocrText
            ? '<button class="btn-explain" data-id="' + ts.id + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Explain</button>'
            : '';

        const hasSnap = ts.snapshot && ts.snapshot.startsWith('data:');

        const snapHtml = hasSnap
            ? `<div class="cap-img"><img src="${ts.snapshot}" alt="Frame at ${ts.timestamp}"></div>`
            : `<div class="cap-img-deleted">
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".35"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="3" x2="21" y2="21"/></svg>
                   <span>Snapshot deleted</span>
               </div>`;

        const delSnapBtn = hasSnap
            ? `<button class="btn-del-snap" data-id="${ts.id}" title="Delete snapshot to save space">
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                       <polyline points="3 6 5 6 21 6"/>
                       <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                       <path d="M10 11v6"/><path d="M14 11v6"/>
                   </svg>
                   Del snap
               </button>`
            : '';

        el.innerHTML = `
            <div class="cap-top">
                <a class="cap-link" data-time="${ts.videoTime}">
                    <span class="cap-badge">${ts.timestamp}</span>Note #${i + 1}
                </a>
                <button class="cap-del" data-id="${ts.id}" title="Delete entire note">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
            </div>
            ${snapHtml}
            <div class="cap-actions">
                <button class="btn-ocr" data-id="${ts.id}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    Extract Text
                </button>
                ${explainBtnHtml}
                ${delSnapBtn}
            </div>
            ${ocrHtml}${explainHtml}
            <textarea class="cap-note" placeholder="Add notes..." data-id="${ts.id}">${ts.note}</textarea>
        `;
        notesList.appendChild(el);
    });

    notesList.querySelectorAll('.cap-link').forEach(link => {
        link.addEventListener('click', () => { if (videoId) window.open(`https://www.youtube.com/watch?v=${videoId}&t=${link.dataset.time}s`, '_blank'); });
    });
    notesList.querySelectorAll('.cap-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            timestamps = timestamps.filter(t => t.id !== btn.dataset.id);
            renderNotes(); updateExport(); await saveData();
            await syncAllNotesToRoom();  // full re-sync after deletion
            showToast('Deleted', 'info');
        });
    });
    notesList.querySelectorAll('.cap-note').forEach(ta => {
        ta.addEventListener('input', () => { const ts = timestamps.find(t => t.id === ta.dataset.id); if (ts) ts.note = ta.value; });
        ta.addEventListener('blur', () => {
            saveData();
            const ts = timestamps.find(t => t.id === ta.dataset.id);
            if (ts) syncNoteTextToRoom(ts);
        });
    });
    notesList.querySelectorAll('.btn-ocr').forEach(btn => btn.addEventListener('click', () => extractText(btn.dataset.id, btn)));
    notesList.querySelectorAll('.btn-explain').forEach(btn => btn.addEventListener('click', () => explainContent(btn.dataset.id, btn)));

    // Delete snapshot only — keeps note, OCR text, explanation intact
    notesList.querySelectorAll('.btn-del-snap').forEach(btn => {
        btn.addEventListener('click', async () => {
            const ts = timestamps.find(t => t.id === btn.dataset.id);
            if (!ts) return;
            ts.snapshot = '';   // clear the base64 image
            renderNotes();
            updateExport();
            await saveData();
            showToast('Snapshot deleted', 'info');
        });
    });
}

// ============ OCR ============
async function extractText(tsId, btnEl) {
    const ts = timestamps.find(t => t.id === tsId);
    if (!ts || !ts.snapshot) return;
    btnEl.disabled = true; btnEl.classList.add('loading');
    btnEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Extracting...`;
    const resetBtn = () => { btnEl.disabled = false; btnEl.classList.remove('loading'); btnEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Extract Text`; };
    try {
        const text = await callAIVision(
            [{
                role: 'user', content: [
                    { type: 'text', text: `Extract ALL visible text from this image exactly as it appears. Do NOT explain, summarize, or solve anything. Just provide the raw text. Format with clear paragraph breaks. For multiple choice options or lists, place each item on a new line. For mathematical expressions, use simple plain text (e.g. "3/4" not LaTeX). Describe diagrams/charts in [square brackets]. Reply "(no content found)" if empty.` },
                    { type: 'image_url', image_url: { url: ts.snapshot } }
                ]
            }],
            { temperature: 0.1 }
        );
        ts.ocrText = text.trim();
        await saveData(); renderNotes();
        syncNoteTextToRoom(ts);
        showToast('Text extracted!', 'success');
    } catch (err) {
        showToast(`OCR failed: ${err.message.slice(0, 80)}`, 'error'); resetBtn();
    }
}

// ============ EXPLAIN ============
async function explainContent(tsId, btnEl) {
    const ts = timestamps.find(t => t.id === tsId);
    if (!ts || !ts.ocrText) { showToast('Extract text first', 'error'); return; }
    btnEl.disabled = true; btnEl.classList.add('loading');
    const origHtml = btnEl.innerHTML;
    btnEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Explaining...';
    try {
        const explanation = await callAI([
            { role: 'system', content: 'You are a study assistant. Explain educational content clearly. Use LaTeX with $ for inline math and $$ for display math. Be educational and concise.' },
            { role: 'user', content: 'Here is text extracted from a video slide:\n\n' + ts.ocrText + '\n\nExplain this content clearly for a student. Break down complex concepts and explain any formulas.' }
        ]);
        ts.aiExplanation = explanation.trim();
        await saveData(); renderNotes();
        syncNoteTextToRoom(ts);
        showToast('Explanation generated!', 'success');
    } catch (err) {
        showToast('Explanation failed: ' + err.message.slice(0, 80), 'error');
        btnEl.disabled = false; btnEl.classList.remove('loading'); btnEl.innerHTML = origHtml;
    }
}

// ============ AI CHAT ============
chatInput.addEventListener('input', () => { sendBtn.disabled = !chatInput.value.trim(); });
chatInput.addEventListener('keypress', e => { if (e.key === 'Enter' && !sendBtn.disabled) sendMsg(); });
sendBtn.addEventListener('click', sendMsg);

async function sendMsg() {
    const q = chatInput.value.trim();
    if (!q) return;
    addMsg('user', q); chatInput.value = ''; sendBtn.disabled = true;
    addMsg('bot', 'Thinking...', true);
    try {
        let sysMsg = 'You are NotePilot AI — a helpful, clear, and concise study assistant.';
        if (videoTitle) {
            sysMsg += ` The student is watching a video titled "${videoTitle}".`;
            sysMsg += ' Use this context to make your answers relevant, but do NOT explicitly mention, quote, or reference the video title in your response. Just answer the question directly.';
        }
        sysMsg += ' When your answer involves math, use LaTeX notation with $ delimiters for inline math and $$ for display math.';

        const messages = [{ role: 'system', content: sysMsg }];
        const recentQA = aiResponses.slice(-4);
        for (const qa of recentQA) {
            messages.push({ role: 'user', content: qa.question });
            messages.push({ role: 'assistant', content: qa.answer });
        }
        messages.push({ role: 'user', content: buildPrompt(q) });

        const answer = await callAI(messages);
        removeLast();
        const qaIdx = aiResponses.length;
        addMsg('bot', answer, false, qaIdx);
        aiResponses.push({ question: q, answer, time: new Date().toLocaleTimeString(), includedInPdf: true });
        updateExport(); await saveData();
    } catch (err) {
        removeLast(); addMsg('bot', `API Error: ${err.message}`);
        showToast('AI request failed', 'error');
    }
}

function buildPrompt(question) {
    let p = '';
    if (videoTitle) { p += `VIDEO CONTEXT:\nTitle: "${videoTitle}"\n`; if (videoId) p += `URL: youtube.com/watch?v=${videoId}\n`; p += '\n'; }
    if (timestamps.length) {
        p += "STUDENT'S CAPTURED NOTES FROM THIS VIDEO:\n";
        timestamps.forEach((ts, i) => {
            p += `[${ts.timestamp}] Note #${i + 1}: ${ts.note || '(no note)'}`;
            if (ts.ocrText) p += `\n   Slide/screen text: ${ts.ocrText.slice(0, 300)}`;
            p += '\n';
        });
        p += '\n';
    }
    p += `STUDENT'S QUESTION: ${question}\n\nAnswer clearly and educationally. Use LaTeX math notation ($...$). Do NOT reference the video title.`;
    return p;
}

function addMsg(role, text, loading = false, qaIndex = -1) {
    const d = document.createElement('div');
    d.className = `msg ${role}${loading ? ' loading' : ''}`;
    const content = (role === 'bot' && !loading) ? renderWithMath(text) : escapeHtml(text);
    let toggleHtml = '';
    if (role === 'bot' && !loading && qaIndex >= 0) {
        const checked = aiResponses[qaIndex]?.includedInPdf !== false ? 'checked' : '';
        toggleHtml = '<label class="qa-pdf-toggle" title="Include in PDF export"><input type="checkbox" ' + checked + ' data-qa-index="' + qaIndex + '"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> PDF</label>';
    }
    d.innerHTML = '<div class="bubble">' + content + toggleHtml + '</div>';
    const toggle = d.querySelector('.qa-pdf-toggle input');
    if (toggle) {
        toggle.addEventListener('change', () => {
            const idx = parseInt(toggle.dataset.qaIndex);
            if (aiResponses[idx]) { aiResponses[idx].includedInPdf = toggle.checked; saveData(); }
        });
    }
    chatMessages.appendChild(d);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeLast() { const msgs = chatMessages.querySelectorAll('.msg'); if (msgs.length) msgs[msgs.length - 1].remove(); }
function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ============ EXPORT ============
exportBtn.addEventListener('click', makePDF);

function updateExport() {
    exportBtn.disabled = !timestamps.length && !aiResponses.length;
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) shareBtn.disabled = !timestamps.length;
}

// ============ PDF EXPORT ============
async function makePDF() {
    if (!timestamps.length && !aiResponses.length) { showToast('Nothing to export', 'error'); return; }
    showToast('Generating summary & PDF...', 'loading');
    let summary = '';
    try { summary = await generateSummary(); }
    catch (e) { summary = buildLocalSummary(); }

    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
        const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
        const M = 18, CW = pw - M * 2;
        const ACCENT = [229, 9, 20], ACCENT2 = [184, 29, 36];
        const TEXT = [30, 30, 30], TEXT2 = [80, 80, 80], MUTED = [130, 130, 130];
        const CARD_BG = [248, 248, 248], BORDER = [220, 220, 220];
        let y = 0;
        const title = pdfTitle.value.trim() || videoTitle || 'Study Notes';

        pdf.setFillColor(10, 10, 10); pdf.rect(0, 0, pw, 52, 'F');
        pdf.setFillColor(20, 20, 20); pdf.rect(0, 36, pw, 16, 'F');
        pdf.setFillColor(...ACCENT); pdf.rect(0, 0, pw, 2, 'F');
        pdf.setFillColor(...ACCENT); pdf.roundedRect(M, 8, 8, 8, 1.5, 1.5, 'F');
        pdf.setFillColor(...ACCENT2); pdf.roundedRect(M + 1.5, 9.5, 5, 5, 1, 1, 'F');
        pdf.setFontSize(7); pdf.setFont(undefined, 'bold'); pdf.setTextColor(229, 9, 20);
        pdf.text('NOTEPILOT', M + 11, 13.5);
        pdf.setFont(undefined, 'bold'); pdf.setTextColor(240, 240, 240); pdf.setFontSize(17);
        const titleLines = pdf.splitTextToSize(title, pw - M * 2 - 20);
        let ty = 24;
        for (const tl of titleLines) { pdf.text(tl, pw / 2, ty, { align: 'center' }); ty += 8; }
        pdf.setFont(undefined, 'normal'); pdf.setFontSize(8); pdf.setTextColor(229, 60, 60);
        const userGaveTitle = pdfTitle.value.trim() && pdfTitle.value.trim() !== videoTitle;
        const sub = (userGaveTitle && videoTitle) ? `${videoTitle}   ·   ${new Date().toLocaleDateString()}` : new Date().toLocaleDateString();
        pdf.text(pdf.splitTextToSize(sub, pw - 40), pw / 2, Math.max(ty + 1, 44), { align: 'center' });
        pdf.setFillColor(...ACCENT); pdf.rect(0, 50, pw, 2, 'F');
        pdf.setFillColor(...ACCENT2); pdf.rect(pw / 2, 50, pw / 2, 2, 'F');
        y = 62;

        if (videoId) {
            pdf.setFillColor(...CARD_BG); pdf.roundedRect(M, y - 4, CW, 9, 2, 2, 'F');
            pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.25); pdf.roundedRect(M, y - 4, CW, 9, 2, 2, 'D');
            pdf.setFontSize(8); pdf.setTextColor(...ACCENT);
            pdf.textWithLink(`> youtube.com/watch?v=${videoId}`, M + 4, y + 0.5, { url: `https://www.youtube.com/watch?v=${videoId}` });
            pdf.setTextColor(...MUTED);
            pdf.text(`${timestamps.length} capture${timestamps.length !== 1 ? 's' : ''}  ·  ${aiResponses.length} Q&A`, pw - M - 4, y + 0.5, { align: 'right' });
            y += 13;
        }

        const drawSection = (label) => {
            if (y > ph - 35) { pdf.addPage(); y = M; }
            y += 3;
            pdf.setFillColor(245, 245, 245); pdf.roundedRect(M, y - 4.5, CW, 10, 2, 2, 'F');
            pdf.setFillColor(...ACCENT); pdf.roundedRect(M, y - 4.5, 3.5, 10, 1, 1, 'F');
            pdf.setFont(undefined, 'bold'); pdf.setFontSize(10.5); pdf.setTextColor(...ACCENT);
            pdf.text(`>  ${label}`, M + 8, y + 1.5);
            pdf.setFont(undefined, 'normal'); y += 10;
        };

        if (summary) {
            drawSection('Video Summary'); y += 2;
            y = await addTextWithNativeMathPdf(pdf, summary, M + 2, y, CW - 4, 9, ...TEXT2, ph, M);
            y += 5; pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.25); pdf.line(M, y, pw - M, y); y += 6;
        }

        if (timestamps.length) {
            drawSection('Captured Notes'); y += 2;
            for (let i = 0; i < timestamps.length; i++) {
                const ts = timestamps[i];
                if (y > ph - 90) { pdf.addPage(); y = M; }
                const cardStartPage = pdf.internal.getCurrentPageInfo().pageNumber;
                const cardStartY = y - 1; y += 3;
                pdf.setFontSize(7.5);
                const pillLabel = `> ${ts.timestamp}  -  Note #${i + 1}`;
                const pillW = pdf.getTextWidth(pillLabel) + 10;
                const pillX = M + 6;
                pdf.setFillColor(...ACCENT); pdf.roundedRect(pillX, y - 3.2, pillW, 6.5, 1.5, 1.5, 'F');
                pdf.setFont(undefined, 'bold'); pdf.setTextColor(255, 255, 255);
                pdf.textWithLink(pillLabel, pillX + pillW / 2, y + 0.2, { align: 'center', url: `https://www.youtube.com/watch?v=${videoId}&t=${ts.videoTime}s` });
                pdf.setFont(undefined, 'normal'); y += 8;
                if (ts.snapshot && ts.snapshot.startsWith('data:')) {
                    try {
                        const imgW = Math.min(CW * 0.72, 116), imgH = imgW * (9 / 16);
                        if (y + imgH > ph - M - 10) { pdf.addPage(); y = M; }
                        pdf.setFillColor(200, 200, 220); pdf.roundedRect(M + 7, y + 0.5, imgW, imgH, 2, 2, 'F');
                        pdf.addImage(ts.snapshot, 'JPEG', M + 7, y, imgW, imgH, '', 'FAST');
                        pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.3); pdf.roundedRect(M + 7, y, imgW, imgH, 2, 2, 'D');
                        y += imgH + 5;
                    } catch (_) { }
                }
                if ((ts.note || '').trim()) { pdf.setFontSize(8.5); pdf.setTextColor(...TEXT2); y = await addTextWithNativeMathPdf(pdf, ts.note.trim(), M + 7, y, CW - 16, 8.5, ...TEXT2, ph, M); y += 3; }
                if (ts.ocrText) {
                    pdf.setFillColor(250, 235, 235); pdf.roundedRect(M + 7, y - 2, CW - 14, 7, 1.2, 1.2, 'F');
                    pdf.setFontSize(7); pdf.setFont(undefined, 'bold'); pdf.setTextColor(...ACCENT);
                    pdf.text('EXTRACTED TEXT', M + 10, y + 2); pdf.setFont(undefined, 'normal'); y += 8;
                    y = await addTextWithNativeMathPdf(pdf, ts.ocrText, M + 9, y, CW - 18, 7.5, ...TEXT2, ph, M); y += 3;
                }
                if (ts.aiExplanation) {
                    pdf.setFillColor(255, 240, 240); pdf.roundedRect(M + 7, y - 2, CW - 14, 7, 1.2, 1.2, 'F');
                    pdf.setFontSize(7); pdf.setFont(undefined, 'bold'); pdf.setTextColor(...ACCENT2);
                    pdf.text('AI EXPLANATION', M + 10, y + 2); pdf.setFont(undefined, 'normal'); y += 8;
                    y = await addTextWithNativeMathPdf(pdf, ts.aiExplanation, M + 9, y, CW - 18, 7.5, ...TEXT2, ph, M); y += 3;
                }
                y += 8;
                const cardEndPage = pdf.internal.getCurrentPageInfo().pageNumber, cardEndY = y;
                for (let pg = cardStartPage; pg <= cardEndPage; pg++) {
                    pdf.setPage(pg);
                    const segTop = (pg === cardStartPage) ? cardStartY : M - 1;
                    const segBottom = (pg === cardEndPage) ? cardEndY : ph - M;
                    const segH = segBottom - segTop;
                    if (segH <= 0) continue;
                    pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.3); pdf.roundedRect(M, segTop, CW, segH, 2.5, 2.5, 'D');
                    pdf.setFillColor(...ACCENT); pdf.rect(M, segTop, 3, segH, 'F');
                }
                pdf.setPage(cardEndPage); pdf.setTextColor(...TEXT2); pdf.setFont(undefined, 'normal');
                y += 4;
            }
        }

        const selectedQA = aiResponses.filter(qa => qa.includedInPdf !== false);
        if (selectedQA.length) {
            if (y > ph - 40) { pdf.addPage(); y = M; }
            drawSection('AI Q&A'); y += 2;
            for (let i = 0; i < selectedQA.length; i++) {
                const qa = selectedQA[i];
                if (y > ph - 30) { pdf.addPage(); y = M; }
                pdf.setFillColor(250, 235, 235); pdf.roundedRect(M, y - 3.5, CW, 8, 1.5, 1.5, 'F');
                pdf.setDrawColor(...ACCENT); pdf.setLineWidth(0.2); pdf.roundedRect(M, y - 3.5, CW, 8, 1.5, 1.5, 'D');
                pdf.setFont(undefined, 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...ACCENT);
                pdf.text(`Q${i + 1}`, M + 3, y + 1.2);
                pdf.setFont(undefined, 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...TEXT);
                const qText = pdf.splitTextToSize(qa.question, CW - 14);
                pdf.text(qText, M + 12, y + 1.2);
                y += Math.max(qText.length * 3.8, 8) + 3;
                y = await addTextWithNativeMathPdf(pdf, qa.answer, M + 4, y, CW - 8, 8.5, ...TEXT2, ph, M);
                y += 8;
                if (i < selectedQA.length - 1) { pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.2); pdf.line(M, y - 3, pw - M, y - 3); }
            }
        }

        const totalPages = pdf.internal.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
            pdf.setPage(p);
            pdf.setFillColor(245, 245, 245); pdf.rect(0, ph - 10, pw, 10, 'F');
            pdf.setFillColor(...ACCENT); pdf.rect(0, ph - 10, pw, 0.7, 'F');
            pdf.setFontSize(6.5); pdf.setFont(undefined, 'normal');
            pdf.setTextColor(...MUTED); pdf.text('Generated by NotePilot', M, ph - 4.5);
            pdf.setTextColor(...ACCENT); pdf.text(`${p} / ${totalPages}`, pw - M, ph - 4.5, { align: 'right' });
            if (videoTitle && p > 1) { pdf.setTextColor(...MUTED); pdf.text(videoTitle.slice(0, 60), pw / 2, ph - 4.5, { align: 'center' }); }
        }
        const safeName = title.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') || 'Study_Notes';
        pdf.save(`${safeName}.pdf`);
        showToast('PDF downloaded!', 'success');
    } catch (err) { console.error('PDF error:', err); showToast('PDF generation failed', 'error'); }
}

async function generateSummary() {
    let prompt = 'Generate a concise 3-5 sentence summary of this YouTube video for study notes.\n\n';
    if (videoTitle) prompt += `Video title: "${videoTitle}"\n`;
    if (timestamps.length) {
        prompt += 'Captured notes:\n';
        timestamps.forEach(ts => { prompt += `- [${ts.timestamp}] ${ts.note || '(no note)'}${ts.ocrText ? ` | Slide: ${ts.ocrText.slice(0, 150)}` : ''}\n`; });
    }
    prompt += '\nWrite a brief educational summary. Only output the summary text. Do not reference the video title.';
    return callAI([{ role: 'system', content: 'You are a study assistant. Generate concise educational summaries. Do not mention or quote the video title.' }, { role: 'user', content: prompt }]);
}

function buildLocalSummary() {
    const parts = [];
    if (videoTitle) parts.push(`This document contains study notes for "${videoTitle}".`);
    else parts.push('This document contains study notes captured from a YouTube video.');
    if (timestamps.length) { const nwt = timestamps.filter(t => t.note); parts.push(`A total of ${timestamps.length} key moments were captured${nwt.length ? ', covering: ' + nwt.map(t => t.note.slice(0, 50)).join('; ') : ''}.`); }
    if (aiResponses.length) parts.push(`${aiResponses.length} questions were asked and answered.`);
    return parts.join(' ');
}

// ============ TOAST ============
function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    toasts.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(6px)'; t.style.transition = 'all .2s'; setTimeout(() => t.remove(), 200); }, 2200);
}


// =============================================================================
// FEATURE 1: AI SUMMARY TIMELINE
// =============================================================================

// Fetch YouTube caption track URL from the active tab's content script
// =============================================================================
// FEATURE 2: SHARED STUDY ROOM
// =============================================================================

// ============ LIVE ROOM SYNC ============

// Show a pulsing green dot on the Share button when a room is active
function updateShareLiveIndicator() {
    const btn = document.getElementById('share-btn');
    if (!btn) return;
    let dot = btn.querySelector('.share-live-dot');
    if (sharedRoomId && BACKEND_URL) {
        if (!dot) {
            dot = document.createElement('span');
            dot.className = 'share-live-dot';
            btn.prepend(dot);
        }
        btn.title = 'Study room is live — captures sync automatically';
    } else {
        dot?.remove();
        btn.title = 'Share study room with classmates';
    }
}

// Push a brand-new capture (with image) to the room — fire and forget
async function pushNoteToRoom(ts) {
    if (!sharedRoomId || !BACKEND_URL || !ts) return;
    try {
        const idx = timestamps.indexOf(ts);
        if (idx === -1) return;

        const payload = {
            id: ts.id,
            timestamp: ts.timestamp,
            videoTime: ts.videoTime,
            note: ts.note || '',
            ocrText: ts.ocrText || '',
            aiExplanation: ts.aiExplanation || '',
            snapshot: await compressSnapshot(ts.snapshot)
        };

        await fetch(`${BACKEND_URL}/api/rooms/${sharedRoomId}/notes/${idx}`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });

        showRoomSyncToast();
    } catch (err) {
        console.warn('[NotePilot] pushNoteToRoom failed:', err.message);
    }
}

// Push only text fields for an existing note (no image recompression)
async function syncNoteTextToRoom(ts) {
    if (!sharedRoomId || !BACKEND_URL || !ts) return;
    try {
        const idx = timestamps.indexOf(ts);
        if (idx === -1) return;

        await fetch(`${BACKEND_URL}/api/rooms/${sharedRoomId}/notes/${idx}`, {
            method: 'PATCH',
            headers: authHeaders(),
            body: JSON.stringify({
                note: ts.note || '',
                ocrText: ts.ocrText || '',
                aiExplanation: ts.aiExplanation || ''
            })
        });

        showRoomSyncToast();
    } catch (err) {
        console.warn('[NotePilot] syncNoteTextToRoom failed:', err.message);
    }
}

// Full re-sync: replaces the entire notes array in the room (guards against index drift)
async function syncAllNotesToRoom() {
    if (!sharedRoomId || !BACKEND_URL) return;
    try {
        const compressedNotes = await Promise.all(timestamps.map(async ts => ({
            id: ts.id,
            timestamp: ts.timestamp,
            videoTime: ts.videoTime,
            note: ts.note || '',
            ocrText: ts.ocrText || '',
            aiExplanation: ts.aiExplanation || '',
            snapshot: ts.snapshot && ts.snapshot.startsWith('data:') ? await compressSnapshot(ts.snapshot) : (ts.snapshot || '')
        })));

        await fetch(`${BACKEND_URL}/api/rooms/${sharedRoomId}`, {
            method: 'PATCH',
            headers: authHeaders(),
            body: JSON.stringify({
                videoTitle: videoTitle || 'Untitled Video',
                notes: compressedNotes
            })
        });
        showRoomSyncToast();
    } catch (err) {
        console.warn('[NotePilot] syncAllNotesToRoom failed:', err.message);
    }
}

// Debounced full room sync — called from saveData
let _debouncedRoomSync = null;
function debouncedSyncAllNotesToRoom() {
    if (!sharedRoomId || !BACKEND_URL) return;
    clearTimeout(_debouncedRoomSync);
    _debouncedRoomSync = setTimeout(() => syncAllNotesToRoom(), 1500);
}

// Subtle "synced" confirmation — shows once per batch of changes
let _syncToastTimer = null;
function showRoomSyncToast() {
    clearTimeout(_syncToastTimer);
    _syncToastTimer = setTimeout(() => {
        const btn = document.getElementById('share-btn');
        if (!btn) return;
        const orig = btn.innerHTML;
        btn.innerHTML = btn.innerHTML.replace(/Share/, '✓ Synced');
        setTimeout(() => { btn.innerHTML = orig; }, 1800);
    }, 400);
}

// Compress a snapshot dataUrl to a smaller JPEG for Firebase upload
function compressSnapshot(dataUrl, maxWidth = 1280) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, maxWidth / img.width);
            const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL('image/jpeg', 0.88));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

function generateRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Build the room URL from a roomId
function buildRoomUrl(roomId) {
    const apiEncoded = encodeURIComponent(BACKEND_URL);
    return ROOM_VIEWER_URL
        ? `${ROOM_VIEWER_URL}?r=${roomId}&api=${apiEncoded}`
        : `${chrome.runtime.getURL('room/index.html')}?r=${roomId}&api=${apiEncoded}`;
}

// Show the room URL in the modal and wire copy/open buttons
function showRoomUrl(roomUrl) {
    const resultDiv = document.getElementById('share-result');
    const urlEl = document.getElementById('share-result-url');
    const doBtn = document.getElementById('share-do-btn');
    if (resultDiv && urlEl) { urlEl.textContent = roomUrl; resultDiv.style.display = 'block'; }
    if (doBtn) doBtn.style.display = 'none';

    // Re-attach listeners each time (avoids duplicates via cloneNode trick)
    const copyBtn = document.getElementById('share-copy-btn');
    const openBtn = document.getElementById('share-open-btn');
    if (copyBtn) {
        const newCopy = copyBtn.cloneNode(true);
        copyBtn.parentNode.replaceChild(newCopy, copyBtn);
        newCopy.addEventListener('click', () => {
            navigator.clipboard.writeText(roomUrl).then(() => showToast('Copied!', 'success'));
        });
    }
    if (openBtn) {
        const newOpen = openBtn.cloneNode(true);
        openBtn.parentNode.replaceChild(newOpen, openBtn);
        newOpen.addEventListener('click', () => chrome.tabs.create({ url: roomUrl }));
    }
}

// Upload / update room on backend, then store the roomId persistently
async function shareRoom(ownerName) {
    if (!BACKEND_URL) { showToast('Backend not configured in config.js', 'error'); return; }
    if (!timestamps.length) { showToast('No captures to share', 'error'); return; }

    showToast('Compressing snapshots...', 'loading');
    const doBtn = document.getElementById('share-do-btn');
    if (doBtn) { doBtn.disabled = true; doBtn.textContent = 'Uploading...'; }

    try {
        const compressedNotes = await Promise.all(timestamps.map(async ts => ({
            id: ts.id,
            timestamp: ts.timestamp,
            videoTime: ts.videoTime,
            note: ts.note || '',
            ocrText: ts.ocrText || '',
            aiExplanation: ts.aiExplanation || '',
            snapshot: await compressSnapshot(ts.snapshot)
        })));

        let roomId = sharedRoomId;

        // Safety check: re-fetch from backend to prevent duplicate rooms for the same video
        if (!roomId && videoId) {
            try {
                const checkRes = await fetch(`${BACKEND_URL}/api/videos/${videoId}`, { headers: authHeaders() });
                const checkData = await checkRes.json();
                if (checkData && checkData.sharedRoomId) {
                    roomId = checkData.sharedRoomId;
                    sharedRoomId = roomId;
                }
            } catch (_) { /* proceed to create */ }
        }

        if (roomId) {
            // Update existing room
            const res = await fetch(`${BACKEND_URL}/api/rooms/${roomId}`, {
                method: 'PATCH',
                headers: authHeaders(),
                body: JSON.stringify({
                    videoTitle: videoTitle || 'Untitled Video',
                    ownerName: ownerName || 'Anonymous',
                    notes: compressedNotes
                })
            });
            if (!res.ok) throw new Error('Update failed: ' + res.status);
        } else {
            // Create new room
            const res = await fetch(`${BACKEND_URL}/api/rooms`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                    videoId,
                    videoTitle: videoTitle || 'Untitled Video',
                    ownerName: ownerName || 'Anonymous',
                    notes: compressedNotes
                })
            });
            if (!res.ok) throw new Error('Create failed: ' + res.status);
            const data = await res.json();
            roomId = data.roomId;
        }

        // Persist the roomId so future shares reuse it
        sharedRoomId = roomId;
        await saveData();
        updateShareLiveIndicator();

        const roomUrl = buildRoomUrl(roomId);
        try { await navigator.clipboard.writeText(roomUrl); } catch (_) { }
        showRoomUrl(roomUrl);
        showToast('Room shared! Link copied.', 'success');

    } catch (err) {
        console.error('Share error:', err);
        showToast('Share failed: ' + err.message.slice(0, 80), 'error');
        if (doBtn) { doBtn.disabled = false; doBtn.textContent = 'Upload & Share'; }
    }
}

function setupShareModal() {
    const overlay = document.getElementById('share-modal-overlay');
    const shareBtn = document.getElementById('share-btn');
    const closeBtn = document.getElementById('share-modal-close');
    const cancelBtn = document.getElementById('share-cancel-btn');
    const doBtn = document.getElementById('share-do-btn');
    const nameInput = document.getElementById('share-name-input');

    if (!overlay || !shareBtn) return;

    const openModal = () => {
        const result = document.getElementById('share-result');
        const doButton = document.getElementById('share-do-btn');

        if (nameInput) nameInput.value = localStorage.getItem('np_ownerName') || currentUser?.name || '';
        overlay.style.display = 'flex';
        requestAnimationFrame(() => overlay.classList.add('modal-visible'));

        if (sharedRoomId && BACKEND_URL) {
            // Room already exists for this video — show the link immediately, no re-upload needed
            const roomUrl = buildRoomUrl(sharedRoomId);
            if (result) { result.style.display = 'block'; }
            const urlEl = document.getElementById('share-result-url');
            if (urlEl) urlEl.textContent = roomUrl;
            if (doButton) { doButton.style.display = ''; doButton.disabled = false; doButton.textContent = 'Update Room'; }
            showRoomUrl(roomUrl);
            // Don't focus name input — focus copy button instead
            document.getElementById('share-copy-btn')?.focus();
        } else {
            // First share — reset to upload state
            if (result) result.style.display = 'none';
            if (doButton) { doButton.style.display = ''; doButton.disabled = false; doButton.textContent = 'Upload & Share'; }
            if (nameInput && nameInput.value) {
                doButton?.focus();
            } else if (nameInput) {
                nameInput.focus();
            }
        }
    };
    const closeModal = () => {
        overlay.classList.remove('modal-visible');
        setTimeout(() => { overlay.style.display = 'none'; }, 220);
    };

    shareBtn.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    doBtn?.addEventListener('click', () => {
        const name = nameInput?.value.trim() || currentUser?.name || 'Anonymous';
        localStorage.setItem('np_ownerName', name);
        shareRoom(name);
    });

    // Allow Enter in name input to submit
    nameInput?.addEventListener('keypress', e => { if (e.key === 'Enter') doBtn?.click(); });
}

// =============================================================================
// QUIZ SYSTEM — Full-video AI Quiz (transcript + notes)
// =============================================================================

const quizContainer = document.getElementById('quiz-container');

let quizState = {
    questions: [],   // [{topic,difficulty,question,options,correctIndex,explanation,timestampHint}]
    current: 0,
    score: 0,
    answers: [],     // [{qIdx, chosen, correct}]
    active: false,
    transcriptUsed: false,
    sourceMode: 'transcript'
};

// ── Idle / start screen ──
function renderQuizIdle() {
    const noVideo = !videoId;
    const hasNotes = timestamps.length > 0 || aiResponses.length > 0;

    quizContainer.innerHTML = `
        <div class="quiz-idle">
            <div class="quiz-idle-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
            </div>
            <h3>AI Quiz Mode</h3>
            <p>10 questions generated from the entire video transcript for deep active recall.</p>
            ${noVideo ? '<div class="quiz-idle-warn red">Open a YouTube video first</div>' : ''}
            ${!noVideo && !hasNotes ? '<div class="quiz-idle-warn amber">Tip: capture frames for richer questions</div>' : ''}
            <div class="quiz-source-row">
                <button class="quiz-src-opt selected" data-mode="transcript">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    Full transcript
                </button>
                <button class="quiz-src-opt" data-mode="notes">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                    </svg>
                    My notes only
                </button>
            </div>
            <button class="btn-gen-quiz" id="gen-quiz-btn" ${noVideo ? 'disabled' : ''}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Generate Quiz
            </button>
        </div>`;

    quizContainer.querySelectorAll('.quiz-src-opt').forEach(btn => {
        btn.addEventListener('click', () => {
            quizContainer.querySelectorAll('.quiz-src-opt').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            quizState.sourceMode = btn.dataset.mode;
        });
    });
    document.getElementById('gen-quiz-btn')?.addEventListener('click', startQuiz);
}

// ── Loading screen ──
function renderQuizLoading(msg = 'Preparing quiz…', sub = 'This takes about 15 seconds') {
    quizContainer.innerHTML = `
        <div class="quiz-loading">
            <div class="quiz-spinner"></div>
            <div class="quiz-load-title">${msg}</div>
            <div class="quiz-load-sub">${sub}</div>
        </div>`;
}

// ── Fetch transcript via content script ──
async function fetchTranscript() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url?.includes('youtube.com')) return '';
        const resp = await chrome.tabs.sendMessage(tab.id, { action: 'getTranscript', videoId });
        if (resp?.success && resp.text?.length > 50) {
            console.log(`[NotePilot] Transcript OK (${resp.trackKind}, ${resp.langCode}): ${resp.text.length} chars`);
            return resp.text;
        }
        console.warn('[NotePilot] Transcript failed:', resp?.reason);
        return '';
    } catch (err) {
        console.warn('[NotePilot] fetchTranscript error:', err);
        return '';
    }
}

// ── Build AI prompt context ──
function buildQuizContext(transcript) {
    let ctx = '';
    if (videoTitle) ctx += `VIDEO TITLE: "${videoTitle}"\n\n`;
    if (transcript) {
        const chunk = transcript.length > 7000 ? transcript.slice(0, 7000) + ' …[truncated]' : transcript;
        ctx += `FULL VIDEO TRANSCRIPT:\n${chunk}\n\n`;
    }
    if (timestamps.length) {
        ctx += 'CAPTURED FRAMES & NOTES:\n';
        timestamps.forEach(ts => {
            let line = `[${ts.timestamp}]`;
            if (ts.note) line += ` Note: ${ts.note}.`;
            if (ts.ocrText) line += ` Slide: ${ts.ocrText.slice(0, 300)}`;
            ctx += line + '\n';
        });
        ctx += '\n';
    }
    if (aiResponses.length) {
        ctx += 'Q&A HISTORY:\n';
        aiResponses.forEach(qa => ctx += `Q: ${qa.question}\nA: ${qa.answer.slice(0, 200)}\n`);
    }
    return ctx.trim();
}

// ── Generate questions via Groq ──
async function generateQuizQuestions(context) {
    const res = await fetch(`${BACKEND_URL}/api/ai/quiz`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ context })
    });
    if (!res.ok) throw new Error('Quiz generation failed: ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data?.questions) || !data.questions.length) throw new Error('No questions returned');
    return data;
}

// ── Start the quiz ──
async function startQuiz() {
    if (!videoId) { showToast('Open a YouTube video first', 'error'); return; }
    const mode = quizState.sourceMode || 'transcript';
    quizState = { questions: [], current: 0, score: 0, answers: [], active: false, transcriptUsed: false, sourceMode: mode };

    let transcript = '';
    if (mode === 'transcript') {
        renderQuizLoading('Fetching video transcript…', 'Reading captions from YouTube');
        transcript = await fetchTranscript();
        quizState.transcriptUsed = transcript.length > 100;
        if (!quizState.transcriptUsed) {
            const hasNotes = timestamps.length > 0 || aiResponses.length > 0;
            if (!hasNotes) { renderQuizIdle(); showToast('No captions & no notes found', 'error'); return; }
            showToast('No transcript — using captures & notes', 'info');
        }
    } else {
        const hasNotes = timestamps.length > 0 || aiResponses.length > 0;
        if (!hasNotes) { renderQuizIdle(); showToast('No notes captured yet', 'error'); return; }
    }

    renderQuizLoading('Generating questions…', 'AI is reading the video content');
    try {
        const data = await generateQuizQuestions(buildQuizContext(transcript));
        quizState.questions = data.questions;
        quizState.active = true;
        document.getElementById('quiz-badge').style.display = 'inline-flex';
        renderQuizQuestion(0);
    } catch (err) {
        console.error('Quiz generation error:', err);
        renderQuizIdle();
        showToast('Quiz generation failed — try again', 'error');
    }
}

// ── Render one question ──
function renderQuizQuestion(idx) {
    const q = quizState.questions[idx];
    const total = quizState.questions.length;
    const pct = Math.round((idx / total) * 100);
    const letters = ['A', 'B', 'C', 'D'];
    const diffClass = { easy: 'easy', medium: 'medium', hard: 'hard' }[q.difficulty] || 'medium';

    quizContainer.innerHTML = `
        <div class="quiz-progress-wrap">
            <div class="quiz-progress-top">
                <span class="quiz-progress-label">Question ${idx + 1} of ${total}</span>
                <span class="quiz-progress-frac">Score: ${quizState.score} / ${idx}</span>
            </div>
            <div class="quiz-progress-bar"><div class="quiz-progress-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="quiz-q-card">
            <div class="quiz-q-topic">${escapeHtml(q.topic || 'General')}</div>
            <div class="quiz-q-text">${escapeHtml(q.question)}</div>
            <span class="quiz-q-diff ${diffClass}">${q.difficulty || 'medium'}</span>
        </div>
        <div class="quiz-options" id="quiz-opts">
            ${q.options.map((opt, i) => `
                <button class="quiz-opt" data-idx="${i}">
                    <span class="quiz-opt-letter">${letters[i]}</span>
                    <span>${escapeHtml(opt)}</span>
                </button>`).join('')}
        </div>
        <div class="quiz-explanation" id="quiz-expl">
            <div class="quiz-expl-label">Explanation</div>
            <div id="quiz-expl-text"></div>
        </div>
        <button class="quiz-next-btn" id="quiz-next">${idx + 1 < total ? 'Next Question →' : 'See Results'}</button>
        <div class="quiz-src-tag">
            <span class="quiz-src-dot ${quizState.transcriptUsed ? '' : 'amber'}"></span>
            ${quizState.transcriptUsed ? 'Full video transcript used' : 'Captures & notes only'}
        </div>`;

    document.querySelectorAll('.quiz-opt').forEach(btn =>
        btn.addEventListener('click', () => handleAnswer(parseInt(btn.dataset.idx)))
    );
    document.getElementById('quiz-next').addEventListener('click', () => {
        const next = quizState.current + 1;
        if (next < quizState.questions.length) { quizState.current = next; renderQuizQuestion(next); }
        else renderQuizResults();
    });
}

// ── Handle answer selection ──
function handleAnswer(chosenIdx) {
    const q = quizState.questions[quizState.current];
    const correct = chosenIdx === q.correctIndex;
    if (correct) quizState.score++;
    quizState.answers.push({ qIdx: quizState.current, chosen: chosenIdx, correct });

    document.querySelectorAll('.quiz-opt').forEach((btn, i) => {
        btn.disabled = true;
        if (i === q.correctIndex) btn.classList.add('correct');
        else if (i === chosenIdx && !correct) btn.classList.add('wrong');
        else btn.classList.add('dimmed');
    });
    document.getElementById('quiz-expl-text').textContent = q.explanation || '';
    document.getElementById('quiz-expl').classList.add('show');
    document.getElementById('quiz-next').classList.add('show');
}

// ── Score ring SVG ──
function buildScoreRing(score, total) {
    const pct = score / total;
    const R = 35, C = 2 * Math.PI * R;
    const color = pct >= 0.8 ? '#10b981' : pct >= 0.5 ? '#f59e0b' : '#ef4444';
    return `<svg width="84" height="84" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="6.5"/>
        <circle cx="42" cy="42" r="${R}" fill="none" stroke="${color}" stroke-width="6.5"
            stroke-dasharray="${(pct * C).toFixed(1)} ${C.toFixed(1)}" stroke-linecap="round"/>
    </svg>`;
}

// ── Results screen ──
function renderQuizResults() {
    quizState.active = false;
    const total = quizState.questions.length;
    const score = quizState.score;
    const pct = Math.round((score / total) * 100);
    const msg = pct === 100 ? '🏆 Perfect score!' : pct >= 80 ? '🎯 Excellent!' : pct >= 60 ? '📚 Good effort!' : pct >= 40 ? '💪 Keep studying!' : '🔁 Needs more review';

    const breakdown = quizState.answers.map(a => {
        const q = quizState.questions[a.qIdx];
        const matchedTs = timestamps.find(ts => q.timestampHint && ts.timestamp === q.timestampHint);
        return `<div class="quiz-bd-item ${a.correct ? 'right' : 'wrong'}">
            <span class="quiz-bd-icon">${a.correct ? '✓' : '✗'}</span>
            <div class="quiz-bd-body">
                <div class="quiz-bd-q">${escapeHtml(q.question)}</div>
                ${!a.correct ? `<div class="quiz-bd-correct">Correct: ${escapeHtml(q.options[q.correctIndex])}</div>` : ''}
                ${!a.correct && (matchedTs || q.timestampHint) ? `<button class="quiz-bd-rewatch" data-time="${matchedTs?.videoTime ?? 0}">↩ Rewatch at ${q.timestampHint || matchedTs?.timestamp || '0:00'}</button>` : ''}
            </div>
        </div>`;
    }).join('');

    quizContainer.innerHTML = `
        <div class="quiz-results">
            <div class="quiz-score-ring">
                ${buildScoreRing(score, total)}
                <div class="quiz-score-ring-text">
                    <span class="quiz-score-num">${score}</span>
                    <span class="quiz-score-denom">/ ${total}</span>
                </div>
            </div>
            <div class="quiz-score-msg">${msg}</div>
            <div class="quiz-score-pct">${pct}% · ${total - score} missed</div>
            <div class="quiz-breakdown">${breakdown}</div>
            <div class="quiz-result-btns">
                <button class="btn-quiz-retry" id="quiz-retry-btn">↺ Retry</button>
                <button class="btn-quiz-new"   id="quiz-new-btn">New Quiz</button>
            </div>
            <div class="quiz-src-tag">
                <span class="quiz-src-dot ${quizState.transcriptUsed ? '' : 'amber'}"></span>
                ${quizState.transcriptUsed ? 'Full video transcript used' : 'Captures & notes only'}
            </div>
        </div>`;

    quizContainer.querySelectorAll('.quiz-bd-rewatch').forEach(btn =>
        btn.addEventListener('click', async () => {
            const t = parseInt(btn.dataset.time) || 0;
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab?.url?.includes('youtube.com/watch')) {
                    // Seek the existing tab — no new tab opened
                    await chrome.tabs.sendMessage(tab.id, { action: 'seekTo', time: t });
                    window.close(); // close popup so the video is visible
                }
            } catch {
                // Fallback: focus the tab if messaging fails
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
                if (tab) chrome.tabs.update(tab.id, { active: true });
            }
        })
    );
    document.getElementById('quiz-retry-btn').addEventListener('click', () => {
        quizState.current = 0; quizState.score = 0; quizState.answers = []; quizState.active = true;
        renderQuizQuestion(0);
    });
    document.getElementById('quiz-new-btn').addEventListener('click', startQuiz);
}

// ── Show idle screen when Quiz tab first clicked ──
document.querySelectorAll('.tab[data-panel="quiz"]').forEach(tab => {
    tab.addEventListener('click', () => {
        if (!quizState.active && !quizState.questions.length) renderQuizIdle();
    });
});

// =============================================================================
// FLASHCARD FEATURE
// =============================================================================
let flashcardData = [];
const flashcardsContainer = document.getElementById('flashcards-container');
const generateFlashcardsBtn = document.getElementById('generate-flashcards-btn');

// Enable generate button when we have a video  
function updateFlashcardButtonState() {
    if (generateFlashcardsBtn) {
        generateFlashcardsBtn.disabled = !videoId || timestamps.length === 0;
    }
}

// Build context from notes (reuses quiz context builder)
function buildFlashcardContext() {
    return buildQuizContext();
}

// Generate flashcards
async function generateFlashcards() {
    if (!videoId) { showToast('Open a YouTube video first', 'error'); return; }

    generateFlashcardsBtn.disabled = true;
    generateFlashcardsBtn.innerHTML = `
        <div style="width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite"></div>
        Generating flashcards...
    `;
    flashcardsContainer.innerHTML = '';

    try {
        // Try transcript first, fall back to notes
        let context = '';
        try {
            const transcript = await fetchTranscript();
            if (transcript) context = `VIDEO: ${videoTitle}\n\nTRANSCRIPT:\n${transcript.slice(0, 6000)}`;
        } catch (_) { }

        if (!context) {
            context = buildFlashcardContext();
        }

        if (!context || context.length < 30) {
            showToast('Not enough content — capture some notes first', 'warn');
            return;
        }

        const res = await fetch(`${BACKEND_URL}/api/ai/flashcards`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ context })
        });
        if (!res.ok) {
            let errMsg = `Flashcard generation failed: ${res.status}`;
            try { const errData = await res.json(); if (errData.error) errMsg = errData.error; } catch (_) {}
            throw new Error(errMsg);
        }
        const data = await res.json();

        if (!Array.isArray(data?.cards) || !data.cards.length) throw new Error('No flashcards returned');

        flashcardData = data.cards;
        renderFlashcards(data.cards, data.title || 'Flashcards');
        showToast(`${data.cards.length} flashcards created!`, 'success');
    } catch (err) {
        showToast('Flashcard generation failed: ' + err.message, 'error');
    } finally {
        generateFlashcardsBtn.disabled = !videoId || timestamps.length === 0;
        generateFlashcardsBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="6" width="20" height="14" rx="2" />
                <path d="M12 6V2" />
                <path d="M2 12h20" />
            </svg>
            Generate Flashcards from Notes
        `;
    }
}

// Render flashcards
function renderFlashcards(cards, title) {
    let currentIdx = 0;
    const total = cards.length;

    function render() {
        const card = cards[currentIdx];
        flashcardsContainer.innerHTML = `
            <div style="text-align:center;margin-bottom:10px">
                <div style="font-size:.78rem;font-weight:700;color:var(--text)">${escHtml(title)}</div>
                <div style="font-size:.65rem;color:var(--muted);margin-top:2px">${currentIdx + 1} / ${total}</div>
            </div>
            <div class="flashcard" id="active-flashcard" style="min-height:140px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;cursor:pointer;position:relative;transition:all .2s">
                <div style="font-size:.6rem;font-weight:700;color:var(--accent-l);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${escHtml(card.topic || '')}</div>
                <div id="flashcard-front" style="font-size:.84rem;line-height:1.5;color:var(--text)">${renderMathSimple(card.front)}</div>
                <div id="flashcard-back" style="display:none;font-size:.82rem;line-height:1.5;color:var(--green)">${renderMathSimple(card.back)}</div>
                <div style="position:absolute;bottom:8px;right:12px;font-size:.6rem;color:var(--muted)" id="flashcard-hint">Tap to flip</div>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;justify-content:center">
                <button class="btn" id="fc-prev" style="flex:1;justify-content:center;gap:4px;padding:8px;background:var(--card);border:1px solid var(--border);color:var(--text);font-size:.75rem" ${currentIdx === 0 ? 'disabled' : ''}>← Prev</button>
                <button class="btn" id="fc-next" style="flex:1;justify-content:center;gap:4px;padding:8px;background:linear-gradient(135deg,#E50914,#B81D24);color:#fff;font-size:.75rem;border:none">${currentIdx === total - 1 ? '↻ Restart' : 'Next →'}</button>
            </div>
        `;

        // Flip card
        let flipped = false;
        document.getElementById('active-flashcard').addEventListener('click', () => {
            flipped = !flipped;
            document.getElementById('flashcard-front').style.display = flipped ? 'none' : 'block';
            document.getElementById('flashcard-back').style.display = flipped ? 'block' : 'none';
            document.getElementById('flashcard-hint').textContent = flipped ? 'Tap to see question' : 'Tap to flip';
        });

        // Navigation
        document.getElementById('fc-prev').addEventListener('click', () => {
            if (currentIdx > 0) { currentIdx--; render(); }
        });
        document.getElementById('fc-next').addEventListener('click', () => {
            if (currentIdx < total - 1) { currentIdx++; render(); }
            else { currentIdx = 0; render(); }
        });
    }

    render();
}

// Simple math renderer for flashcards
function renderMathSimple(text) {
    if (!text) return '';
    try {
        return text.replace(/\$\$(.*?)\$\$/g, (_, tex) => {
            try { return katex.renderToString(tex, { displayMode: true }); } catch (_) { return `$$${tex}$$`; }
        }).replace(/\$(.*?)\$/g, (_, tex) => {
            try { return katex.renderToString(tex, { displayMode: false }); } catch (_) { return `$${tex}$`; }
        });
    } catch (_) { return escHtml(text); }
}

if (generateFlashcardsBtn) {
    generateFlashcardsBtn.addEventListener('click', generateFlashcards);
}

// Update flashcard button state whenever data changes
const _origRenderAllNotes = typeof renderAllNotes === 'function' ? renderAllNotes : null;
if (_origRenderAllNotes) {
    const _patchedRenderAllNotes = function () {
        _origRenderAllNotes.apply(this, arguments);
        updateFlashcardButtonState();
    };
    // Try to wire into the existing flow
}
// Also update on the Flashcards tab click
document.querySelectorAll('.tab[data-panel="flashcards"]').forEach(tab => {
    tab.addEventListener('click', updateFlashcardButtonState);
});

// =============================================================================
// HISTORY FEATURE — View all saved notes across videos
// =============================================================================

let historyData = [];
let historyLoaded = false;
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const historySearch = document.getElementById('history-search');
const historyRefreshBtn = document.getElementById('history-refresh-btn');

// Format relative date
function formatHistoryDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

// Show loading skeleton
function showHistorySkeleton() {
    historyList.innerHTML = Array.from({ length: 4 }, () => `
        <div class="history-skeleton">
            <div class="history-skeleton-line medium"></div>
            <div class="history-skeleton-line short"></div>
        </div>
    `).join('');
    historyEmpty.style.display = 'none';
}

// Fetch history from backend
async function loadHistory(force = false) {
    if (!authToken) return;
    if (historyLoaded && !force) { renderHistory(); return; }

    showHistorySkeleton();
    historyRefreshBtn?.classList.add('spinning');

    try {
        const res = await fetch(`${BACKEND_URL}/api/videos`, { headers: authHeaders() });
        if (!res.ok) throw new Error('Failed to fetch history');
        historyData = await res.json();
        historyLoaded = true;
        renderHistory();
    } catch (err) {
        historyList.innerHTML = '';
        historyEmpty.style.display = 'block';
        historyEmpty.querySelector('p').textContent = 'Failed to load history';
        historyEmpty.querySelector('span').textContent = err.message;
        console.error('History load error:', err);
    } finally {
        historyRefreshBtn?.classList.remove('spinning');
    }
}

// Render history cards
function renderHistory() {
    const query = (historySearch?.value || '').trim().toLowerCase();
    const filtered = query
        ? historyData.filter(v => (v.videoTitle || '').toLowerCase().includes(query) || (v.pdfTitleVal || '').toLowerCase().includes(query))
        : historyData;

    historyList.innerHTML = '';

    if (!filtered.length) {
        historyEmpty.style.display = 'block';
        if (query) {
            historyEmpty.querySelector('p').textContent = 'No matching notes';
            historyEmpty.querySelector('span').textContent = `No results for "${query}"`;
        } else {
            historyEmpty.querySelector('p').textContent = 'No saved notes yet';
            historyEmpty.querySelector('span').textContent = 'Your notes will appear here after you capture frames on YouTube videos';
        }
        return;
    }

    historyEmpty.style.display = 'none';

    filtered.forEach((v, idx) => {
        const card = document.createElement('div');
        card.className = 'history-card';
        card.style.animationDelay = `${idx * 30}ms`;

        // Initials for thumbnail
        const initials = (v.videoTitle || 'UN')
            .split(' ')
            .filter(w => w.length > 0)
            .slice(0, 2)
            .map(w => w[0].toUpperCase())
            .join('');

        const sharedBadge = v.sharedRoomId
            ? `<span class="history-shared-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/></svg>Shared</span>`
            : '';

        const isCurrentVideo = v.videoId === videoId;

        card.innerHTML = `
            <div class="history-card-top">
                <div class="history-card-thumb">${initials}</div>
                <div class="history-card-info">
                    <div class="history-card-title" title="${escapeHtml(v.videoTitle)}">${escapeHtml(v.videoTitle)}${sharedBadge}</div>
                    <div class="history-card-meta">
                        <span class="history-card-stat">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                            </svg>
                            ${v.noteCount} note${v.noteCount !== 1 ? 's' : ''}
                        </span>
                        <span class="history-card-stat">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                            ${v.qaCount} Q&A
                        </span>
                        <span class="history-card-date">${formatHistoryDate(v.savedAt)}</span>
                    </div>
                </div>
            </div>
            <div class="history-card-actions">
                <button class="history-btn-open" data-vid="${v.videoId}" title="Open this video on YouTube">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    ${isCurrentVideo ? 'Current Video' : 'Open on YouTube'}
                </button>
                <button class="history-btn-pdf" data-vid="${v.videoId}" data-title="${escapeHtml(v.videoTitle)}" title="Download PDF">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    PDF
                </button>
                <button class="history-btn-delete" data-vid="${v.videoId}" title="Delete saved notes">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    </svg>
                </button>
            </div>
        `;

        historyList.appendChild(card);
    });

    // Wire open buttons
    historyList.querySelectorAll('.history-btn-open').forEach(btn => {
        btn.addEventListener('click', () => {
            const vid = btn.dataset.vid;
            if (vid) {
                window.open(`https://www.youtube.com/watch?v=${vid}`, '_blank');
            }
        });
    });

    // Wire PDF download buttons
    historyList.querySelectorAll('.history-btn-pdf').forEach(btn => {
        btn.addEventListener('click', async () => {
            const vid = btn.dataset.vid;
            if (!vid) return;
            btn.disabled = true;
            const origHTML = btn.innerHTML;
            btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .7s linear infinite"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ...';

            try {
                await downloadHistoryPDF(vid);
            } catch (err) {
                showToast('PDF failed: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = origHTML;
            }
        });
    });

    // Wire delete buttons
    historyList.querySelectorAll('.history-btn-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const vid = btn.dataset.vid;
            if (!vid) return;

            const card = btn.closest('.history-card');
            const title = card?.querySelector('.history-card-title')?.textContent || 'this video';

            // Confirm deletion
            btn.innerHTML = '<span style="font-size:.6rem">Sure?</span>';
            btn.style.background = 'rgba(239, 68, 68, .15)';

            // Second click to confirm
            const confirmHandler = async () => {
                btn.removeEventListener('click', confirmHandler);
                try {
                    const res = await fetch(`${BACKEND_URL}/api/videos/${vid}`, {
                        method: 'DELETE',
                        headers: authHeaders()
                    });
                    if (res.ok || res.status === 404) {
                        historyData = historyData.filter(v => v.videoId !== vid);
                        card.style.opacity = '0';
                        card.style.transform = 'translateX(20px)';
                        card.style.transition = 'all .25s ease';
                        setTimeout(() => { card.remove(); renderHistory(); }, 250);
                        showToast('Notes deleted', 'info');
                    } else {
                        showToast('Delete failed', 'error');
                    }
                } catch (err) {
                    showToast('Delete failed: ' + err.message, 'error');
                }
            };

            // Wait a tick then add confirm handler
            setTimeout(() => {
                btn.addEventListener('click', confirmHandler, { once: true });
                // Reset after 3 seconds if not confirmed
                setTimeout(() => {
                    btn.removeEventListener('click', confirmHandler);
                    btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
                    btn.style.background = '';
                }, 3000);
            }, 50);
        });
    });
}

// Download PDF for a video from history — temporarily swaps global state
async function downloadHistoryPDF(histVideoId) {
    // Save current global state
    const savedTimestamps = timestamps;
    const savedAiResponses = aiResponses;
    const savedVideoTitle = videoTitle;
    const savedVideoId = videoId;
    const savedPdfTitleVal = pdfTitle.value;

    try {
        showToast('Fetching notes & generating PDF...', 'loading');

        // Fetch full video data from backend
        const res = await fetch(`${BACKEND_URL}/api/videos/${histVideoId}`, { headers: authHeaders() });
        if (!res.ok) throw new Error('Could not fetch video data');
        const data = await res.json();

        // Temporarily set global state to the fetched video
        timestamps = data.timestamps || [];
        aiResponses = data.aiResponses || [];
        videoTitle = data.videoTitle || 'Study Notes';
        videoId = data.videoId || histVideoId;
        pdfTitle.value = data.pdfTitleVal || data.videoTitle || 'Study Notes';

        if (!timestamps.length && !aiResponses.length) {
            throw new Error('No notes found for this video');
        }

        // Call existing PDF generator
        await makePDF();
    } finally {
        // Restore original global state
        timestamps = savedTimestamps;
        aiResponses = savedAiResponses;
        videoTitle = savedVideoTitle;
        videoId = savedVideoId;
        pdfTitle.value = savedPdfTitleVal;
    }
}

// Search filtering
historySearch?.addEventListener('input', () => renderHistory());

// Refresh button
historyRefreshBtn?.addEventListener('click', () => loadHistory(true));

// Auto-load history when History tab is clicked
document.querySelectorAll('.tab[data-panel="history"]').forEach(tab => {
    tab.addEventListener('click', () => loadHistory());
});