// ============ CONFIG ============
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_CHAT = 'llama-3.3-70b-versatile';
const MODEL_VISION = 'meta-llama/llama-4-scout-17b-16e-instruct';

// ============ AI HELPER (Groq) ============
async function callAI(messages, opts = {}) {
    if (!GROQ_KEY) throw new Error('API key not configured — check config.js');
    const model = opts.model || MODEL_CHAT;
    const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_KEY}`
        },
        body: JSON.stringify({
            model,
            messages,
            temperature: opts.temperature ?? 0.7,
            max_tokens: opts.max_tokens ?? 1024
        })
    });

    if (!res.ok) {
        const errBody = await res.text();
        console.error(`Groq [${model}] error ${res.status}:`, errBody);
        let detail = '';
        try { detail = JSON.parse(errBody)?.error?.message || errBody; } catch (_) { detail = errBody; }
        throw new Error(`${res.status} — ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from Groq');
    return text;
}

// ============ STATE ============
let videoId = '';
let videoTitle = '';
let timestamps = [];
let aiResponses = [];

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

// ============ INIT ============
document.addEventListener('DOMContentLoaded', init);

async function init() {
    detectVideo();
}

async function detectVideo() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes('youtube.com/watch')) {
            setStatus(false, 'Open a YouTube video');
            return;
        }

        const info = await chrome.tabs.sendMessage(tab.id, { action: 'getVideoInfo' });

        if (info && (info.hasVideo || info.videoId)) {
            videoId = info.videoId || '';
            videoTitle = info.title || '';
            setStatus(true, 'Video detected');
            videoBar.style.display = 'flex';
            vidTitleEl.textContent = videoTitle || 'YouTube Video';
            // Don't pre-fill — let user type custom title; falls back to video title on export

            await loadData();
        } else {
            setStatus(false, 'No video found');
        }
    } catch (err) {
        console.error('Detection error:', err);
        setStatus(false, 'Refresh YouTube tab');
    }
}

function setStatus(online, text) {
    statusEl.className = `status ${online ? 'online' : 'offline'}`;
    statusText.textContent = text;
}

// ============ PERSISTENCE (chrome.storage.local) ============
async function saveData() {
    if (!videoId) return;
    try {
        await chrome.storage.local.set({
            [`np_${videoId}`]: {
                timestamps,
                aiResponses,
                videoTitle,
                videoId,
                pdfTitleVal: pdfTitle.value,
                savedAt: Date.now()
            }
        });
    } catch (e) { console.error('Save error:', e); }
}

