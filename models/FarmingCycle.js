const mongoose = require('mongoose');

/**
 * FarmingCycle
 * ------------
 * Historical/independent record — a field can go through many farming
 * cycles over time, so this is its own collection referencing Field.
 */
const farmingCycleSchema = new mongoose.Schema(
  {
    field: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Field',
      required: true,
    },
    crop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Crop',
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    status: {
      type: String,
      enum: ['planned', 'planting', 'growing', 'harvested', 'failed'],
      default: 'planned',
    },
    expectedYieldKg: { type: Number, min: 0 },
    actualYieldKg: { type: Number, min: 0 },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

farmingCycleSchema.index({ field: 1, startDate: -1 });

module.exports = mongoose.model('FarmingCycle', farmingCycleSchema);
