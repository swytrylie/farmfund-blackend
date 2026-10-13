const mongoose = require('mongoose');

/**
 * Notification
 * ------------
 * A message that lands in ONE person's notification bell and Alerts page.
 * Right now the only kind is a payment reminder a cooperative sent to a
 * borrower; the email that goes with it is a separate thing.
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
    kind: { type: String, enum: ['payment_reminder'], required: true },
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
    },
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
    cooperative: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative' },
    readAt: { type: Date },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);