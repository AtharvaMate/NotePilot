<div align="center">

<img src="https://img.shields.io/badge/Manifest-v3-E50914?style=for-the-badge&logo=googlechrome&logoColor=white"/>
<img src="https://img.shields.io/badge/Node.js-Express-111111?style=for-the-badge&logo=node.js&logoColor=46d369"/>
<img src="https://img.shields.io/badge/Puppeteer-PDF_Engine-E50914?style=for-the-badge&logo=puppeteer&logoColor=white"/>
<img src="https://img.shields.io/badge/MongoDB-Atlas-46d369?style=for-the-badge&logo=mongodb&logoColor=white"/>
<img src="https://img.shields.io/badge/KaTeX-Math_Rendering-f5c518?style=for-the-badge"/>
<img src="https://img.shields.io/badge/License-MIT-a0a0a0?style=for-the-badge"/>

<br/><br/>

```
███╗   ██╗ ██████╗ ████████╗███████╗██████╗ ██╗██╗      ██████╗ ████████╗
████╗  ██║██╔═══██╗╚══██╔══╝██╔════╝██╔══██╗██║██║     ██╔═══██╗╚══██╔══╝
██╔██╗ ██║██║   ██║   ██║   █████╗  ██████╔╝██║██║     ██║   ██║   ██║   
██║╚██╗██║██║   ██║   ██║   ██╔══╝  ██╔═══╝ ██║██║     ██║   ██║   ██║   
██║ ╚████║╚██████╔╝   ██║   ███████╗██║     ██║███████╗╚██████╔╝   ██║   
╚═╝  ╚═══╝ ╚═════╝    ╚═╝   ╚══════╝╚═╝     ╚═╝╚══════╝ ╚═════╝    ╚═╝   
```

### **AI-Powered YouTube Study Notes — Chrome Extension**
*Capture frames · OCR equations · AI chat · Generate quizzes & flashcards · Export beautiful PDFs · Share study rooms*

<br/>

