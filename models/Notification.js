const mongoose = require('mongoose');

/**
 * Notification
 * ------------
 * A message that lands in ONE person's notification bell and Alerts page.
 * Four kinds: a payment reminder a cooperative sent to a borrower, a
 * heads-up to a cooperative's finance staff that a farmer sent a proof of
 * payment to check, a heads-up to the FarmFund admins that a farmer
 * submitted a certificate to verify, and a note to the farmer that an admin
 * verified their certificate. The email that goes with a reminder, a proof or
 * a verification is a separate thing.
 *
 * - user is the only person who can ever see it (the routes filter on it).
 * - details is a snapshot of the facts at the time it was sent (what was owed,
 *   when it was due). It is not recalculated later, so the borrower reads what
 *   the email said.
 * - readAt is empty until the borrower opens it.
 */
// loan_submitted: to the admins, a farmer's loan request needs its collateral checked.
// loan_update: to a farmer, news about their loan (verified, not verified, ...).
// loan_alert: to a cooperative's owner / finance managers, news about a loan of theirs.
// claim_submitted: to the admins, a farmer asked for disaster relief and the proof needs checking.
const KINDS = ['payment_reminder', 'payment_proof_submitted', 'certificate_submitted', 'certificate_verified', 'loan_submitted', 'loan_update', 'loan_alert', 'claim_submitted'];

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: KINDS, required: true },
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
      // payment_proof_submitted and certificate_submitted (certificate_verified: amount = the farmer's credit limit)
      farmerName: { type: String, trim: true, maxlength: 200 },
      amount: { type: Number },
      methodLabel: { type: String, trim: true, maxlength: 50 },
      // loan notices: why a request was not verified, what the loan is for
      reason: { type: String, trim: true, maxlength: 300 },
    },
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
    cooperative: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative' },
    paymentProof: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentProof' },
    certificate: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate' },
    claim: { type: mongoose.Schema.Types.ObjectId, ref: 'CalamityClaim' },
    readAt: { type: Date },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
Notification.KINDS = KINDS;
module.exports = Notification;