async function loadData() {
    if (!videoId) return;
    try {
        const key = `np_${videoId}`;
        const result = await chrome.storage.local.get(key);
        const data = result[key];
        if (data) {
            timestamps = data.timestamps || [];
            aiResponses = data.aiResponses || [];
            if (data.videoTitle) videoTitle = data.videoTitle;
            if (data.pdfTitleVal) pdfTitle.value = data.pdfTitleVal;
            vidTitleEl.textContent = videoTitle || 'YouTube Video';

            renderNotes();
            updateExport();

            // Restore AI chat messages
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
        if (!tab || !tab.url?.includes('youtube.com/watch')) {
            showToast('Open a YouTube video first', 'error');
            return;
        }

        const info = await chrome.tabs.sendMessage(tab.id, { action: 'getVideoInfo' });
        if (!info || !info.hasVideo) {
            showToast('Video not playing yet', 'error');
            return;
        }

        const screenshot = await chrome.tabs.captureVisibleTab(null, {
            format: 'jpeg', quality: 92
        });

        const frame = await cropToVideo(screenshot, info.rect, info.devicePixelRatio);

        const t = Math.floor(info.currentTime);
        const label = `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;

        if (info.title && !videoTitle) {
            videoTitle = info.title;
            vidTitleEl.textContent = videoTitle;
        }

        timestamps.push({
            id: Date.now().toString(),
            timestamp: label,
            videoTime: t,
            note: '',
            snapshot: frame,
            ocrText: ''
        });

        renderNotes();
        updateExport();
        await saveData();
        showToast(`Captured at ${label}`, 'success');
    } catch (err) {
        console.error('Capture error:', err);
        showToast('Capture failed — try refreshing YouTube', 'error');
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

// ============ KATEX MATH RENDERING ============
// Format plain text with basic markdown: headings, bold, diagram brackets
function formatMarkdown(html) {
    // ## Heading → bold heading line
    html = html.replace(/^(#{1,3})\s+(.+)$/gm, (m, hashes, content) => {
        const size = hashes.length === 1 ? '1em' : hashes.length === 2 ? '.92em' : '.85em';
        return `<strong style="display:block;font-size:${size};margin:.3em 0 .15em">${content}</strong>`;
    });
    // **bold**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // [Diagram: ...] → styled tag
    html = html.replace(/\[Diagram:\s*(.+?)\]/gi,
        '<span class="diagram-tag">[Diagram: $1]</span>');
    // Convert newlines to breaks for proper paragraph spacing
    html = html.replace(/\n/g, '<br>');
    return html;
}

function renderWithMath(text) {
    if (typeof katex === 'undefined') return formatMarkdown(escapeHtml(text));

    const parts = [];
    let lastIndex = 0;

    // Match $$...$$ (display) and $...$ (inline) patterns
    const regex = /\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        // Add formatted text before this match
        if (match.index > lastIndex) {
            parts.push(formatMarkdown(escapeHtml(text.slice(lastIndex, match.index))));
        }

        const displayMath = match[1]; // from $$...$$
        const inlineMath = match[2];  // from $...$

        try {
            if (displayMath !== undefined) {
                parts.push(katex.renderToString(displayMath.trim(), {
                    displayMode: true, throwOnError: false
                }));
            } else {
                parts.push(katex.renderToString(inlineMath.trim(), {
                    displayMode: false, throwOnError: false
                }));
            }
        } catch (e) {
            parts.push(escapeHtml(match[0]));
        }

        lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
        parts.push(formatMarkdown(escapeHtml(text.slice(lastIndex))));
    }

    return parts.join('');
}

function hasMath(text) {
    return /\$[\s\S]*?\$/.test(text);
}

// Strip $ delimiters for plain text contexts (PDF fallback)
function stripMathDelimiters(text) {
    if (!text) return '';
    return text.replace(/\$\$([\s\S]*?)\$\$/g, '$1').replace(/\$([^\$\n]+?)\$/g, '$1');
}

// ============ MATH → IMAGE via KaTeX + html2canvas ============
// Renders a LaTeX formula with KaTeX into a hidden DOM node,
// then screenshots it with html2canvas at 3× for crisp PDF output.
async function mathExprToImage(formula, isDisplay, pdfFontSizePt = 9) {
    if (typeof katex === 'undefined' || typeof html2canvas === 'undefined') return null;

    // Scale font: PDF pts → screen px (96 dpi) × a readability boost
    const RENDER_SCALE = 3;                     // html2canvas device scale
    const FONT_PX = Math.round(pdfFontSizePt * (96 / 72) * 1.35);
    const PX_TO_MM = 25.4 / 96;

    // ── 1. Build a white, off-screen wrapper ──
    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
        'position:fixed',
        'left:-99999px',
        'top:-99999px',
        'background:#ffffff',
        'color:#111119',
        `font-size:${FONT_PX}px`,
        `display:${isDisplay ? 'block' : 'inline-block'}`,
        `padding:${isDisplay ? '6px 10px' : '2px 5px'}`,
        'line-height:1.5',
        'white-space:nowrap',
        'z-index:-1',
    ].join(';');

    // ── 2. Render KaTeX (HTML output for best fidelity) ──
    try {
        katex.render(formula, wrapper, {
            displayMode: isDisplay,
            throwOnError: false,
            output: 'html',
            trust: false,
        });
    } catch (e) {
        console.warn('[NotePilot] KaTeX render error:', e);
        return null;
    }

    // Force every KaTeX element to use dark ink (popup dark theme fights us otherwise)
    wrapper.querySelectorAll('*').forEach(el => {
        el.style.color = '#111119';
        el.style.borderColor = '#111119';
    });

    document.body.appendChild(wrapper);

    try {
        // ── 3. Capture with html2canvas ──
        const canvas = await html2canvas(wrapper, {
            backgroundColor: '#ffffff',
            scale: RENDER_SCALE,
            logging: false,
            useCORS: false,
            allowTaint: false,
            removeContainer: false,   // we remove it ourselves
        });

        document.body.removeChild(wrapper);

        // ── 4. Convert canvas pixels → mm ──
        // canvas.width / RENDER_SCALE = logical px; logical px × PX_TO_MM = mm
        const widthMm = (canvas.width / RENDER_SCALE) * PX_TO_MM;
        const heightMm = (canvas.height / RENDER_SCALE) * PX_TO_MM;

        return {
            dataUrl: canvas.toDataURL('image/png'),
            widthMm,
            heightMm,
        };
    } catch (e) {
        // Clean up even on error
        if (document.body.contains(wrapper)) document.body.removeChild(wrapper);
        console.warn('[NotePilot] html2canvas error:', e);
        return null;
    }
}

// ============ RICH TEXT + MATH-AS-IMAGES → PDF ============
// Renders paragraphs, headings, bullets, inline $math$, and display $$math$$ blocks.
// Math expressions are rasterised via MathJax SVG → canvas → PNG image in the PDF.
async function addTextWithNativeMathPdf(pdf, fullText, x, y, maxW, fontSize, r, g, b, ph, m) {
    pdf.setFontSize(fontSize);
    pdf.setTextColor(r, g, b);
    const LH = fontSize * 0.43;  // line-height (mm)
    const PG = LH * 0.6;         // paragraph gap

    const ensurePage = need => { if (y + need > ph - m) { pdf.addPage(); y = m; } };
    const spW = () => pdf.getTextWidth(' ');

    // Break one line of text into { type:'text'|'math', content } segments
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

            // ── Display math block  $$...$$ ──
            const disp = line.match(/^\$\$([\s\S]*?)\$\$$/);
            if (disp) {
                const im = await mathExprToImage(disp[1].trim(), true, fontSize * 1.15);
                ensurePage((im?.heightMm ?? LH) + 5);
                if (im) {
                    const ix = x + (maxW - im.widthMm) / 2;
                    pdf.addImage(im.dataUrl, 'PNG', ix, y + 0.5, im.widthMm, im.heightMm);
                    y += im.heightMm + 3;
                } else {
                    const clean = disp[1].trim();
                    pdf.setTextColor(80, 80, 200);
                    const tl = pdf.splitTextToSize(clean, maxW);
                    pdf.text(tl, x + maxW / 2, y, { align: 'center' });
                    pdf.setTextColor(r, g, b);
                    y += tl.length * LH + 2;
                }
                continue;
            }

            // ── Heading  # / ## / ### ──
            const hm = line.match(/^(#{1,3})\s+(.+)$/);
            if (hm) {
                const hSz = fontSize + (4 - hm[1].length) * 1.5;
                ensurePage(hSz * 0.45 + 2);
                pdf.setFontSize(hSz);
                pdf.setFont(undefined, 'bold');
                pdf.setTextColor(r, g, b);
                const ht = hm[2].replace(/\*\*(.*?)\*\*/g, '$1').replace(/\$([^$]*)\$/g, '$1');
                const hl = pdf.splitTextToSize(ht, maxW);
                pdf.text(hl, x, y);
                y += hl.length * (hSz * 0.43) + 1;
                pdf.setFont(undefined, 'normal');
                pdf.setFontSize(fontSize);
                pdf.setTextColor(r, g, b);
                continue;
            }

            // ── Bullet / numbered list ──
            let indent = 0, prefix = '';
            let content = line;
            const bm = line.match(/^[-•*]\s+(.+)$/);
            const nm = line.match(/^(\d+)\.\s+(.+)$/);
            if (bm) { indent = 4; prefix = '•'; content = bm[1]; }
            else if (nm) { indent = 4; prefix = nm[1] + '.'; content = nm[2]; }

            const indentX = x + indent;
            const hasMath = /\$/.test(content);
            ensurePage(LH + 2);

            if (!hasMath) {
                // ── Pure text line ──
                const clean = content.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`(.*?)`/g, '$1');
                if (prefix) { pdf.setTextColor(r, g, b); pdf.text(prefix, x, y); }
                const tl = pdf.splitTextToSize(clean, maxW - indent);
                pdf.text(tl, indentX, y);
                y += tl.length * LH;
            } else {
                // ── Mixed text + inline math ──
                if (prefix) { pdf.setTextColor(r, g, b); pdf.text(prefix, x, y); }
                const segs = tokeniseLine(content);

                // State: tracks current x position within the line
                const st = { cx: indentX, ly: y };

                for (const seg of segs) {
                    if (seg.type === 'text') {
                        const words = seg.content.replace(/\*\*(.*?)\*\*/g, '$1').split(/(\s+)/);
                        for (const w of words) {
                            if (!w) continue;
                            if (/^\s+$/.test(w)) { st.cx += spW(); continue; }
                            const ww = pdf.getTextWidth(w);
                            if (st.cx + ww > x + maxW) {
                                st.ly += LH; ensurePage(LH); st.cx = indentX;
                            }
                            pdf.setTextColor(r, g, b);
                            pdf.text(w, st.cx, st.ly);
                            st.cx += ww;
                        }
                    } else {
                        // Inline math → image
                        const im = await mathExprToImage(seg.content, false, fontSize);
                        if (im) {
                            if (st.cx + im.widthMm > x + maxW) {
                                st.ly += LH; ensurePage(LH + im.heightMm); st.cx = indentX;
                            }
                            // Align image baseline with text baseline (~75% above baseline)
                            const iy = st.ly - im.heightMm * 0.78;
                            pdf.addImage(im.dataUrl, 'PNG', st.cx, iy, im.widthMm, im.heightMm);
                            st.cx += im.widthMm + 0.4;
                        } else {
                            // MathJax unavailable — plain fallback
                            const plain = seg.content;
                            const pw2 = pdf.getTextWidth(plain);
                            if (st.cx + pw2 > x + maxW) { st.ly += LH; st.cx = indentX; }
                            pdf.setTextColor(100, 80, 200);
                            pdf.text(plain, st.cx, st.ly);
                            pdf.setTextColor(r, g, b);
                            st.cx += pw2;
                        }
                    }
                }
                y = st.ly + LH;
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

        el.innerHTML = `
            <div class="cap-top">
                <a class="cap-link" data-time="${ts.videoTime}">
                    <span class="cap-badge">${ts.timestamp}</span>
                    Note #${i + 1}
                </a>
                <button class="cap-del" data-id="${ts.id}" title="Delete">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
            </div>
            <div class="cap-img"><img src="${ts.snapshot}" alt="Frame at ${ts.timestamp}"></div>
            <div class="cap-actions">
                <button class="btn-ocr" data-id="${ts.id}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    Extract Text
                </button>
                ${explainBtnHtml}
            </div>
            ${ocrHtml}
            ${explainHtml}
            <textarea class="cap-note" placeholder="Add notes..." data-id="${ts.id}">${ts.note}</textarea>
        `;
        notesList.appendChild(el);
    });

    // Event: click timestamp link
    notesList.querySelectorAll('.cap-link').forEach(link => {
        link.addEventListener('click', () => {
            const vt = link.dataset.time;
            if (videoId) window.open(`https://www.youtube.com/watch?v=${videoId}&t=${vt}s`, '_blank');
        });
    });

    // Event: delete
    notesList.querySelectorAll('.cap-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            timestamps = timestamps.filter(t => t.id !== btn.dataset.id);
            renderNotes();
            updateExport();
            await saveData();
            showToast('Deleted', 'info');
        });
    });

    // Event: note editing
    notesList.querySelectorAll('.cap-note').forEach(ta => {
        ta.addEventListener('input', () => {
            const ts = timestamps.find(t => t.id === ta.dataset.id);
            if (ts) ts.note = ta.value;
        });
        ta.addEventListener('blur', () => saveData());
    });

    // Event: OCR button
    notesList.querySelectorAll('.btn-ocr').forEach(btn => {
        btn.addEventListener('click', () => extractText(btn.dataset.id, btn));
    });

    // Event: Explain button
    notesList.querySelectorAll('.btn-explain').forEach(btn => {
        btn.addEventListener('click', () => explainContent(btn.dataset.id, btn));
    });
}

