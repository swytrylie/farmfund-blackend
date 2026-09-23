const mongoose = require('mongoose');

/**
 * Farm
 * ----
 * Separate entity from User, with its own information and lifecycle.
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

farmSchema.index({ owner: 1 });

module.exports = mongoose.model('Farm', farmSchema);
