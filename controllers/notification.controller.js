const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');

// What the person sees. Never who at the cooperative sent it.
function toRow(n) {
  const d = n.details || {};
  return {
    id: String(n._id),
    kind: n.kind,
    title: n.title,
    message: n.message,
    at: n.createdAt,
    unread: !n.readAt,
    details: {
      coopName: d.coopName || null,
      typeLabel: d.typeLabel || null,
      loanRef: d.loanRef || null,
      remaining: typeof d.remaining === 'number' ? d.remaining : null,
      dueDate: d.dueDate || null,
      dueNote: d.dueNote || null,
      contactEmail: d.contactEmail || null,
      contactPhone: d.contactPhone || null,
    },
  };
}

// GET /api/notifications?page=&limit=
// The signed-in person's own notifications, newest first, and how many are unread.
async function listMine(req, res) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const mine = { user: req.user._id };

  const [total, unreadCount, rows] = await Promise.all([
    Notification.countDocuments(mine),
    Notification.countDocuments({ ...mine, readAt: { $exists: false } }),
    Notification.find(mine)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  new ApiResponse(200, {
    notifications: rows.map(toRow),
    total,
    unreadCount,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  }, 'Notifications fetched').send(res);
}

// POST /api/notifications/:id/read — someone else's notification looks exactly
// like one that does not exist.
async function markRead(req, res) {
  const existing = await Notification.findOne({ _id: req.params.id, user: req.user._id });
  if (!existing) throw ApiError.notFound('Notification not found');
  if (!existing.readAt) {
    await Notification.findOneAndUpdate({ _id: existing._id, user: req.user._id, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
  }
  new ApiResponse(200, { id: String(existing._id), unread: false }, 'Marked as read').send(res);
}

// POST /api/notifications/read-all
async function markAllRead(req, res) {
  await Notification.updateMany({ user: req.user._id, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
  new ApiResponse(200, { unreadCount: 0 }, 'All marked as read').send(res);
}

module.exports = { listMine, markRead, markAllRead };