// ============ OCR — Extract Text + Diagram Descriptions ============
async function extractText(tsId, btnEl) {
    const ts = timestamps.find(t => t.id === tsId);
    if (!ts || !ts.snapshot) return;

    btnEl.disabled = true;
    btnEl.classList.add('loading');
    btnEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Extracting...`;

    const resetBtn = () => {
        btnEl.disabled = false;
        btnEl.classList.remove('loading');
        btnEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Extract Text`;
    };
    try {
        const text = await callAI(
            [{
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `Extract ALL visible text from this image exactly as it appears. Do NOT explain, summarize, or solve anything. Just provide the raw text. Format with clear paragraph breaks. For multiple choice options or lists, place each item on a new line. For mathematical expressions or equations, use simple plain text formatting (e.g. use "3/4" instead of "\\frac{3}{4}", use "√3" instead of "\\sqrt{3}", "csc 10°" instead of "\\csc 10^\\circ"). Do NOT use LaTeX notation. If there are diagrams, charts, figures, or illustrations, describe them in [square brackets] — include labels, arrows, axes, relationships, and key elements. If there is no readable text or visual content, reply with "(no content found)". Again: DO NOT SOLVE OR EXPLAIN.`
                    },
                    { type: 'image_url', image_url: { url: ts.snapshot } }
                ]
            }],
            { model: MODEL_VISION, temperature: 0.1 }
        );

        ts.ocrText = text.trim();
        await saveData();
        renderNotes();
        showToast('Text extracted!', 'success');
    } catch (err) {
        console.error('OCR error:', err);
        showToast(`OCR failed: ${err.message.slice(0, 80)}`, 'error');
        resetBtn();
    }
}

