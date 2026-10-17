const mongoose = require('mongoose');
const { CROP_KEYS, COLLATERAL_KEYS } = require('../utils/loanTerms');

/**
 * Loan
 * ----
 * - farmer: REFERENCE → User is a separate entity.
 * - cooperative: REFERENCE → Cooperative is a separate entity.
 * - Loans requested with a crop and collateral (the current way) store the
 *   crop, its growing time, and the collateral. For these, interestRatePercent
 *   is ONE flat percentage for the whole crop cycle (rateBasis 'cycle'). Older
 *   loans have no rateBasis and keep their yearly rate over termMonths.
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
    // 'cycle' = interestRatePercent is a flat total for the crop cycle; missing = yearly rate (older loans)
    rateBasis: { type: String, enum: ['cycle'] },
    crop: { type: String, enum: CROP_KEYS },
    growingDays: { type: Number, min: 1 },
    collateral: {
      kind: { type: String, enum: COLLATERAL_KEYS },
      description: { type: String, trim: true, maxlength: 500 },
      // The proof file is private. publicId (its storage reference) is left out of
      // every normal query, so it cannot leak by accident; it is asked for by name
      // only where a signed link is made.
      file: {
        publicId: { type: String, select: false },
        format: { type: String }, // pdf | jpg | png
        bytes: { type: Number },
        originalName: { type: String, trim: true, maxlength: 200 },
      },
    },
    // pending_admin = a new request waiting for a FarmFund admin to check the
    // collateral proof (the cooperative cannot see it yet). Verified -> pending
    // (now with the cooperative). Not verified -> admin_rejected (never sent).
    status: {
      type: String,
      enum: ['pending_admin', 'admin_rejected', 'pending', 'approved', 'active', 'paid_off', 'defaulted', 'rejected'],
      default: 'pending',
    },
    // The admin's check of the collateral proof. Missing on older loans, which
    // went straight to their cooperative.
    adminReview: {
      status: { type: String, enum: ['pending', 'verified', 'rejected'] },
      note: { type: String, trim: true, maxlength: 300 },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reviewedByName: { type: String, trim: true, maxlength: 200 },
      reviewedAt: { type: Date },
    },
    issuedDate: { type: Date },
    dueDate: { type: Date },
  },
  { timestamps: true }
);

loanSchema.index({ farmer: 1 });
loanSchema.index({ cooperative: 1 });
loanSchema.index({ status: 1, createdAt: 1 });

// Virtual populate: loan.payments -> all LoanPayment docs referencing this loan
loanSchema.virtual('payments', {
  ref: 'LoanPayment',
  localField: '_id',
  foreignField: 'loan',
});

loanSchema.set('toObject', { virtuals: true });
loanSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Loan', loanSchema);