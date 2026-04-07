const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

// Allow requests from Chrome extensions
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check
app.get('/', (req, res) => res.json({ status: 'NotePilot PDF Server running' }));

// ── PDF generation endpoint ──
app.post('/generate-pdf', async (req, res) => {
  const {
    notes = [],
    aiResponses = [],
    videoTitle = '',
    videoId = '',
    pdfTitle = 'Study Notes',
    aiSummary = ''
  } = req.body;

  if (!notes.length && !aiResponses.length) {
    return res.status(400).json({ error: 'No content to export' });
  }

  let browser;
  try {
    const html = buildHTML({ notes, aiResponses, videoTitle, videoId, pdfTitle, aiSummary });

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    // Set content and wait for KaTeX CDN fonts + images to load
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait a tick for KaTeX JS to render math
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '16mm', right: '16mm' },
      displayHeaderFooter: false
    });

    await browser.close();

    const safeName = pdfTitle.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') || 'Study_Notes';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.send(pdf);

  } catch (err) {
    if (browser) await browser.close().catch(() => { });
    console.error('PDF generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── HTML template ──
function buildHTML({ notes, aiResponses, videoTitle, videoId, pdfTitle, aiSummary }) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const notesHtml = notes.map((note, i) => {
    const imgHtml = (note.snapshot && note.snapshot.startsWith('data:'))
      ? `<div class="note-img"><img src="${note.snapshot}" alt="Frame at ${esc(note.timestamp)}"></div>`
      : '';

    const ocrHtml = note.ocrText
      ? `<div class="block ocr-block">
                   <div class="block-label">Extracted Text</div>
                   <div class="block-body math-text">${esc(note.ocrText)}</div>
               </div>`
      : '';

    const explHtml = note.aiExplanation
      ? `<div class="block expl-block">
                   <div class="block-label">AI Explanation</div>
                   <div class="block-body math-text">${esc(note.aiExplanation)}</div>
               </div>`
      : '';

    return `
        <div class="note-card">
            <div class="note-header">
                <span class="ts-pill">${esc(note.timestamp)}</span>
                <span class="note-num">Note #${i + 1}</span>
                ${videoId ? `<a class="yt-link" href="https://www.youtube.com/watch?v=${videoId}&t=${note.videoTime}s">Watch ↗</a>` : ''}
            </div>
            ${imgHtml}
            <div class="note-body">
                ${note.note ? `<p class="note-text math-text">${esc(note.note)}</p>` : ''}
                ${ocrHtml}
                ${explHtml}
            </div>
        </div>`;
  }).join('');

  const qaHtml = aiResponses
    .filter(q => q.includedInPdf !== false)
    .map((qa, i) => `
        <div class="qa-item">
            <div class="qa-q math-text"><span class="qa-num">Q${i + 1}</span> ${esc(qa.question)}</div>
            <div class="qa-a math-text">${esc(qa.answer)}</div>
        </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(pdfTitle)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 9pt;
    color: #1a1a2e;
    background: #fff;
    line-height: 1.6;
  }

  /* ── Cover ── */
  .cover {
    background: #111119;
    color: #eeeef5;
    padding: 52px 48px 44px;
    page-break-after: always;
    border-bottom: 4px solid #6366f1;
  }
  .cover-brand {
    font-size: 8pt; font-weight: 700; letter-spacing: 2px;
    color: #818cf8; text-transform: uppercase; margin-bottom: 32px;
    display: flex; align-items: center; gap: 8px;
  }
  .cover-brand-dot {
    width: 20px; height: 20px; border-radius: 5px;
    background: linear-gradient(135deg, #6366f1, #a855f7);
    display: inline-block;
  }
  .cover-title {
    font-size: 22pt; font-weight: 700; color: #eeeef5;
    line-height: 1.2; margin-bottom: 8px;
  }
  .cover-sub {
    font-size: 9pt; color: #9090a8; margin-bottom: 32px;
  }
  .cover-stats { display: flex; gap: 32px; }
  .stat-num { font-size: 18pt; font-weight: 700; color: #818cf8; }
  .stat-label { font-size: 7pt; color: #55556a; text-transform: uppercase; letter-spacing: .8px; }

  /* ── Section headings ── */
  .section-heading {
    font-size: 7pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1px; color: #6366f1;
    padding: 14px 0 6px;
    border-bottom: 1px solid #e0e0f0;
    margin-bottom: 12px;
  }

  /* ── Summary block ── */
  .summary-box {
    background: #f5f5fd;
    border-left: 3px solid #6366f1;
    padding: 12px 14px;
    border-radius: 0 6px 6px 0;
    margin-bottom: 20px;
    font-size: 9pt;
    color: #3a3a52;
    line-height: 1.7;
  }

  /* ── Video link ── */
  .video-link-bar {
    font-size: 8pt; color: #6366f1; margin-bottom: 18px;
  }
  .video-link-bar a { color: #6366f1; text-decoration: none; }

  /* ── Note cards ── */
  .note-card {
    border: 1px solid #e0e0f0;
    border-radius: 8px;
    margin-bottom: 16px;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .note-header {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px;
    background: #f8f8fc;
    border-bottom: 1px solid #e0e0f0;
  }
  .ts-pill {
    background: #6366f1; color: #fff;
    font-size: 7.5pt; font-weight: 700;
    padding: 2px 9px; border-radius: 50px;
    font-variant-numeric: tabular-nums;
  }
  .note-num {
    font-size: 8pt; font-weight: 600; color: #6366f1; flex: 1;
  }
  .yt-link {
    font-size: 7.5pt; color: #9090a8; text-decoration: none;
  }

  .note-img img {
    width: 100%; max-height: 220px;
    object-fit: cover; display: block;
    border-bottom: 1px solid #e0e0f0;
  }

  .note-body { padding: 10px 12px; }

  .note-text {
    font-size: 9pt; color: #3a3a52; line-height: 1.65;
    margin-bottom: 8px; white-space: pre-wrap;
  }

  /* ── OCR / Explanation blocks ── */
  .block { border-radius: 5px; padding: 8px 10px; margin-bottom: 8px; }
  .block:last-child { margin-bottom: 0; }
  .block-label {
    font-size: 6.5pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: .6px; margin-bottom: 5px;
  }
  .block-body { font-size: 8.5pt; line-height: 1.6; white-space: pre-wrap; }

  .ocr-block  { background: #f0f0fc; border: 1px solid #d8d8f0; }
  .ocr-block  .block-label { color: #6366f1; }
  .ocr-block  .block-body  { color: #3a3a52; }

  .expl-block { background: #f5f0ff; border: 1px solid #d8c8f8; }
  .expl-block .block-label { color: #a855f7; }
  .expl-block .block-body  { color: #3a3a52; }

  /* ── Q&A ── */
  .qa-section { page-break-before: always; }
  .qa-item {
    margin-bottom: 16px;
    page-break-inside: avoid;
    border-left: 2px solid #6366f1;
    padding-left: 12px;
  }
  .qa-q {
    font-size: 9pt; font-weight: 600; color: #1a1a2e;
    margin-bottom: 6px;
  }
  .qa-num {
    display: inline-block; background: #6366f1; color: #fff;
    font-size: 7pt; font-weight: 700;
    padding: 1px 6px; border-radius: 3px; margin-right: 6px;
  }
  .qa-a {
    font-size: 9pt; color: #3a3a52; line-height: 1.65;
  }

  /* ── Footer on each page ── */
  @page {
    size: A4;
    margin: 14mm 16mm;
    @bottom-center {
      content: "Generated by NotePilot  ·  Page " counter(page) " of " counter(pages);
      font-size: 7pt; color: #9090a8;
      font-family: -apple-system, sans-serif;
    }
  }

  /* ── KaTeX overrides for print ── */
  .katex { font-size: 1em !important; color: #1a1a2e; }
  .katex-display { overflow: visible; margin: 6px 0; }
</style>
</head>
<body>

<!-- Cover -->
<div class="cover">
  <div class="cover-brand">
    <span class="cover-brand-dot"></span>
    NOTEPILOT
  </div>
  <div class="cover-title">${esc(pdfTitle)}</div>
  <div class="cover-sub">${videoTitle ? esc(videoTitle) + ' &nbsp;·&nbsp; ' : ''}${date}</div>
  <div class="cover-stats">
    <div>
      <div class="stat-num">${notes.length}</div>
      <div class="stat-label">Captures</div>
    </div>
    ${aiResponses.filter(q => q.includedInPdf !== false).length
      ? `<div><div class="stat-num">${aiResponses.filter(q => q.includedInPdf !== false).length}</div><div class="stat-label">Q&amp;A</div></div>`
      : ''}
  </div>
</div>

<!-- Summary -->
${aiSummary ? `<div class="section-heading">Video Summary</div><div class="summary-box math-text">${esc(aiSummary)}</div>` : ''}

<!-- Video link -->
${videoId ? `<div class="video-link-bar"><a href="https://www.youtube.com/watch?v=${videoId}">youtube.com/watch?v=${esc(videoId)}</a></div>` : ''}

<!-- Notes -->
<div class="section-heading">Captured Notes</div>
${notesHtml}

<!-- Q&A -->
${qaHtml ? `<div class="qa-section"><div class="section-heading">AI Q&amp;A</div>${qaHtml}</div>` : ''}

<script>
// Render all $...$ and $$...$$ math after page load
document.addEventListener('DOMContentLoaded', () => {
    renderMathInElement(document.body, {
        delimiters: [
            { left: '$$', right: '$$', display: true  },
            { left: '$',  right: '$',  display: false }
        ],
        throwOnError: false
    });
});
</script>
</body>
</html>`;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

<<<<<<< HEAD
app.listen(PORT, () => console.log(`NotePilot PDF server running on port ${PORT}`));  
=======
app.listen(PORT, () => console.log(`NotePilot PDF server running on port ${PORT}`));
>>>>>>> 3e150766ae5b206eec0d25ccf416f06c2d51e8da
