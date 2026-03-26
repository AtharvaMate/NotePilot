const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: 'Student' },
    password: { type: String },  // null for Google-only users
    googleId: { type: String, default: '' },
    avatar: { type: String, default: '' },
    createdAt: { type: Number, default: Date.now }
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password') || !this.password) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidate) {
    if (!this.password) return false;
    return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
