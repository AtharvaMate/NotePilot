require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const User = require('./models/User');
const Video = require('./models/Video');
const Room = require('./models/Room');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'notepilot-dev-secret-change-in-production';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const MODEL_CHAT = 'llama-3.3-70b-versatile';
const MODEL_VISION = 'meta-llama/llama-4-scout-17b-16e-instruct';

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── JWT helpers ──
function signToken(userId) {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized — no token' });
    }
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized — invalid token' });
    }
}

// Optional auth — sets req.userId if token present, but doesn't block
function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
            req.userId = decoded.userId;
        } catch (_) { /* ignore */ }
    }
    next();
}

// ── Health check ──
app.get('/', (req, res) => res.json({ status: 'NotePilot API running', time: new Date().toISOString() }));

// =============================================================================
// AUTH ENDPOINTS
// =============================================================================

// Register with email/password
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
        if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

        const existing = await User.findOne({ email: email.toLowerCase() });
        if (existing) return res.status(409).json({ error: 'Email already registered' });

        const user = await User.create({ email: email.toLowerCase(), password, name: name || 'Student' });
        const token = signToken(user._id.toString());
        res.json({ token, user: { id: user._id, email: user.email, name: user.name, avatar: user.avatar } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Login with email/password
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(401).json({ error: 'Invalid email or password' });

        const match = await user.comparePassword(password);
        if (!match) return res.status(401).json({ error: 'Invalid email or password' });

        const token = signToken(user._id.toString());
        res.json({ token, user: { id: user._id, email: user.email, name: user.name, avatar: user.avatar } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Google auth — verify Google token and create/login user
app.post('/api/auth/google', async (req, res) => {
    try {
        const { token: googleToken } = req.body;
        if (!googleToken) return res.status(400).json({ error: 'Google token required' });

        // Verify the Google token
        const { OAuth2Client } = require('google-auth-library');
        const client = new OAuth2Client(GOOGLE_CLIENT_ID);

        let payload;
        try {
            const ticket = await client.verifyIdToken({
                idToken: googleToken,
                audience: GOOGLE_CLIENT_ID
            });
            payload = ticket.getPayload();
        } catch (err) {
            return res.status(401).json({ error: 'Invalid Google token' });
        }

        const { sub: googleId, email, name, picture } = payload;

        // Find existing user by googleId or email
        let user = await User.findOne({ $or: [{ googleId }, { email: email.toLowerCase() }] });

        if (user) {
            // Update Google info if needed
            if (!user.googleId) user.googleId = googleId;
            if (picture && !user.avatar) user.avatar = picture;
            if (name && user.name === 'Student') user.name = name;
            await user.save();
        } else {
            user = await User.create({
                email: email.toLowerCase(),
                name: name || 'Student',
                googleId,
                avatar: picture || ''
            });
        }

        const jwtToken = signToken(user._id.toString());
        res.json({ token: jwtToken, user: { id: user._id, email: user.email, name: user.name, avatar: user.avatar } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current user
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ id: user._id, email: user.email, name: user.name, avatar: user.avatar });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// VIDEO DATA (per-user)
// =============================================================================

// Get saved data for a video (for current user)
app.get('/api/videos/:videoId', requireAuth, async (req, res) => {
    try {
        const doc = await Video.findOne({ videoId: req.params.videoId, userId: req.userId });
        if (!doc) return res.json(null);
        res.json(doc);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save / update data for a video (for current user)
app.put('/api/videos/:videoId', requireAuth, async (req, res) => {
    try {
        const { videoTitle, timestamps, aiResponses, pdfTitleVal, sharedRoomId } = req.body;
        const doc = await Video.findOneAndUpdate(
            { videoId: req.params.videoId, userId: req.userId },
            {
                videoId: req.params.videoId,
                userId: req.userId,
                videoTitle: videoTitle || '',
                timestamps: timestamps || [],
                aiResponses: aiResponses || [],
                pdfTitleVal: pdfTitleVal || '',
                sharedRoomId: sharedRoomId || '',
                savedAt: Date.now()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.json({ success: true, data: doc });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// ROOMS (shared — no per-user isolation, but auth required to create)
// =============================================================================

// Create a room
app.post('/api/rooms', requireAuth, async (req, res) => {
    try {
        const { videoId, videoTitle, ownerName, notes, summary } = req.body;
        const roomId = uuidv4().slice(0, 10);
        const room = await Room.create({
            roomId,
            videoId: videoId || '',
            meta: {
                videoTitle: videoTitle || 'Untitled Video',
                ownerName: ownerName || 'Anonymous',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                captureCount: (notes || []).length
            },
            notes: notes || [],
            annotations: [],
            quizzes: [],
            flashcardSets: [],
            summary: summary || []
        });
        res.json({ success: true, roomId, room });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get room data (public — anyone with the link can view)
app.get('/api/rooms/:roomId', async (req, res) => {
    try {
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });
        res.json(room);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update room (re-upload notes from extension)
app.patch('/api/rooms/:roomId', requireAuth, async (req, res) => {
    try {
        const { videoTitle, ownerName, notes, summary } = req.body;
        const update = { 'meta.updatedAt': Date.now() };
        if (videoTitle !== undefined) update['meta.videoTitle'] = videoTitle;
        if (ownerName !== undefined) update['meta.ownerName'] = ownerName;
        if (notes !== undefined) {
            update.notes = notes;
            update['meta.captureCount'] = notes.length;
        }
        if (summary !== undefined) update.summary = summary;

        const room = await Room.findOneAndUpdate(
            { roomId: req.params.roomId },
            { $set: update },
            { new: true }
        );
        if (!room) return res.status(404).json({ error: 'Room not found' });
        res.json({ success: true, room });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Push a single note (live sync from extension)
app.put('/api/rooms/:roomId/notes/:noteIndex', requireAuth, async (req, res) => {
    try {
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });

        const idx = parseInt(req.params.noteIndex);
        while (room.notes.length <= idx) room.notes.push({});
        room.notes[idx] = { ...room.notes[idx]?.toObject?.() || {}, ...req.body };
        room.meta.updatedAt = Date.now();
        room.meta.captureCount = room.notes.length;
        await room.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Patch a note's text fields
app.patch('/api/rooms/:roomId/notes/:noteIndex', requireAuth, async (req, res) => {
    try {
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });

        const idx = parseInt(req.params.noteIndex);
        if (idx >= 0 && idx < room.notes.length) {
            const note = room.notes[idx];
            if (req.body.note !== undefined) note.note = req.body.note;
            if (req.body.ocrText !== undefined) note.ocrText = req.body.ocrText;
            if (req.body.aiExplanation !== undefined) note.aiExplanation = req.body.aiExplanation;
            room.meta.updatedAt = Date.now();
            await room.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// ANNOTATIONS (public read, auth to write)
// =============================================================================

app.post('/api/rooms/:roomId/annotations', async (req, res) => {
    try {
        const { noteIndex, name, text, sessionId } = req.body;
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });

        room.annotations.push({
            noteIndex,
            name: name || 'Anonymous',
            text,
            sessionId: sessionId || '',
            createdAt: Date.now()
        });
        await room.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/rooms/:roomId/annotations', async (req, res) => {
    try {
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });

        let anns = room.annotations || [];
        if (req.query.noteIndex !== undefined) {
            anns = anns.filter(a => a.noteIndex === parseInt(req.query.noteIndex));
        }
        const grouped = {};
        anns.forEach(a => {
            const key = String(a.noteIndex);
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(a);
        });
        res.json(grouped);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// QUIZZES
// =============================================================================

app.post('/api/rooms/:roomId/quiz', async (req, res) => {
    try {
        const { title, questions, createdBy } = req.body;
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });

        const quizId = uuidv4().slice(0, 8);
        room.quizzes.push({
            quizId,
            title: title || 'Quiz',
            questions: questions || [],
            createdBy: createdBy || 'Anonymous',
            createdAt: Date.now()
        });
        await room.save();
        res.json({ success: true, quizId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/rooms/:roomId/quizzes', async (req, res) => {
    try {
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });
        const list = (room.quizzes || []).map(q => ({
            quizId: q.quizId,
            title: q.title,
            questionCount: q.questions.length,
            createdBy: q.createdBy,
            createdAt: q.createdAt
        }));
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/rooms/:roomId/quiz/:quizId', async (req, res) => {
    try {
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });
        const quiz = (room.quizzes || []).find(q => q.quizId === req.params.quizId);
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
        res.json(quiz);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// FLASHCARDS
// =============================================================================

// Save flashcard set to room
app.post('/api/rooms/:roomId/flashcards', async (req, res) => {
    try {
        const { title, cards, createdBy } = req.body;
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });

        const setId = uuidv4().slice(0, 8);
        room.flashcardSets.push({
            setId,
            title: title || 'Flashcards',
            cards: cards || [],
            createdBy: createdBy || 'Anonymous',
            createdAt: Date.now()
        });
        await room.save();
        res.json({ success: true, setId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all flashcard sets for a room
app.get('/api/rooms/:roomId/flashcards', async (req, res) => {
    try {
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });
        const list = (room.flashcardSets || []).map(s => ({
            setId: s.setId,
            title: s.title,
            cardCount: s.cards.length,
            createdBy: s.createdBy,
            createdAt: s.createdAt
        }));
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get a specific flashcard set
app.get('/api/rooms/:roomId/flashcards/:setId', async (req, res) => {
    try {
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });
        const set = (room.flashcardSets || []).find(s => s.setId === req.params.setId);
        if (!set) return res.status(404).json({ error: 'Flashcard set not found' });
        res.json(set);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// AI PROXY (hides Groq API key from client)
// =============================================================================

async function proxyGroq(messages, opts = {}) {
    if (!GROQ_KEY) throw new Error('GROQ_API_KEY not configured on server');
    const model = opts.model || MODEL_CHAT;
    const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
            model,
            messages,
            temperature: opts.temperature ?? 0.7,
            max_tokens: opts.max_tokens ?? 1024
        })
    });
    if (!res.ok) {
        const errBody = await res.text();
        let detail = '';
        try { detail = JSON.parse(errBody)?.error?.message || errBody; } catch (_) { detail = errBody; }
        throw new Error(`Groq ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from Groq');
    return text;
}

// Chat AI (auth required)
app.post('/api/ai/chat', requireAuth, async (req, res) => {
    try {
        const { messages, temperature, max_tokens } = req.body;
        const text = await proxyGroq(messages, { model: MODEL_CHAT, temperature, max_tokens });
        res.json({ text });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Vision AI (auth required)
app.post('/api/ai/vision', requireAuth, async (req, res) => {
    try {
        const { messages, temperature, max_tokens } = req.body;
        const text = await proxyGroq(messages, { model: MODEL_VISION, temperature, max_tokens });
        res.json({ text });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Quiz generation AI (public — used from room viewer)
app.post('/api/ai/quiz', async (req, res) => {
    try {
        const { context } = req.body;
        const raw = await proxyGroq([
            { role: 'system', content: 'You are an expert quiz generator. Respond ONLY with valid JSON — no markdown fences, no explanation.' },
            { role: 'user', content: `Generate exactly 10 multiple-choice questions from this video content.\n\n${context}\n\nReturn ONLY this JSON:\n{"quizTitle":"Short title","questions":[{"topic":"2-3 word tag","difficulty":"easy|medium|hard","question":"Text ≤25 words","options":["A","B","C","D"],"correctIndex":0,"explanation":"1-2 sentences.","timestampHint":"e.g. 3:45 or null"}]}\n\nRules: exactly 10 questions (3 easy,5 medium,2 hard); cover the FULL video; plausible distractors; if math appears include 2 equation questions; correctIndex is 0-based.` }
        ], { temperature: 0.35, max_tokens: 3000 });
        const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        const data = JSON.parse(clean);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Flashcard generation AI (public — used from both extension and room)
app.post('/api/ai/flashcards', async (req, res) => {
    try {
        const { context } = req.body;
        const raw = await proxyGroq([
            { role: 'system', content: 'You are an expert flashcard creator for students. Respond ONLY with valid JSON — no markdown fences, no explanation.' },
            { role: 'user', content: `Generate 15 study flashcards from this video content.\n\n${context}\n\nReturn ONLY this JSON:\n{"title":"Short descriptive title","cards":[{"front":"Question or term","back":"Answer or definition","topic":"2-3 word tag"}]}\n\nRules: exactly 15 cards; mix of definitions, concepts, and application questions; cover the FULL content; front should be concise (≤20 words); back should be clear but brief (≤40 words); use LaTeX for math.` }
        ], { temperature: 0.35, max_tokens: 3000 });
        const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        const data = JSON.parse(clean);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// START SERVER
// =============================================================================

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/notepilot')
    .then(async () => {
        console.log('✓ MongoDB connected');

        // Drop old videoId_1 unique index if it exists (replaced by compound {videoId, userId})
        try {
            const collection = mongoose.connection.collection('videos');
            const indexes = await collection.indexes();
            const oldIndex = indexes.find(i => i.name === 'videoId_1' && i.unique);
            if (oldIndex) {
                await collection.dropIndex('videoId_1');
                console.log('✓ Dropped old videoId_1 unique index');
            }
        } catch (err) {
            // Index might not exist — that's fine
            if (!err.message.includes('not found')) console.warn('Index cleanup note:', err.message);
        }

        app.listen(PORT, () => console.log(`✓ NotePilot API running on http://localhost:${PORT}`));
    })
    .catch(err => {
        console.error('MongoDB connection error:', err.message);
        process.exit(1);
    });