// ============ EXPLAIN CONTENT ============
async function explainContent(tsId, btnEl) {
    const ts = timestamps.find(t => t.id === tsId);
    if (!ts || !ts.ocrText) { showToast('Extract text first', 'error'); return; }

    btnEl.disabled = true;
    btnEl.classList.add('loading');
    const origHtml = btnEl.innerHTML;
    btnEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Explaining...';

    try {
        const explanation = await callAI([
            { role: 'system', content: 'You are a study assistant. Explain the given educational content clearly. Use LaTeX with $ for inline math and $$ for display math. Be educational and concise.' },
            { role: 'user', content: 'Here is text extracted from a video slide:\n\n' + ts.ocrText + '\n\nExplain this content clearly for a student. Break down complex concepts and explain any formulas.' }
        ]);
        ts.aiExplanation = explanation.trim();
        await saveData();
        renderNotes();
        showToast('Explanation generated!', 'success');
    } catch (err) {
        console.error('Explain error:', err);
        showToast('Explanation failed: ' + err.message.slice(0, 80), 'error');
        btnEl.disabled = false;
        btnEl.classList.remove('loading');
        btnEl.innerHTML = origHtml;
    }
}

// ============ AI CHAT (Groq) ============
chatInput.addEventListener('input', () => { sendBtn.disabled = !chatInput.value.trim(); });
chatInput.addEventListener('keypress', e => { if (e.key === 'Enter' && !sendBtn.disabled) sendMsg(); });
sendBtn.addEventListener('click', sendMsg);

