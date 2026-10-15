const mongoose = require('mongoose');
const receiptMetadataSchema = require('./schemas/receiptMetadata.schema');

/**
 * LoanPayment
 * -----------
 * - loan: REFERENCE → a loan has multiple payments, stored independently.
 * - receiptMetadata: EMBEDDED → belongs directly to this payment.
 * - paymentTransaction: REFERENCE → gateway integration is a separate,
 *   not-yet-finalized technical concern (optional until that's built).
 * - recordedBy: the cooperative staff member who entered this payment.
 *   Payments are recorded by hand for now (cash, bank transfer, etc.), so
 *   this is the audit trail — who said this money was received, and when.
 *   Optional only because it won't exist on payments made before this
 *   field was added or on future gateway-driven ones.
 */
const loanPaymentSchema = new mongoose.Schema(
  {
    loan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Loan',
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    paymentDate: { type: Date, required: true, default: Date.now },
    method: {
      type: String,
      enum: ['cash', 'bank_transfer', 'gcash', 'maya', 'mobile_wallet', 'other'],
      default: 'cash',
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // EMBEDDED sub-document
    receiptMetadata: { type: receiptMetadataSchema, default: undefined },

    // REFERENCE — optional, gateway integration not finalized yet
    paymentTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentTransaction',
      required: false,
    },
  },
  { timestamps: true }
);

loanPaymentSchema.index({ loan: 1, paymentDate: -1 });

module.exports = mongoose.model('LoanPayment', loanPaymentSchema);