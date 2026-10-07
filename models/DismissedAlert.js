const mongoose = require('mongoose');

/**
 * DismissedAlert
 * --------------
 * Alerts themselves are never stored — they're computed live, every time,
 * from real Budget and Loan data (e.g. "this category is over budget",
 * "this loan is due soon"). This collection only remembers WHICH of those
 * computed alerts a user has chosen to dismiss, keyed by a stable,
 * deterministic string built from the underlying record
 * (e.g. "budget:<budgetId>:<categoryId>", "loan:<loanId>:due").
 *
 * If the underlying condition resolves (the budget category drops back
 * under its limit, the loan gets paid off) and later re-triggers, it does
 * so with the SAME key — intentional: once truly resolved it simply stops
 * being computed at all, so re-appearing means the same real issue is
 * happening again, and should show up again rather than staying hidden
 * forever from a long-past dismissal.
 */
const dismissedAlertSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    alertKey: { type: String, required: true, trim: true, maxlength: 200 },
  },
  { timestamps: true }
);

// One dismissal per user per alert — dismissing an already-dismissed
// alert should succeed quietly, not create duplicates.
dismissedAlertSchema.index({ user: 1, alertKey: 1 }, { unique: true });

module.exports = mongoose.model('DismissedAlert', dismissedAlertSchema);