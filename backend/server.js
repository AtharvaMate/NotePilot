require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const Video = require('./models/Video');
const Room = require('./models/Room');

const app = express();
const PORT = process.env.PORT || 3001;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const MODEL_CHAT = 'llama-3.3-70b-versatile';
const MODEL_VISION = 'meta-llama/llama-4-scout-17b-16e-instruct';

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── Health check ──
app.get('/', (req, res) => res.json({ status: 'NotePilot API running', time: new Date().toISOString() }));

// =============================================================================
// VIDEO DATA (replaces chrome.storage.local)
// =============================================================================

// Get saved data for a video
app.get('/api/videos/:videoId', async (req, res) => {
    try {
        const doc = await Video.findOne({ videoId: req.params.videoId });
        if (!doc) return res.json(null);
        res.json(doc);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save / update data for a video
app.put('/api/videos/:videoId', async (req, res) => {
    try {
        const { videoTitle, timestamps, aiResponses, pdfTitleVal, sharedRoomId } = req.body;
        const doc = await Video.findOneAndUpdate(
            { videoId: req.params.videoId },
            {
                videoId: req.params.videoId,
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
// ROOMS (replaces Firebase Realtime DB)
// =============================================================================

// Create a room
app.post('/api/rooms', async (req, res) => {
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
            summary: summary || []
        });
        res.json({ success: true, roomId, room });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get room data
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
app.patch('/api/rooms/:roomId', async (req, res) => {
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
app.put('/api/rooms/:roomId/notes/:noteIndex', async (req, res) => {
    try {
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });

        const idx = parseInt(req.params.noteIndex);
        // Extend notes array if needed
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

// Patch a note's text fields (live sync — no image recompression)
app.patch('/api/rooms/:roomId/notes/:noteIndex', async (req, res) => {
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
// ANNOTATIONS
// =============================================================================

// Add an annotation to a note
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

// Get annotations (optionally filtered by noteIndex)
app.get('/api/rooms/:roomId/annotations', async (req, res) => {
    try {
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });

        let anns = room.annotations || [];
        if (req.query.noteIndex !== undefined) {
            anns = anns.filter(a => a.noteIndex === parseInt(req.query.noteIndex));
        }
        // Group by noteIndex for easy consumption
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

// Save a quiz to a room
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

// Get all quizzes for a room
app.get('/api/rooms/:roomId/quizzes', async (req, res) => {
    try {
        const room = await Room.findOne({ roomId: req.params.roomId });
        if (!room) return res.status(404).json({ error: 'Room not found' });
        // Return quizzes without full questions for list view
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

// Get a specific quiz
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

// Chat AI
app.post('/api/ai/chat', async (req, res) => {
    try {
        const { messages, temperature, max_tokens } = req.body;
        const text = await proxyGroq(messages, { model: MODEL_CHAT, temperature, max_tokens });
        res.json({ text });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Vision AI (OCR)
app.post('/api/ai/vision', async (req, res) => {
    try {
        const { messages, temperature, max_tokens } = req.body;
        const text = await proxyGroq(messages, { model: MODEL_VISION, temperature, max_tokens });
        res.json({ text });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Quiz generation AI
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

// =============================================================================
// START SERVER
// =============================================================================

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/notepilot')
    .then(() => {
        console.log('✓ MongoDB connected');
        app.listen(PORT, () => console.log(`✓ NotePilot API running on http://localhost:${PORT}`));
    })
    .catch(err => {
        console.error('MongoDB connection error:', err.message);
        process.exit(1);
    });
