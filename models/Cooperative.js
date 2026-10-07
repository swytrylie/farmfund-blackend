const mongoose = require('mongoose');

/**
 * Cooperative
 * -----------
 * Separate organization/entity. Its members are NOT embedded here —
 * they live in the CooperativeMember collection (Reference).
 *
 * status replaces a plain isActive flag: an organization's signup goes
 * through a real approval step (matching the admin "Pending approvals"
 * flow), so it needs three states, not just on/off.
 * - pending: signed up, awaiting admin review
 * - active: approved, fully usable
 * - rejected: admin declined the application
 */
const cooperativeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    registrationNumber: { type: String, trim: true, unique: true, sparse: true },
    address: { type: String, trim: true },
    contactEmail: { type: String, trim: true, lowercase: true },
    contactPhone: { type: String, trim: true },
    status: {
      type: String,
      enum: ['pending', 'active', 'rejected'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Cooperative', cooperativeSchema);