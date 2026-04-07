const mongoose = require('mongoose');

const annotationSchema = new mongoose.Schema({
    noteIndex: { type: Number, required: true },
    name: { type: String, default: 'Anonymous' },
    text: { type: String, required: true },
    sessionId: { type: String, default: '' },
    createdAt: { type: Number, default: Date.now }
}, { _id: true });

const quizQuestionSchema = new mongoose.Schema({
    topic: String,
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    question: String,
    options: [String],
    correctIndex: Number,
    explanation: String,
    timestampHint: String
}, { _id: false });

const quizSchema = new mongoose.Schema({
    quizId: { type: String, required: true },
    title: { type: String, default: 'Quiz' },
    questions: [quizQuestionSchema],
    createdBy: { type: String, default: 'Anonymous' },
    createdAt: { type: Number, default: Date.now }
}, { _id: false });

const flashcardSchema = new mongoose.Schema({
    front: { type: String, required: true },
    back: { type: String, required: true },
    topic: { type: String, default: '' }
}, { _id: false });

const flashcardSetSchema = new mongoose.Schema({
    setId: { type: String, required: true },
    title: { type: String, default: 'Flashcards' },
    cards: [flashcardSchema],
    createdBy: { type: String, default: 'Anonymous' },
    createdAt: { type: Number, default: Date.now }
}, { _id: false });

const noteSchema = new mongoose.Schema({
    id: String,
    timestamp: String,
    videoTime: Number,
    note: { type: String, default: '' },
    snapshot: { type: String, default: '' },
    ocrText: { type: String, default: '' },
    aiExplanation: { type: String, default: '' }
}, { _id: false });

const roomSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true, index: true },
    videoId: { type: String, default: '' },
    meta: {
        videoTitle: { type: String, default: '' },
        ownerName: { type: String, default: 'Anonymous' },
        createdAt: { type: Number, default: Date.now },
        updatedAt: { type: Number, default: Date.now },
        captureCount: { type: Number, default: 0 }
    },
    notes: [noteSchema],
    annotations: [annotationSchema],
    quizzes: [quizSchema],
    flashcardSets: [flashcardSetSchema],
    summary: { type: mongoose.Schema.Types.Mixed, default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);
