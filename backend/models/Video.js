const mongoose = require('mongoose');

const timestampSchema = new mongoose.Schema({
    id: String,
    timestamp: String,
    videoTime: Number,
    note: { type: String, default: '' },
    snapshot: { type: String, default: '' },
    ocrText: { type: String, default: '' },
    aiExplanation: { type: String, default: '' }
}, { _id: false });

const aiResponseSchema = new mongoose.Schema({
    question: String,
    answer: String,
    time: String,
    includedInPdf: { type: Boolean, default: true }
}, { _id: false });

const videoSchema = new mongoose.Schema({
    videoId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    videoTitle: { type: String, default: '' },
    timestamps: [timestampSchema],
    aiResponses: [aiResponseSchema],
    pdfTitleVal: { type: String, default: '' },
    sharedRoomId: { type: String, default: '' },
    savedAt: { type: Number, default: Date.now }
}, { timestamps: true });

// Compound unique index — each user has their own copy per video
videoSchema.index({ videoId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Video', videoSchema);
