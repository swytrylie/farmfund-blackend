const mongoose = require('mongoose');
const receiptMetadataSchema = require('./schemas/receiptMetadata.schema');

/**
 * FinancialRecord
 * ---------------
 * - category: REFERENCE → FinancialCategory is shared master data.
 * - receiptMetadata: EMBEDDED → belongs directly to this record only.
 * - paymentMethod: optional — how the money moved (GCash, Cash, etc.).
 * - farmingCycle: optional REFERENCE → lets a transaction be linked to a
 *   specific crop cycle (e.g. "this ₱8,000 fertilizer expense was for the
 *   corn planted in March"), rather than only the farm as a whole. Most
 *   transactions won't have one — general farm expenses, labor, etc.
 *   aren't tied to a single crop — so this is optional, not required.
 */
const financialRecordSchema = new mongoose.Schema(
  {
    farm: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm',
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FinancialCategory',
      required: true,
    },
    type: {
      type: String,
      enum: ['income', 'expense'],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: Date.now },
    description: { type: String, trim: true },
    paymentMethod: {
      type: String,
      enum: ['GCash', 'Maya', 'Cash', 'Bank Transfer'],
    },
    farmingCycle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FarmingCycle',
    },

    // EMBEDDED sub-document — travels with the record
    receiptMetadata: { type: receiptMetadataSchema, default: undefined },
  },
  { timestamps: true }
);

financialRecordSchema.index({ farm: 1, date: -1 });
financialRecordSchema.index({ category: 1 });
financialRecordSchema.index({ farmingCycle: 1 });

module.exports = mongoose.model('FinancialRecord', financialRecordSchema);