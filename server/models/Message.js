// server/models/Message.js
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  room: { type: String, default: 'global' },
  text: { type: String, required: true },
  sender: { type: String, default: 'Anonymous' },
  senderId: { type: String },
  to: { type: String, default: null },
  isPrivate: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Message', MessageSchema);
