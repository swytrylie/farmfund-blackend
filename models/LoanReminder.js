const mongoose = require('mongoose');

/**
 * LoanReminder
 * ------------
 * A permanent record of every payment reminder a cooperative has sent a
 * borrower — including ones that failed to send, so staff can see what
 * actually happened rather than assume.
 *
 * - cooperative is stored here as well as reachable through loan, purely so
 *   "all of this cooperative's reminders" is one simple query instead of a
 *   lookup across every one of its loans first.
 * - status is "sent" (the mail server accepted it) or "failed". It is
 *   deliberately NOT "delivered": a mail server accepting a message doesn't
 *   prove it reached the inbox, and claiming otherwise would be a lie.
 * - failureReason is a generic, human-readable phrase. The real error from
 *   the mail server is logged server-side only — it can contain internal
 *   details that have no business appearing on a staff member's screen.
 * - channel is the email. inApp says whether the borrower was ALSO given a
 *   notification in the app (their bell and Alerts page). status below is
 *   about the email only.
 */
const loanReminderSchema = new mongoose.Schema(
  {
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
    cooperative: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['overdue_notice', 'upcoming_payment', 'payment_followup', 'final_overdue_notice'],
      required: true,
    },
    channel: { type: String, enum: ['email'], default: 'email' },
    inApp: { type: Boolean, default: false },
    message: { type: String, required: true, trim: true, maxlength: 200 },
    recipientEmail: { type: String, required: true, trim: true, lowercase: true },
    status: { type: String, enum: ['sent', 'failed'], required: true },
    failureReason: { type: String, trim: true, maxlength: 200 },
  },
  { timestamps: true }
);

loanReminderSchema.index({ cooperative: 1, createdAt: -1 });
loanReminderSchema.index({ loan: 1, createdAt: -1 });

module.exports = mongoose.model('LoanReminder', loanReminderSchema);