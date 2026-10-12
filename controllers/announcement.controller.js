const Announcement = require('../models/Announcement');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');

// What a person sees of an announcement: never who else received it, never the
// email delivery numbers, and never the admin's name (it is from "FarmFund").
function toRow(a, userId) {
  const me = String(userId);
  return {
    id: String(a._id),
    title: a.title,
    message: a.message,
    at: a.createdAt,
    unread: !(a.readBy || []).some((id) => String(id) === me),
  };
}

// GET /api/announcements?page=&limit=
// The announcements addressed to the signed-in person (decided when it was
// sent), newest first. Also says how many are still unread.
async function listMine(req, res) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const mine = { recipientIds: req.user._id };

  const [total, unreadCount, rows] = await Promise.all([
    Announcement.countDocuments(mine),
    Announcement.countDocuments({ ...mine, readBy: { $ne: req.user._id } }),
    Announcement.find(mine)
      .select('title message createdAt readBy')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  new ApiResponse(200, {
    announcements: rows.map((a) => toRow(a, req.user._id)),
    total,
    unreadCount,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  }, 'Announcements fetched').send(res);
}

// POST /api/announcements/:id/read
// Marks one of MY announcements as read. Someone else's announcement looks
// exactly like one that doesn't exist.
async function markRead(req, res) {
  const updated = await Announcement.findOneAndUpdate(
    { _id: req.params.id, recipientIds: req.user._id },
    { $addToSet: { readBy: req.user._id } },
    { new: true }
  );
  if (!updated) throw ApiError.notFound('Announcement not found');
  new ApiResponse(200, { id: String(updated._id), unread: false }, 'Marked as read').send(res);
}

// POST /api/announcements/read-all
async function markAllRead(req, res) {
  await Announcement.updateMany(
    { recipientIds: req.user._id, readBy: { $ne: req.user._id } },
    { $addToSet: { readBy: req.user._id } }
  );
  new ApiResponse(200, { unreadCount: 0 }, 'All marked as read').send(res);
}

module.exports = { listMine, markRead, markAllRead };