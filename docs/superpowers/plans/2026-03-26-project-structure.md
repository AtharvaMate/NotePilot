# NotePilot Project Structure & Architecture

> **For agentic workers:** This document provides a comprehensive understanding of the NotePilot codebase structure, architecture, and key components.

**Goal:** Document the complete project structure, architecture, and key components for NotePilot - a Chrome extension that turns YouTube videos into interactive study sessions.

**Architecture:** Chrome Manifest V3 extension with a Node.js/Express backend. The extension captures video frames, uses AI for OCR and explanations, and provides features like PDF export, shared study rooms, quizzes, and flashcards.

**Tech Stack:**
- **Extension:** Chrome Manifest V3, Vanilla JavaScript, KaTeX (math rendering), jsPDF (PDF generation), html2canvas
- **Backend:** Node.js, Express, MongoDB (Mongoose), JWT authentication
- **AI:** Groq API (Llama 3.3 70B for chat, Llama 4 Scout 17B for vision/OCR)
- **Auth:** Email/password + Google OAuth

---

## Project Structure

```
notepilot/
├── manifest.json              # Chrome Manifest V3 config
├── index.html                 # Extension popup UI
├── style.css                  # Popup styles (dark theme)
├── script.js                  # Core extension logic (~1700 lines)
├── config.js                  # API key configuration (add to .gitignore)
├── background.js              # Service worker - captureVisibleTab handler
├── content.js                 # Injected into YouTube - player button + video info
├── content-inject.css         # Styles for injected YT player elements
├── mathjax-config.js          # MathJax configuration (reserved)
├── katex.min.js               # Bundled KaTeX
├── html2canvas.min.js         # Bundled html2canvas
├── jspdf.min.js               # Bundled jsPDF
├── tex-svg.js                 # TeX to SVG converter
├── room/
│   └── index.html             # Shared study room viewer
├── backend/
│   ├── server.js              # Express API server (~570 lines)
│   ├── package.json           # Backend dependencies
│   ├── .env.example           # Environment variables template
│   └── models/
│       ├── User.js            # User model (auth)
│       ├── Video.js           # Per-user video data model
│       └── Room.js            # Shared room model
└── images/                    # Documentation images
```

---

## Core Components

### 1. Chrome Extension (Frontend)

#### `manifest.json`
- **Version:** 2.0.0
- **Permissions:** `activeTab`, `scripting`, `storage`
- **Host Permissions:** YouTube, noembed.com, backend URLs
- **Content Scripts:** Injected into YouTube pages
- **Web Accessible Resources:** `room/index.html` (for shared room viewer)

#### `index.html` (Popup UI)
- **Auth Overlay:** Login/Register form with Google Sign-In option
- **Header:** Logo, user info, status indicator
- **Video Bar:** Video title, Capture button, Share button
- **Tabs:** Notes, Quiz, Flashcards, AI Chat
- **Panels:**
  - Notes Panel: Captured frames with OCR and AI explanations
  - Quiz Panel: AI-generated quiz interface
  - Flashcards Panel: AI-generated flashcards
  - Chat Panel: AI chat with video context
- **Export Footer:** PDF title input and export button
- **Share Modal:** Room sharing interface

#### `script.js` (Core Logic - ~1700 lines)

**Key Sections:**

1. **Config & Auth (lines 1-220)**
   - Backend URL configuration
   - JWT token management
   - Auth UI (login/register overlay)
   - Google Sign-In placeholder

2. **State Management (lines 54-58)**
   - `videoId`, `videoTitle`
   - `timestamps[]` - captured notes
   - `aiResponses[]` - chat Q&A
   - `sharedRoomId` - persistent room ID

3. **AI Helpers (lines 19-52)**
   - `callAI()` - Chat via backend proxy
   - `callAIVision()` - OCR via backend proxy

4. **Video Detection (lines 221-242)**
   - Detects YouTube video in active tab
   - Gets video info via content script

5. **Persistence (lines 244-286)**
   - `saveData()` - Save to backend API
   - `loadData()` - Load from backend API

6. **Capture System (lines 298-335)**
   - `captureSnapshot()` - Capture video frame
   - `cropToVideo()` - Crop to video area

7. **Math Rendering (lines 337-401)**
   - `renderWithMath()` - KaTeX rendering
   - `mathExprToImage()` - Math to image for PDF

