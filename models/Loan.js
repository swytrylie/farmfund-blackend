const mongoose = require('mongoose');

/**
 * Loan
 * ----
 * - farmer: REFERENCE → User is a separate entity.
 * - cooperative: REFERENCE → Cooperative is a separate entity.
 * - payments: NOT stored here. LoanPayment references Loan (one-to-many,
 *   independently stored payment history) — see LoanPayment.js.
 *   Use LoanPayment.find({ loan: loanId }) or a virtual populate to fetch.
 */
const loanSchema = new mongoose.Schema(
  {
    farmer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    cooperative: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cooperative',
      required: true,
    },
    principalAmount: { type: Number, required: true, min: 0 },
    interestRatePercent: { type: Number, required: true, min: 0 },
    termMonths: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'active', 'paid_off', 'defaulted', 'rejected'],
      default: 'pending',
    },
    issuedDate: { type: Date },
    dueDate: { type: Date },
  },
  { timestamps: true }
);

loanSchema.index({ farmer: 1 });
loanSchema.index({ cooperative: 1 });

// Virtual populate: loan.payments -> all LoanPayment docs referencing this loan
loanSchema.virtual('payments', {
  ref: 'LoanPayment',
  localField: '_id',
  foreignField: 'loan',
});

loanSchema.set('toObject', { virtuals: true });
loanSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Loan', loanSchema);
