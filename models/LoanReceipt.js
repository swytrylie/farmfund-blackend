const mongoose = require('mongoose');

/**
 * LoanReceipt
 * -----------
 * The official digital receipt a farmer gets when their cooperative VERIFIES a
 * loan payment. It is created in the same database transaction that records the
 * payment, so a verified payment always has exactly one receipt and a failed
 * verification leaves none.
 *
 * Names and amounts are copied in at that moment on purpose: a receipt is a
 * record of what was true then, so a renamed cooperative or a later payment
 * must not change it.
 */
const loanReceiptSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, unique: true }, // RCPT-202610-0012
    category: { type: String, enum: ['loan_payment'], default: 'loan_payment' },

    farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    farmerName: { type: String, trim: true, maxlength: 200 },
    cooperative: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true },
    cooperativeName: { type: String, trim: true, maxlength: 200 },
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
    loanRef: { type: String, trim: true, maxlength: 20 },

    // One receipt per recorded payment, enforced by the database.
    loanPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanPayment', required: true, unique: true },
    paymentProof: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentProof' },

    method: { type: String, enum: ['gcash', 'maya', 'cash', 'bank_transfer'], required: true },
    referenceNumber: { type: String, trim: true, maxlength: 50 },
    amount: { type: Number, required: true, min: 0 },
    remainingBalance: { type: Number, required: true, min: 0 },
    paymentDate: { type: Date },

    status: { type: String, enum: ['verified'], default: 'verified' },
    verifiedByName: { type: String, trim: true, maxlength: 120 },
    issuedAt: { type: Date, required: true }, // the moment the cooperative verified it
  },
  { timestamps: true }
);

loanReceiptSchema.index({ farmer: 1, issuedAt: -1 });

module.exports = mongoose.model('LoanReceipt', loanReceiptSchema);