8. **PDF Export (lines 741-923)**
   - `makePDF()` - Generate A4 PDF with jsPDF
   - `generateSummary()` - AI summary generation
   - Complex math rendering with baseline alignment

9. **Shared Study Room (lines 944-1205)**
   - `shareRoom()` - Create/update room
   - `pushNoteToRoom()` - Live sync
   - `syncNoteTextToRoom()` - Text-only sync
   - `compressSnapshot()` - Image compression

10. **Quiz System (lines 1207-1527)**
    - `startQuiz()` - Generate quiz from transcript/notes
    - `renderQuizQuestion()` - Display question
    - `renderQuizResults()` - Score and breakdown
    - Transcript fetching via content script

11. **Flashcards (lines 1529-1678)**
    - `generateFlashcards()` - AI generation
    - `renderFlashcards()` - Flip card interface

#### `background.js` (Service Worker)
- Handles `captureVisibleTab` requests from content script
- Returns screenshot as data URL

#### `content.js` (YouTube Injection)
- Injects capture button into YouTube player controls
- Provides video info (ID, title, current time, player rect)
- Fetches YouTube transcript for quiz generation
- Handles seek-to-time requests

#### `content-inject.css`
- Styles for injected YouTube player elements

### 2. Backend API (Node.js/Express)

#### `server.js` (~570 lines)

**Key Endpoints:**

**Auth Endpoints:**
- `POST /api/auth/register` - Email/password registration
- `POST /api/auth/login` - Email/password login
- `POST /api/auth/google` - Google OAuth
- `GET /api/auth/me` - Get current user

**Video Data (Per-User):**
- `GET /api/videos/:videoId` - Get user's data for video
- `PUT /api/videos/:videoId` - Save/update user's data

**Rooms (Shared):**
- `POST /api/rooms` - Create room (auth required)
- `GET /api/rooms/:roomId` - Get room (public)
- `PATCH /api/rooms/:roomId` - Update room (auth required)
- `PUT /api/rooms/:roomId/notes/:noteIndex` - Push note (auth required)
- `PATCH /api/rooms/:roomId/notes/:noteIndex` - Patch note text (auth required)

**Annotations:**
- `POST /api/rooms/:roomId/annotations` - Add annotation
- `GET /api/rooms/:roomId/annotations` - Get annotations

**Quizzes:**
- `POST /api/rooms/:roomId/quiz` - Create quiz
- `GET /api/rooms/:roomId/quizzes` - List quizzes
- `GET /api/rooms/:roomId/quiz/:quizId` - Get quiz

**Flashcards:**
- `POST /api/rooms/:roomId/flashcards` - Create flashcard set
- `GET /api/rooms/:roomId/flashcards` - List flashcard sets
- `GET /api/rooms/:roomId/flashcards/:setId` - Get flashcard set

**AI Proxy:**
- `POST /api/ai/chat` - Chat AI (auth required)
- `POST /api/ai/vision` - Vision AI (auth required)
- `POST /api/ai/quiz` - Quiz generation (public)
- `POST /api/ai/flashcards` - Flashcard generation (public)

**Middleware:**
- `requireAuth()` - JWT verification
- `optionalAuth()` - Optional JWT verification

**AI Models:**
- Chat: `llama-3.3-70b-versatile`
- Vision/OCR: `meta-llama/llama-4-scout-17b-16e-instruct`

#### `backend/models/`

**User.js**
- Fields: `email`, `name`, `password`, `googleId`, `avatar`
- Password hashing with bcrypt
- `comparePassword()` method

**Video.js**
- Fields: `videoId`, `userId`, `videoTitle`, `timestamps[]`, `aiResponses[]`, `pdfTitleVal`, `sharedRoomId`
- Compound unique index on `{videoId, userId}`

**Room.js**
- Fields: `roomId`, `videoId`, `meta`, `notes[]`, `annotations[]`, `quizzes[]`, `flashcardSets[]`, `summary`
- `meta`: `videoTitle`, `ownerName`, `createdAt`, `updatedAt`, `captureCount`
- `note`: `id`, `timestamp`, `videoTime`, `note`, `snapshot`, `ocrText`, `aiExplanation`
- `annotation`: `noteIndex`, `name`, `text`, `sessionId`, `createdAt`
- `quiz`: `quizId`, `title`, `questions[]`, `createdBy`, `createdAt`
- `flashcardSet`: `setId`, `title`, `cards[]`, `createdBy`, `createdAt`

