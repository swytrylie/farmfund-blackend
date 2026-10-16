const mongoose = require('mongoose');

/**
 * Notification
 * ------------
 * A message that lands in ONE person's notification bell and Alerts page.
 * Three kinds: a payment reminder a cooperative sent to a borrower, a
 * heads-up to a cooperative's finance staff that a farmer sent a proof of
 * payment to check, and a heads-up to the FarmFund admins that a farmer
 * submitted a certificate to verify. The email that goes with a reminder or
 * a proof is a separate thing.
 *
 * - user is the only person who can ever see it (the routes filter on it).
 * - details is a snapshot of the facts at the time it was sent (what was owed,
 *   when it was due). It is not recalculated later, so the borrower reads what
 *   the email said.
 * - readAt is empty until the borrower opens it.
 */
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['payment_reminder', 'payment_proof_submitted', 'certificate_submitted'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 200 },
    details: {
      coopName: { type: String, trim: true, maxlength: 200 },
      typeLabel: { type: String, trim: true, maxlength: 100 },
      loanRef: { type: String, trim: true, maxlength: 20 },
      remaining: { type: Number },
      dueDate: { type: Date },
      dueNote: { type: String, trim: true, maxlength: 100 },
      contactEmail: { type: String, trim: true, maxlength: 200 },
      contactPhone: { type: String, trim: true, maxlength: 50 },
      // payment_proof_submitted and certificate_submitted
      farmerName: { type: String, trim: true, maxlength: 200 },
      amount: { type: Number },
      methodLabel: { type: String, trim: true, maxlength: 50 },
    },
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
    cooperative: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative' },
    paymentProof: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentProof' },
    certificate: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate' },
    readAt: { type: Date },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);