const mongoose = require('mongoose');

/**
 * CooperativeMember
 * -----------------
 * Reference bridge between User and Cooperative.
 * A cooperative can have individual users with coop-level roles:
 * - exactly one 'owner' — enforced below at the database level.
 * - up to THREE 'finance_manager' — a MAXIMUM COUNT isn't something a
 *   unique index can express (a unique index only allows 0 or 1 matching
 *   documents, not "up to N"), so this rule has to be enforced in
 *   application code instead, when a CooperativeMember controller is
 *   built. No such controller exists yet, so nothing currently stops a
 *   4th finance_manager from being created directly — the schema itself
 *   only guarantees the 'owner' rule right now.
 * - unlimited 'member'.
 */
const cooperativeMemberSchema = new mongoose.Schema(
  {
    cooperative: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cooperative',
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      enum: ['owner', 'finance_manager', 'member'],
      default: 'member',
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'removed'],
      default: 'active',
    },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// A user can only have one membership record per cooperative
cooperativeMemberSchema.index({ cooperative: 1, user: 1 }, { unique: true });

// Enforce "only one owner" per cooperative at the DB level. finance_manager
// is deliberately excluded — see the up-to-3 note above.
cooperativeMemberSchema.index(
  { cooperative: 1, role: 1 },
  {
    unique: true,
    partialFilterExpression: { role: 'owner' },
  }
);

module.exports = mongoose.model('CooperativeMember', cooperativeMemberSchema);