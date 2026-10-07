const mongoose = require('mongoose');

/**
 * Farm
 * ----
 * Separate entity from User, with its own information and lifecycle.
 *
 * One farm per user, enforced at the database level: `unique: true` below
 * means MongoDB itself rejects a second Farm document with the same owner,
 * no matter which code path tries to create it. createFarm() in
 * farm.controller.js catches this and returns a friendly message; the
 * global errorHandler also has a generic fallback for it either way.
 */
const farmSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    location: {
      address: { type: String, trim: true },
      latitude: { type: Number },
      longitude: { type: Number },
    },
    totalAreaHectares: { type: Number, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

farmSchema.index({ owner: 1 }, { unique: true });

module.exports = mongoose.model('Farm', farmSchema);