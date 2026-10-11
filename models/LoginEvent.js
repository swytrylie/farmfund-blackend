const mongoose = require('mongoose');

/**
 * LoginEvent
 * ----------
 * One row per login attempt (worked or not), written by utils/loginEvents.js
 * and read by the admin "User Activity" page.
 *
 * Rows delete themselves after 90 days (TTL index below) so the collection
 * can't grow forever. `email` is what was typed, kept only when it looks like
 * an email address.
 */
const loginEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // absent when the email matched nobody
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    success: { type: Boolean, required: true },
    // Why a failed attempt failed: unknown_email, wrong_password, locked,
    // suspended, unverified, org_not_approved. Absent on success.
    reason: { type: String, trim: true, maxlength: 40 },
    ip: { type: String, trim: true, maxlength: 64 },
    device: { type: String, trim: true, maxlength: 80 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

loginEventSchema.index({ createdAt: -1 });
loginEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('LoginEvent', loginEventSchema);