async function sendMsg() {
    const q = chatInput.value.trim();
    if (!q) return;

    addMsg('user', q);
    chatInput.value = '';
    sendBtn.disabled = true;
    addMsg('bot', 'Thinking...', true);

    try {
        let sysMsg = 'You are NotePilot AI — a helpful, clear, and concise study assistant.';
        if (videoTitle) {
            sysMsg += ` The student is watching a video titled "${videoTitle}".`;
            sysMsg += ' Use this context to make your answers relevant, but do NOT explicitly mention, quote, or reference the video title in your response. Never say "as discussed in the video" or similar phrases. Just answer the question directly.';
        }
        sysMsg += ' When your answer involves math, use LaTeX notation with $ delimiters for inline math (e.g. $F = ma$) and $$ for display math (e.g. $$E = mc^2$$).';

        // Build multi-turn conversation for better context
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
        updateExport();
        await saveData();

    } catch (err) {
        console.error('AI error:', err);
        removeLast();
        addMsg('bot', `API Error: ${err.message}`);
        showToast('AI request failed', 'error');
    }
}

function buildPrompt(question) {
    let p = '';
    if (videoTitle) {
        p += `VIDEO CONTEXT:\n`;
        p += `Title: "${videoTitle}"\n`;
        if (videoId) p += `URL: youtube.com/watch?v=${videoId}\n`;
        p += '\n';
    }
    if (timestamps.length) {
        p += 'STUDENT\'S CAPTURED NOTES FROM THIS VIDEO:\n';
        timestamps.forEach((ts, i) => {
            p += `[${ts.timestamp}] Note #${i + 1}: ${ts.note || '(no note)'}`;
            if (ts.ocrText) p += `\n   Slide/screen text: ${ts.ocrText.slice(0, 300)}`;
            p += '\n';
        });
        p += '\n';
    }
    p += `STUDENT'S QUESTION: ${question}\n\n`;
    p += 'Answer clearly and educationally. Use the notes and context to give a relevant answer. Use LaTeX math notation ($...$) for equations. Do NOT reference the video title in your answer.';
    return p;
}

