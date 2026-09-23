const mongoose = require('mongoose');

/**
 * Budget → Budget Categories: EMBEDDED
 * Budget allocations belong directly to one budget and are normally
 * retrieved together with it (no independent lifecycle/reuse).
 *
 * Note: budgetCategorySchema.category still REFERENCES FinancialCategory
 * (shared master data), it's just that the ALLOCATION line-item itself
 * is embedded inside the Budget document.
 */
const budgetCategorySchema = new mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FinancialCategory',
      required: true,
    },
    allocatedAmount: { type: Number, required: true, min: 0 },
    spentAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const budgetSchema = new mongoose.Schema(
  {
    farm: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    totalAmount: { type: Number, required: true, min: 0 },

    // EMBEDDED array of allocation line-items
    categories: { type: [budgetCategorySchema], default: [] },
  },
  { timestamps: true }
);

budgetSchema.index({ farm: 1, periodStart: -1 });

module.exports = mongoose.model('Budget', budgetSchema);
