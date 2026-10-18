const mongoose = require('mongoose');

/**
 * AiChat
 * ------
 * One running conversation per farmer with the AI Farm Advisor, shared by the
 * full AI Advisor page and the floating widget. Only the last 100 messages
 * are kept.
 */
const aiChatMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'model'], required: true },
    text: { type: String, required: true, maxlength: 8000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const aiChatSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    messages: { type: [aiChatMessageSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AiChat', aiChatSchema);
