const mongoose = require('mongoose');

/**
 * FinancialCategory
 * ------------------
 * Shared master data used by many FinancialRecord and Budget documents
 * (e.g. 'Seeds', 'Fertilizer', 'Labor', 'Equipment', 'Sales Income').
 */
const financialCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    type: {
      type: String,
      enum: ['income', 'expense'],
      required: true,
    },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FinancialCategory', financialCategorySchema);
