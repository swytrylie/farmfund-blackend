const mongoose = require('mongoose');

/**
 * Field
 * -----
 * Independently managed plot. A farm can contain multiple fields.
 */
const fieldSchema = new mongoose.Schema(
  {
    farm: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    areaHectares: { type: Number, min: 0 },
    soilType: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

fieldSchema.index({ farm: 1 });

module.exports = mongoose.model('Field', fieldSchema);
