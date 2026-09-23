const mongoose = require('mongoose');
const receiptMetadataSchema = require('./schemas/receiptMetadata.schema');

/**
 * FinancialRecord
 * ---------------
 * - category: REFERENCE → FinancialCategory is shared master data.
 * - receiptMetadata: EMBEDDED → belongs directly to this record only.
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

    // EMBEDDED sub-document — travels with the record
    receiptMetadata: { type: receiptMetadataSchema, default: undefined },
  },
  { timestamps: true }
);

financialRecordSchema.index({ farm: 1, date: -1 });
financialRecordSchema.index({ category: 1 });

module.exports = mongoose.model('FinancialRecord', financialRecordSchema);