function addMsg(role, text, loading = false, qaIndex = -1) {
    const d = document.createElement('div');
    d.className = `msg ${role}${loading ? ' loading' : ''}`;

    // Render math for bot messages (not loading state)
    const content = (role === 'bot' && !loading) ? renderWithMath(text) : escapeHtml(text);

    let toggleHtml = '';
    if (role === 'bot' && !loading && qaIndex >= 0) {
        const checked = aiResponses[qaIndex]?.includedInPdf !== false ? 'checked' : '';
        toggleHtml = '<label class="qa-pdf-toggle" title="Include in PDF export">' +
            '<input type="checkbox" ' + checked + ' data-qa-index="' + qaIndex + '">' +
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
            ' PDF</label>';
    }

    d.innerHTML = '<div class="bubble">' + content + toggleHtml + '</div>';

    // Wire up PDF toggle
    const toggle = d.querySelector('.qa-pdf-toggle input');
    if (toggle) {
        toggle.addEventListener('change', () => {
            const idx = parseInt(toggle.dataset.qaIndex);
            if (aiResponses[idx]) {
                aiResponses[idx].includedInPdf = toggle.checked;
                saveData();
            }
        });
    }

    chatMessages.appendChild(d);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeLast() {
    const msgs = chatMessages.querySelectorAll('.msg');
    if (msgs.length) msgs[msgs.length - 1].remove();
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============ PDF EXPORT ============
exportBtn.addEventListener('click', makePDF);

function updateExport() {
    exportBtn.disabled = !timestamps.length && !aiResponses.length;
}

async function makePDF() {
    if (!timestamps.length && !aiResponses.length) {
        showToast('Nothing to export', 'error'); return;
    }

    showToast('Generating summary & PDF...', 'loading');

    let summary = '';
    try { summary = await generateSummary(); }
    catch (e) { console.warn('AI summary failed:', e.message); summary = buildLocalSummary(); }

    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
        const pw = pdf.internal.pageSize.getWidth();   // 210
        const ph = pdf.internal.pageSize.getHeight();  // 297
        const M = 18;   // margin
        const CW = pw - M * 2; // content width
        const ACCENT = [99, 102, 241];
        const ACCENT2 = [168, 85, 247];
        const TEXT = [30, 30, 52];
        const TEXT2 = [80, 80, 110];
        const MUTED = [130, 130, 160];
        const CARD_BG = [245, 245, 252];
        const BORDER = [220, 220, 238];

        let y = 0;
        const title = pdfTitle.value.trim() || videoTitle || 'Study Notes';

        // ══════════════════════════════════════════
        //  COVER HEADER
        // ══════════════════════════════════════════
        // Dark gradient-like background (two tone)
        pdf.setFillColor(17, 17, 30);
        pdf.rect(0, 0, pw, 52, 'F');
        pdf.setFillColor(13, 13, 22);
        pdf.rect(0, 36, pw, 16, 'F');

        // Purple accent bar at very top
        pdf.setFillColor(...ACCENT);
        pdf.rect(0, 0, pw, 2, 'F');

        // Logo mark — small gradient square
        pdf.setFillColor(...ACCENT);
        pdf.roundedRect(M, 8, 8, 8, 1.5, 1.5, 'F');
        pdf.setFillColor(...ACCENT2);
        pdf.roundedRect(M + 1.5, 9.5, 5, 5, 1, 1, 'F');

        // Brand name
        pdf.setFontSize(7);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(129, 140, 248);
        pdf.text('NOTEPILOT', M + 11, 13.5);

        // Main title
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(238, 238, 245);
        pdf.setFontSize(17);
        const titleLines = pdf.splitTextToSize(title, pw - M * 2 - 20);
        let ty = 24;
        for (const tl of titleLines) { pdf.text(tl, pw / 2, ty, { align: 'center' }); ty += 8; }

        // Subtitle row
        pdf.setFont(undefined, 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(129, 140, 248);
        const userGaveTitle = pdfTitle.value.trim() && pdfTitle.value.trim() !== videoTitle;
        const sub = (userGaveTitle && videoTitle)
            ? `${videoTitle}   ·   ${new Date().toLocaleDateString()}`
            : new Date().toLocaleDateString();
        const subLines = pdf.splitTextToSize(sub, pw - 40);
        pdf.text(subLines, pw / 2, Math.max(ty + 1, 44), { align: 'center' });

        // Bottom accent line
        pdf.setFillColor(...ACCENT);
        pdf.rect(0, 50, pw, 2, 'F');
        pdf.setFillColor(...ACCENT2);
        pdf.rect(pw / 2, 50, pw / 2, 2, 'F');

        y = 62;

        // ── Video link pill ──
        if (videoId) {
            pdf.setFillColor(...CARD_BG);
            pdf.roundedRect(M, y - 4, CW, 9, 2, 2, 'F');
            pdf.setDrawColor(...BORDER);
            pdf.setLineWidth(0.25);
            pdf.roundedRect(M, y - 4, CW, 9, 2, 2, 'D');
            pdf.setFontSize(8);
            pdf.setTextColor(...ACCENT);
            pdf.textWithLink(`▶  youtube.com/watch?v=${videoId}`, M + 4, y + 0.5, {
                url: `https://www.youtube.com/watch?v=${videoId}`
            });
            pdf.setTextColor(...MUTED);
            const stats = `${timestamps.length} capture${timestamps.length !== 1 ? 's' : ''}  ·  ${aiResponses.length} Q&A`;
            pdf.text(stats, pw - M - 4, y + 0.5, { align: 'right' });
            y += 13;
        }

        // ══════════════════════════════════════════
        //  HELPER: draw a section heading bar
        // ══════════════════════════════════════════
        const drawSection = (label, iconChar = '◈') => {
            if (y > ph - 35) { pdf.addPage(); y = M; }
            y += 3;
            pdf.setFillColor(240, 240, 252);
            pdf.roundedRect(M, y - 4.5, CW, 10, 2, 2, 'F');
            pdf.setFillColor(...ACCENT);
            pdf.roundedRect(M, y - 4.5, 3.5, 10, 1, 1, 'F');
            pdf.setFont(undefined, 'bold');
            pdf.setFontSize(10.5);
            pdf.setTextColor(...ACCENT);
            pdf.text(`${iconChar}  ${label}`, M + 8, y + 1.5);
            pdf.setFont(undefined, 'normal');
            y += 10;
        };

        // ══════════════════════════════════════════
        //  VIDEO SUMMARY
        // ══════════════════════════════════════════
        if (summary) {
            drawSection('Video Summary', '◉');
            y += 2;
            y = await addTextWithNativeMathPdf(pdf, summary, M + 2, y, CW - 4, 9, ...TEXT2, ph, M);
            y += 5;
            pdf.setDrawColor(...BORDER);
            pdf.setLineWidth(0.25);
            pdf.line(M, y, pw - M, y);
            y += 6;
        }

        // ══════════════════════════════════════════
        //  CAPTURED NOTES
        // ══════════════════════════════════════════
        if (timestamps.length) {
            drawSection('Captured Notes', '◎');
            y += 2;

            for (let i = 0; i < timestamps.length; i++) {
                const ts = timestamps[i];
                if (y > ph - 90) { pdf.addPage(); y = M; }

                // ── Note card background ──
                const cardStartY = y - 1;
                const estimateH = Math.min(
                    (ts.snapshot ? 60 : 0) +
                    (ts.note ? Math.ceil(ts.note.length / 80) * 5 + 8 : 8) +
                    (ts.ocrText ? Math.ceil(ts.ocrText.length / 80) * 4 + 14 : 0) +
                    (ts.aiExplanation ? Math.ceil(ts.aiExplanation.length / 80) * 4 + 14 : 0) +
                    14,
                    ph - y - M
                );

                pdf.setFillColor(...CARD_BG);
                pdf.roundedRect(M, cardStartY, CW, estimateH, 2.5, 2.5, 'F');
                pdf.setDrawColor(...BORDER);
                pdf.setLineWidth(0.2);
                pdf.roundedRect(M, cardStartY, CW, estimateH, 2.5, 2.5, 'D');

                // Left accent stripe
                pdf.setFillColor(...ACCENT);
                pdf.roundedRect(M, cardStartY, 3, estimateH, 1.5, 1.5, 'F');

                y += 3;

                // ── Timestamp pill ──
                pdf.setFillColor(...ACCENT);
                pdf.roundedRect(M + 6, y - 3.2, 36, 6.5, 1.5, 1.5, 'F');
                pdf.setFont(undefined, 'bold');
                pdf.setFontSize(7.5);
                pdf.setTextColor(255, 255, 255);
                pdf.textWithLink(`▶  ${ts.timestamp}   —   Note #${i + 1}`, M + 8, y + 0.2, {
                    url: `https://www.youtube.com/watch?v=${videoId}&t=${ts.videoTime}s`
                });
                pdf.setFont(undefined, 'normal');
                y += 8;

                // ── Snapshot image ──
                if (ts.snapshot && ts.snapshot.startsWith('data:')) {
                    try {
                        const imgW = Math.min(CW * 0.72, 116);
                        const imgH = imgW * (9 / 16);
                        if (y + imgH > ph - M - 10) { pdf.addPage(); y = M; }
                        // Subtle shadow / border
                        pdf.setFillColor(200, 200, 220);
                        pdf.roundedRect(M + 7, y + 0.5, imgW, imgH, 2, 2, 'F');
                        pdf.addImage(ts.snapshot, 'JPEG', M + 7, y, imgW, imgH, '', 'FAST');
                        pdf.setDrawColor(...BORDER);
                        pdf.setLineWidth(0.3);
                        pdf.roundedRect(M + 7, y, imgW, imgH, 2, 2, 'D');
                        y += imgH + 5;
                    } catch (_) { /* skip broken images */ }
                }

                // ── User note ──
                const noteText = (ts.note || '').trim();
                if (noteText) {
                    pdf.setFontSize(8.5);
                    pdf.setTextColor(...TEXT2);
                    y = await addTextWithNativeMathPdf(pdf, noteText, M + 7, y, CW - 16, 8.5, ...TEXT2, ph, M);
                    y += 3;
                }

                // ── OCR extracted text ──
                if (ts.ocrText) {
                    // Header
                    pdf.setFillColor(230, 228, 252);
                    pdf.roundedRect(M + 7, y - 2, CW - 14, 7, 1.2, 1.2, 'F');
                    pdf.setFontSize(7);
                    pdf.setFont(undefined, 'bold');
                    pdf.setTextColor(...ACCENT);
                    pdf.text('● EXTRACTED TEXT', M + 10, y + 2);
                    pdf.setFont(undefined, 'normal');
                    y += 8;

                    // Content
                    pdf.setFontSize(7.5);
                    pdf.setTextColor(...TEXT2);
                    y = await addTextWithNativeMathPdf(pdf, ts.ocrText, M + 9, y, CW - 18, 7.5, ...TEXT2, ph, M);
                    y += 3;
                }

                // ── AI explanation ──
                if (ts.aiExplanation) {
                    pdf.setFillColor(245, 235, 255);
                    pdf.roundedRect(M + 7, y - 2, CW - 14, 7, 1.2, 1.2, 'F');
                    pdf.setFontSize(7);
                    pdf.setFont(undefined, 'bold');
                    pdf.setTextColor(...ACCENT2);
                    pdf.text('✦ AI EXPLANATION', M + 10, y + 2);
                    pdf.setFont(undefined, 'normal');
                    y += 8;

                    pdf.setFontSize(7.5);
                    pdf.setTextColor(...TEXT2);
                    y = await addTextWithNativeMathPdf(pdf, ts.aiExplanation, M + 9, y, CW - 18, 7.5, ...TEXT2, ph, M);
                    y += 3;
                }

                y += 8; // card bottom padding
            }
        }

        // ══════════════════════════════════════════
        //  AI Q&A
        // ══════════════════════════════════════════
        const selectedQA = aiResponses.filter(qa => qa.includedInPdf !== false);
        if (selectedQA.length) {
            if (y > ph - 40) { pdf.addPage(); y = M; }
            drawSection('AI Q&A', '◆');
            y += 2;

            for (let i = 0; i < selectedQA.length; i++) {
                const qa = selectedQA[i];
                if (y > ph - 30) { pdf.addPage(); y = M; }

                // Question chip
                pdf.setFillColor(230, 228, 252);
                pdf.roundedRect(M, y - 3.5, CW, 8, 1.5, 1.5, 'F');
                pdf.setDrawColor(...ACCENT);
                pdf.setLineWidth(0.2);
                pdf.roundedRect(M, y - 3.5, CW, 8, 1.5, 1.5, 'D');
                pdf.setFont(undefined, 'bold');
                pdf.setFontSize(8.5);
                pdf.setTextColor(...ACCENT);
                const qLabel = `Q${i + 1}`;
                pdf.text(qLabel, M + 3, y + 1.2);
                pdf.setFont(undefined, 'normal');
                pdf.setFontSize(8.5);
                pdf.setTextColor(...TEXT);
                const qText = pdf.splitTextToSize(qa.question, CW - 14);
                pdf.text(qText, M + 12, y + 1.2);
                y += Math.max(qText.length * 3.8, 8) + 3;

                // Answer
                y = await addTextWithNativeMathPdf(pdf, qa.answer, M + 4, y, CW - 8, 8.5, ...TEXT2, ph, M);
                y += 8;

                if (i < selectedQA.length - 1) {
                    pdf.setDrawColor(...BORDER);
                    pdf.setLineWidth(0.2);
                    pdf.line(M, y - 3, pw - M, y - 3);
                }
            }
        }

        // ══════════════════════════════════════════
        //  PAGE FOOTERS (applied after all content)
        // ══════════════════════════════════════════
        const totalPages = pdf.internal.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
            pdf.setPage(p);
            pdf.setFillColor(245, 245, 252);
            pdf.rect(0, ph - 10, pw, 10, 'F');
            pdf.setFillColor(...ACCENT);
            pdf.rect(0, ph - 10, pw, 0.7, 'F');
            pdf.setFontSize(6.5);
            pdf.setFont(undefined, 'normal');
            pdf.setTextColor(...MUTED);
            pdf.text('Generated by NotePilot', M, ph - 4.5);
            pdf.setTextColor(...ACCENT);
            pdf.text(`${p} / ${totalPages}`, pw - M, ph - 4.5, { align: 'right' });
            if (videoTitle && p > 1) {
                pdf.setTextColor(...MUTED);
                pdf.text(videoTitle.slice(0, 60), pw / 2, ph - 4.5, { align: 'center' });
            }
        }

        const safeName = title.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') || 'Study_Notes';
        pdf.save(`${safeName}.pdf`);
        showToast('PDF downloaded!', 'success');
    } catch (err) {
        console.error('PDF error:', err);
        showToast('PDF generation failed', 'error');
    }
}

// ============ GENERATE VIDEO SUMMARY ============
async function generateSummary() {
    let prompt = 'Generate a concise 3-5 sentence summary of this YouTube video for study notes.\n\n';
    if (videoTitle) prompt += `Video title: "${videoTitle}"\n`;
    if (timestamps.length) {
        prompt += 'Captured notes from the video:\n';
        timestamps.forEach(ts => {
            prompt += `- [${ts.timestamp}] ${ts.note || '(no note)'}`;
            if (ts.ocrText) prompt += ` | Slide text: ${ts.ocrText.slice(0, 150)}`;
            prompt += '\n';
        });
    }
    if (aiResponses.length) {
        prompt += 'Questions asked:\n';
        aiResponses.forEach(qa => {
            prompt += `- Q: ${qa.question}\n`;
        });
    }
    prompt += '\nWrite a brief educational summary of the video content. Only output the summary text. Do not reference the video title.';

    return await callAI([
        { role: 'system', content: 'You are a study assistant. Generate concise educational video summaries. Do not mention or quote the video title.' },
        { role: 'user', content: prompt }
    ]);
}

// Fallback: build a local summary from notes when AI is unavailable
function buildLocalSummary() {
    const parts = [];
    if (videoTitle) {
        parts.push(`This document contains study notes for "${videoTitle}".`);
    } else {
        parts.push('This document contains study notes captured from a YouTube video.');
    }
    if (timestamps.length) {
        const notesWithText = timestamps.filter(t => t.note);
        parts.push(`A total of ${timestamps.length} key moments were captured${notesWithText.length ? ', covering topics such as: ' + notesWithText.map(t => t.note.slice(0, 50)).join('; ') : ''}.`);
    }
    if (aiResponses.length) {
        parts.push(`${aiResponses.length} questions were asked and answered through the AI assistant.`);
    }
    return parts.join(' ');
}

// ============ TOAST ============
function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    toasts.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateY(6px)';
        t.style.transition = 'all .2s';
        setTimeout(() => t.remove(), 200);
    }, 2200);
}