![NotePilot Demo](https://img.shields.io/badge/▶_Watch_Demo-E50914?style=for-the-badge&logoColor=white)
&nbsp;
![Install Extension](https://img.shields.io/badge/⬇_Install_Extension-1a1a1a?style=for-the-badge&logoColor=white)
&nbsp;
![Report Bug](https://img.shields.io/badge/🐛_Report_Bug-333?style=for-the-badge)

</div>

---

## ✦ What is NotePilot?

NotePilot is a **Manifest v3 Chrome Extension** that turns any YouTube video into an interactive study session. You capture video frames at key moments, add personal notes, extract text from screenshots using AI vision (OCR), ask an AI questions about the video, generate quizzes and flashcards automatically, and export everything as a polished, math-aware PDF — all from a 420px popup living right next to YouTube.

Built for students, researchers, and self-learners who watch lecture videos, coding tutorials, or any educational content on YouTube.

---

## ✦ Feature Showcase

### 📸 Frame Capture & Annotation

Click **Capture** in the popup (or the injected camera button in the YouTube player controls) to snapshot the exact frame you're watching. Each note card shows:

- A **timestamp pill** linking directly back to that moment in the video via `Watch ↗`
- A **frame snapshot** (JPEG, cropped precisely to the video element using `devicePixelRatio`)
- An editable **note textarea** for your own thoughts
- An **OCR block** — AI vision reads any text, equations, code, or diagrams in the frame
- An **AI Explanation block** — one click to get a plain-English explanation of what's on screen
- A toggle to **include / exclude** the note from the PDF export

> **Player button:** A camera SVG button is injected directly into the YouTube player's right controls bar. A mini popup overlay appears in-page, letting you add a note and save — all without switching back to the extension popup.

---

### 🤖 AI Chat (Video-Aware)

The **AI Chat** tab is a full conversational interface backed by your video's transcript and your captured notes:

| What you can ask | What you get |
|---|---|
| "Summarize this video" | Concise transcript-backed summary |
| "What is vanishing gradient?" | Contextual explanation tied to the lecture |
| "Explain the equation at 8:14" | Vision-model reads your snapshot |
| "Write 5 quiz questions" | Triggers the Quiz generator inline |

Messages are persisted per video. The transcript is fetched directly from YouTube's caption track API (manual captions preferred over auto-generated, English prioritised).

---

### 🧠 Quiz Generator

Switch to the **Quiz** tab and NotePilot generates 4-option MCQs from your notes and the video transcript. Features:

- **Progress bar** showing current question out of total
- **Instant feedback** — correct answer highlighted in green, wrong choice marked in red
- **Rewatch button** — jumps the video back to the exact timestamp the question came from
- **Score breakdown** at the end with a retry or regenerate option
- Questions excluded from the quiz do not appear in the PDF export

---

### 🃏 Flashcard Generator

The **Cards** tab generates flip-style study cards. Each card shows a question on the front and the answer (with KaTeX-rendered math if needed) on the back. Cards are ordered by timestamp so they follow the video's progression naturally.

---

### 📤 Beautiful PDF Export

The export pipeline sends your notes to a **local or cloud Express server** that renders a full HTML page with KaTeX math, then uses **Puppeteer** (headless Chromium) to produce an A4 PDF. The generated PDF includes:

- A **cover page** with title, video name, capture count, and Q&A count — dark branding, indigo accents
- A **Video Summary** section (AI-generated)
- Each **note card** with its snapshot image, timestamp pill, YouTube deep-link, note text, OCR extract, and AI explanation
- A **Q&A section** with all your AI chat exchanges
- KaTeX-rendered `$inline$` and `$$display$$` math throughout
- Page numbers in the footer via CSS `@page`

Math rendering is double-layered: KaTeX runs client-side in the popup for display, and server-side inside the Puppeteer page (via CDN) for the PDF, ensuring equations are pixel-perfect in print.

---

### 🔗 Study Room Sharing

Click **Share** on any video to upload your notes to the backend and generate a shareable room URL. Classmates can open the link to view your captures, annotations, and Q&A. Notes sync live as you add new captures (debounced push via `pushNoteToRoom`). A green **SHARED** badge appears on history cards that have an active room.

---

### 🕘 History Panel

The **History** tab shows all your previously saved sessions, searchable by title. Each card shows:

- Initials avatar with a gradient red background
- Video title, note count, Q&A count, and relative timestamp
- **Open on YouTube** — reopens the video in a new tab
- **PDF** — regenerates and downloads the PDF for that session
- **Delete** — soft confirm (single click turns to "Sure?", second click confirms)

---

### 🔐 Authentication

NotePilot supports two sign-in flows:

- **Email / Password** — JWT-based, stored in `localStorage` and synced to `chrome.storage.local` so content scripts on `youtube.com` can access the token
- **Google OAuth** — via `chrome.identity.launchWebAuthFlow`, exchanges a Google `id_token` with the backend's `/api/auth/google` endpoint

---

## ✦ Architecture

```
┌──────────────────────────────────── Chrome Extension ────────────────────────────────────┐
│                                                                                            │
│  index.html + style.css          content.js                    background.js              │
│  ┌─────────────────────┐    ┌──────────────────────┐    ┌───────────────────────────┐    │
│  │  Popup UI (420×520) │    │  YouTube page inject  │    │  Service Worker           │    │
│  │  5 tabs · Auth UI   │    │  Player camera button │    │  captureVisibleTab        │    │
│  │  Chat · Quiz · Cards│    │  Mini note overlay    │    │  (cross-origin screenshot)│    │
│  └─────────┬───────────┘    └──────────┬────────────┘    └───────────────────────────┘    │
│            │                           │                                                    │
│            └─────────────┬─────────────┘                                                   │
│                          │  script.js  (core logic)                                        │
│                    JWT auth headers · REST calls · KaTeX · Transcript fetch                │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                              REST / JWT (Bearer)
                                          │
┌─────────────────────────── Node.js Express Backend ─────────────────────────────────────┐
│                                                                                           │
│  /api/auth      /api/videos/:id      /api/ai/chat      /api/ai/vision                   │
│  /api/rooms     /generate-pdf  ──► Puppeteer + KaTeX CDN ──► A4 PDF Buffer              │
│                                                                                           │
└──────────────────┬────────────────────────┬────────────────────────┬─────────────────────┘
                   │                        │                        │
             MongoDB Atlas         OpenAI / Claude API        Google OAuth 2.0
             (video sessions,       (chat · vision · quiz      (identity token
              user accounts)         · flashcard gen)           verification)
```

---

## ✦ Tech Stack

| Layer | Technology |
|---|---|
| Extension | Chrome Manifest v3, Vanilla JS, CSS custom properties |
| UI | Custom dark design system (`#0a0a0a` base, `#E50914` accent, `#46d369` success) |
| Math | KaTeX 0.16.9 — inline `$...$` and display `$$...$$` |
| Backend | Node.js, Express 4 |
| PDF | Puppeteer (headless Chromium), KaTeX CDN inside page |
| Database | MongoDB Atlas |
| Auth | JWT, Google OAuth 2.0 via `chrome.identity` |
| AI | OpenAI or Claude API (chat + vision endpoints) |
| Deployment | Render (backend), Chrome Web Store (extension) |

---

## ✦ Project Structure

```
notepilot/
│
├── extension/                  # Chrome Extension
│   ├── manifest.json           # MV3 config — permissions, host_permissions, CSP
│   ├── index.html              # Popup — 420×520px — 5 tabs
│   ├── style.css               # Full dark design system
│   ├── script.js               # Core logic (capture, AI, PDF, rooms, auth)
│   ├── content.js              # YouTube page injector (player button + mini popup)
│   ├── content-inject.css      # Styles injected into youtube.com
│   ├── background.js           # Service worker — captureVisibleTab
│   ├── config.js               # BACKEND_URL, GOOGLE_CLIENT_ID (gitignored)
│   ├── katex.min.js            # KaTeX bundled locally
│   ├── html2canvas.min.js      # For math→image in PDF
│   └── jspdf.min.js            # Client-side PDF fallback
│
├── server/                     # Node.js PDF + API server
│   ├── server.js               # Express app — /generate-pdf + all /api/* routes
│   └── package.json
│
└── README.md
```

---

## ✦ Installation & Setup

### 1. Clone the repository

```bash
git clone https://github.com/AtharvaMate/notepilot.git
cd notepilot
```

### 2. Configure the extension

Create `extension/config.js` (this file is gitignored — never commit secrets):

```js
// extension/config.js
const NOTEPILOT_CONFIG = {
    BACKEND_URL:      'http://localhost:3001',      // or your Render URL
    ROOM_VIEWER_URL:  'http://localhost:3001/room',
    GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com'
};
```

### 3. Install and start the backend server

```bash
cd server
npm install          # installs express, puppeteer, mongoose, jsonwebtoken …
node server.js       # runs on port 3001 by default
```

Puppeteer downloads a bundled Chromium on first install (~170 MB). On Linux servers add these flags (already in `server.js`):

```
--no-sandbox  --disable-setuid-sandbox  --disable-dev-shm-usage  --disable-gpu
```

### 4. Load the extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Pin NotePilot from the extensions toolbar

### 5. Environment variables (backend)

```env
PORT=3001
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/notepilot
JWT_SECRET=your_super_secret_key_here
OPENAI_API_KEY=sk-...
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

---

## ✦ Deploying to Render

1. Push your `server/` folder to GitHub
2. Create a new **Web Service** on [render.com](https://render.com)
3. Set **Build command:** `npm install`
4. Set **Start command:** `node server.js`
5. Add the environment variables above in Render's dashboard
6. Update `BACKEND_URL` in `config.js` to your Render URL (e.g. `https://notepilot-xxxx.onrender.com`)

> Puppeteer works on Render's standard instances with the `--no-sandbox` flags already set in `server.js`.

---

## ✦ Host Permissions & Privacy

The extension requests the following permissions:

| Permission | Reason |
|---|---|
| `activeTab` | Read the current YouTube tab's URL and video state |
| `scripting` | Inject `content.js` and CSS into YouTube pages |
| `storage` | Persist the auth JWT token for content scripts |
| `identity` | Launch Google OAuth popup via `chrome.identity` |
| `https://www.youtube.com/*` | Inject capture button, read transcript |
| `https://notepilot-*.onrender.com/*` | All API calls |

No user data is ever sold or shared. Notes and snapshots are stored in your personal MongoDB account scoped to your user ID behind JWT authentication.

---

## ✦ Key Design Decisions

**Why Puppeteer for PDF instead of jsPDF?**
jsPDF cannot render KaTeX math or complex CSS layouts faithfully. Puppeteer runs real Chromium, meaning the PDF looks exactly like the HTML — including fonts, flexbox, page breaks, and KaTeX-rendered equations. The server adds a 500ms settle delay after `networkidle0` to ensure KaTeX's CDN fonts load before printing.

**Why a backend instead of pure client-side?**
Three reasons: (1) PDF generation needs Puppeteer's headless browser, (2) AI API keys must stay server-side, (3) shared study rooms require a persistent store.

**Why Manifest v3?**
MV3 is Chrome's current and only supported manifest format for new extensions. `captureVisibleTab` is handled by the background service worker because content scripts on `youtube.com` cannot call it directly — they message `background.js` which relays the screenshot back.

**KaTeX double-rendering**
Math is rendered with KaTeX in the popup for live display (`renderWithMath()` in `script.js`) and again server-side inside Puppeteer's page (via KaTeX CDN auto-render) for the PDF. This ensures equations are crisp in both contexts without any canvas-to-image tricks.

---

## ✦ API Reference

### `POST /generate-pdf`

```json
{
  "notes": [
    {
      "timestamp": "4:32",
      "videoTime": 272,
      "snapshot": "data:image/jpeg;base64,...",
      "note": "Backprop uses chain rule",
      "ocrText": "∂L/∂w = δ · a",
      "aiExplanation": "The weight gradient..."
    }
  ],
  "aiResponses": [
    { "question": "What is ReLU?", "answer": "...", "includedInPdf": true }
  ],
  "videoTitle": "3Blue1Brown — Neural Networks",
  "videoId": "aircAruvnKk",
  "pdfTitle": "Neural Networks Notes",
  "aiSummary": "This video covers..."
}
```

Returns: `application/pdf` binary stream with `Content-Disposition: attachment`.

### `GET /api/videos/:videoId`

Returns saved session for the authenticated user. Requires `Authorization: Bearer <token>`.

### `PUT /api/videos/:videoId`

Upserts the full session object (timestamps, aiResponses, sharedRoomId, pdfTitleVal).

### `POST /api/ai/chat`

Proxies to OpenAI/Claude. Body: `{ messages, temperature, max_tokens }`. Injects system prompt with transcript context server-side.

### `POST /api/ai/vision`

Same as `/chat` but accepts a base64 image in the message content for OCR/explanation.

---

## ✦ Contributing

Pull requests are welcome! Here's how to get set up:

```bash
# Fork the repo, then:
git clone https://github.com/YOUR_USERNAME/notepilot.git
cd notepilot

# Create a feature branch
git checkout -b feat/my-feature

# Make changes, then commit
git commit -m "feat: add support for X"
git push origin feat/my-feature

# Open a Pull Request on GitHub
```

Please follow these conventions:

- Use **conventional commits** (`feat:`, `fix:`, `docs:`, `refactor:`)
- Keep the dark UI design system consistent — colours are defined as CSS variables in `style.css`
- All new API routes must be JWT-protected
- Test PDF generation locally before submitting PDF-related changes

---

## ✦ Roadmap

- [ ] Offline mode — queue captures when backend is unreachable
- [ ] Custom AI model selection (GPT-4o, Claude Sonnet, Gemini)
- [ ] Export to Notion / Obsidian markdown
- [ ] Collaborative real-time annotation in study rooms (WebSocket)
- [ ] Support for non-YouTube video players (Coursera, edX, Udemy)
- [ ] Mobile companion app for reviewing flashcards

---

## ✦ License

MIT © 2025 [AtharvaMate](https://github.com/AtharvaMate)

---

<div align="center">

Built with ☕ and a lot of YouTube lecture videos.

**Star ⭐ the repo if NotePilot helped you study smarter!**

</div>