const mongoose = require('mongoose');

/**
 * AiInsight
 * ---------
 * A saved AI Summary or AI Advisor opening, so opening the page again doesn't spend the free
 * Gemini quota. `dataHash` changes whenever the farmer's records change (and
 * every new day), which makes the old copy stale. MongoDB deletes expired
 * copies on its own through the TTL index on expiresAt.
 */
const aiInsightSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['summary', 'advisor'], required: true },
    dataHash: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

aiInsightSchema.index({ user: 1, kind: 1 }, { unique: true });
aiInsightSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AiInsight', aiInsightSchema);
