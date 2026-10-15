const mongoose = require('mongoose');

/**
 * PaymentProof
 * ------------
 * A farmer's claim "I paid this much, here is the receipt" for one of their
 * loans. It is NOT a payment: the loan balance does not move until the
 * lending cooperative's staff verify it, and verifying creates the real
 * LoanPayment (linked back here as loanPayment). The receipt itself (a photo
 * or PDF) is kept privately on Cloudinary; only its reference is stored here.
 */
const paymentProofSchema = new mongoose.Schema(
  {
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
    // Copied from the loan when submitted, so the cooperative's list is one simple query.
    cooperative: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true },
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['gcash', 'maya', 'cash', 'bank_transfer'], required: true },
    paymentDate: { type: Date, required: true, default: Date.now },
    referenceNumber: { type: String, trim: true, maxlength: 50 },
    note: { type: String, trim: true, maxlength: 300 },

    file: {
      publicId: { type: String, required: true },
      format: { type: String, required: true }, // pdf | jpg | png
      bytes: { type: Number, required: true },
      originalName: { type: String, trim: true, maxlength: 200 },
    },

    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    reviewNote: { type: String, trim: true, maxlength: 300 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedByName: { type: String, trim: true },
    reviewedAt: { type: Date },
    // Set when verified: the payment that was recorded on the loan.
    loanPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanPayment' },
  },
  { timestamps: true }
);

paymentProofSchema.index({ cooperative: 1, status: 1, createdAt: -1 });
paymentProofSchema.index({ farmer: 1, createdAt: -1 });
paymentProofSchema.index({ loan: 1 });

module.exports = mongoose.model('PaymentProof', paymentProofSchema);