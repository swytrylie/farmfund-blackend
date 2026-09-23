const mongoose = require('mongoose');

/**
 * Crop
 * ----
 * Shared master/reference data used by many FarmingCycle documents.
 */
const CATEGORY_VALUES = ['grain', 'vegetable', 'fruit', 'legume', 'root', 'other'];

const cropSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, maxlength: 100 },
    variety: { type: String, trim: true, maxlength: 100 },
    category: { type: String, trim: true, enum: CATEGORY_VALUES },
    typicalGrowingDays: { type: Number, min: 0, max: 1000 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

cropSchema.index({ name: 'text' }); // enables efficient text search

module.exports = mongoose.model('Crop', cropSchema);
module.exports.CATEGORY_VALUES = CATEGORY_VALUES;