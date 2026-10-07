const DismissedAlert = require('../models/DismissedAlert');
const ApiResponse = require('../utils/ApiResponse');

// GET /api/dismissed-alerts
// Returns just the current user's own dismissed alert keys, as a plain
// array of strings — never another user's, since the filter is always
// req.user._id, never a client-supplied id.
async function listDismissedAlerts(req, res) {
  const dismissed = await DismissedAlert.find({ user: req.user._id }).select('alertKey').lean();
  new ApiResponse(200, dismissed.map((d) => d.alertKey), 'Dismissed alerts retrieved successfully').send(res);
}

// POST /api/dismissed-alerts
// Idempotent: dismissing an already-dismissed alert succeeds quietly
// rather than erroring on the unique index conflict.
async function dismissAlert(req, res) {
  const { alertKey } = req.body;

  await DismissedAlert.updateOne(
    { user: req.user._id, alertKey },
    { $setOnInsert: { user: req.user._id, alertKey } },
    { upsert: true }
  );

  new ApiResponse(200, { alertKey }, 'Alert dismissed successfully').send(res);
}

module.exports = { listDismissedAlerts, dismissAlert };