### 3. Room Viewer (`room/index.html`)

**Features:**
- View shared notes with timestamps
- View extracted text and AI explanations
- Add annotations (public)
- Take quizzes generated from room notes
- View and use flashcards
- Real-time polling for new annotations

**Tabs:**
- Notes: Captured notes with annotations
- Quiz: Room quizzes
- Flashcards: Room flashcard sets

---

## Data Flow

### 1. Capture Flow
```
User clicks Capture
  → content.js gets video info
  → background.js captures tab
  → script.js crops to video area
  → Add to timestamps array
  → Save to backend API
  → Push to shared room (if active)
```

### 2. OCR Flow
```
User clicks Extract Text
  → script.js calls callAIVision()
  → Backend proxies to Groq (Llama 4 Scout)
  → Returns extracted text
  → Save to backend API
  → Sync to shared room
```

### 3. Chat Flow
```
User asks question
  → script.js builds prompt with video context
  → Calls callAI() via backend
  → Backend proxies to Groq (Llama 3.3)
  → Returns answer
  → Add to aiResponses array
  → Save to backend API
```

### 4. Share Room Flow
```
User clicks Share
  → Compress snapshots
  → Create/update room on backend
  → Get room URL
  → Copy to clipboard
  → Store roomId for future shares
```

### 5. Quiz Generation Flow
```
User clicks Generate Quiz
  → Fetch transcript (if available)
  → Build context from transcript + notes
  → Call /api/ai/quiz
  → Backend generates 10 questions via Groq
  → Display quiz interface
  → Track answers and score
```

---

## Key Technical Details

### Math Rendering
- **UI:** KaTeX for live rendering (`$...$` inline, `$$...$$` display)
- **PDF:** KaTeX + html2canvas for rasterization
- **Baseline Alignment:** Precise calculation to prevent overlap

### PDF Generation
- **Format:** A4 with jsPDF
- **Sections:** Cover, Summary, Captured Notes, AI Q&A
- **Math:** Rasterized as images with proper alignment
- **Font Safety:** Unicode mapped to ASCII to prevent Courier fallback

### Authentication
- **JWT:** 30-day expiration
- **Storage:** `localStorage` + `chrome.storage.local`
- **Methods:** Email/password, Google OAuth

### Storage
- **Per-user data:** MongoDB Video model (compound key: videoId + userId)
- **Shared rooms:** MongoDB Room model (public read, auth write)
- **Local cache:** Chrome storage for offline access

### Image Compression
- **Max width:** 1280px
- **Format:** JPEG at 88% quality
- **Purpose:** Reduce storage and bandwidth

---

## Environment Variables

Required in `backend/.env`:
```
PORT=3001
MONGODB_URI=mongodb://localhost:27017/notepilot
JWT_SECRET=your-secret-key
GOOGLE_CLIENT_ID=your-google-client-id
GROQ_API_KEY=your-groq-api-key
```

Optional in `config.js`:
```javascript
const NOTEPILOT_CONFIG = {
    BACKEND_URL: 'http://localhost:3001',
    ROOM_VIEWER_URL: '',  // Optional external room viewer URL
    GOOGLE_CLIENT_ID: ''  // For Google Sign-In
};
```

---

## Development Notes

### Adding New Features
1. **Extension UI:** Modify `index.html` and `style.css`
2. **Extension Logic:** Add to `script.js`
3. **Backend API:** Add endpoint to `server.js`
4. **Data Models:** Add/update models in `backend/models/`
5. **Room Viewer:** Modify `room/index.html`

### Testing
- Load extension in Chrome Developer Mode
- Start backend: `cd backend && npm start`
- Open YouTube video and test features

### Common Issues
- **Capture fails:** YouTube tab must be visible
- **OCR fails:** Check Groq API key and rate limits
- **Auth fails:** Verify backend is running and JWT_SECRET is set
- **Room sync fails:** Check sharedRoomId is saved correctly

---

## File Size Notes
- `script.js`: ~1700 lines (main extension logic)
- `server.js`: ~570 lines (backend API)
- `room/index.html`: ~650 lines (room viewer)
- `style.css`: ~400 lines (popup styles)
