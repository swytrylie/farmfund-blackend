const mongoose = require('mongoose');

/**
 * Announcement
 * ------------
 * One admin announcement that was emailed to an audience. The page's "Sent
 * Announcements" list reads these. Counts are filled in as the emails go out:
 *   recipients = how many people were in the audience,
 *   sent       = how many emails the mail server accepted,
 *   failed     = the rest (a bad address, or time ran out).
 */
const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    audience: { type: String, required: true, enum: ['all', 'farm_owners', 'cooperatives'] },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sentByName: { type: String, trim: true },
    recipients: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    // Everyone the announcement was addressed to when it was sent (at most 100),
    // and which of them have opened it. Farmers and cooperative members read
    // their own announcements through these two lists.
    recipientIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // sending -> sent (everyone got it) | partial (some did) | failed (nobody did)
    status: { type: String, enum: ['sending', 'sent', 'partial', 'failed'], default: 'sending' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

announcementSchema.index({ createdAt: -1 });
announcementSchema.index({ recipientIds: 1, createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);