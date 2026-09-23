const mongoose = require('mongoose');

/**
 * CooperativeMember
 * -----------------
 * Reference bridge between User and Cooperative.
 * A cooperative can have individual users with coop-level roles:
 * exactly one 'owner' and one 'finance_manager' are expected (enforced
 * at the application/service layer, not the schema level, since Mongo
 * can't do cross-document uniqueness constraints like "only one per role
 * per cooperative" natively without a compound partial index).
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

// Enforce "only one owner" and "only one finance_manager" per cooperative
// at the DB level using a partial unique index.
cooperativeMemberSchema.index(
  { cooperative: 1, role: 1 },
  {
    unique: true,
    partialFilterExpression: { role: { $in: ['owner', 'finance_manager'] } },
  }
);

module.exports = mongoose.model('CooperativeMember', cooperativeMemberSchema);
