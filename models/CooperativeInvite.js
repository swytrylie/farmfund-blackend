const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * CooperativeInvite
 * ------------------
 * For inviting someone who DOESN'T have a FarmFund account yet — they
 * can't be added to CooperativeMember directly, since that requires a
 * real User to already exist. This holds the invite in a pending state
 * until the invitee sets their own password and a real User +
 * CooperativeMember get created together.
 *
 * token is the invite link's only real security — long, random, and
 * unguessable (32 bytes of randomness, hex-encoded). Treated like a
 * one-time password: whoever has the raw link can accept the invite.
 */
const cooperativeInviteSchema = new mongoose.Schema(
  {
    cooperative: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cooperative',
      required: true,
    },
    email: { type: String, required: true, trim: true, lowercase: true },
    role: {
      type: String,
      enum: ['finance_manager', 'member'], // never 'owner' — a cooperative only ever gets one, set at signup
      default: 'member',
      required: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(32).toString('hex'),
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'revoked'],
      default: 'pending',
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  },
  { timestamps: true }
);

cooperativeInviteSchema.index({ cooperative: 1, email: 1, status: 1 });

module.exports = mongoose.model('CooperativeInvite', cooperativeInviteSchema);