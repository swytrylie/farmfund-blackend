const mongoose = require('mongoose');

/**
 * Cooperative
 * -----------
 * Separate organization/entity. Its members are NOT embedded here —
 * they live in the CooperativeMember collection (Reference).
 */
const cooperativeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    registrationNumber: { type: String, trim: true, unique: true, sparse: true },
    address: { type: String, trim: true },
    contactEmail: { type: String, trim: true, lowercase: true },
    contactPhone: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Cooperative', cooperativeSchema);
