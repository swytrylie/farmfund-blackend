const AuditLog = require('../models/AuditLog');
const ApiResponse = require('../utils/ApiResponse');

// What each recorded action is called on the page. Anything not listed here
// (an action added later) is shown as-is rather than hidden.
const ACTION_TEXT = {
  'user.suspend': 'Suspended account',
  'user.reactivate': 'Restored account',
  'user.update': 'Updated account details',
  'user.password_reset_request': 'Sent password reset email',
  'user.delete': 'Deleted account',
  'cooperative.approve': 'Approved cooperative',
  'cooperative.reject': 'Declined cooperative',
};

const FIELD_TEXT = { firstName: 'first name', lastName: 'last name', email: 'email' };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const categoryOf = (action) =>
  typeof action === 'string' && action.startsWith('cooperative.') ? 'cooperatives' : 'accounts';

// One short sentence of extra context for a row, or null.
function detailText(action, details) {
  const d = details && typeof details === 'object' ? details : {};
  const parts = [];

  if (action === 'user.suspend' && d.reason) parts.push(`Reason: ${d.reason}`);

  if (action === 'user.update' && d.before && d.after) {
    const changes = Object.keys(d.after)
      .filter((k) => FIELD_TEXT[k])
      .map((k) => `${FIELD_TEXT[k]}: ${d.before[k] === undefined ? '—' : d.before[k]} → ${d.after[k]}`);
    if (changes.length) parts.push(`Changed ${changes.join('; ')}`);
  }

  if (action === 'cooperative.approve' || action === 'cooperative.reject') {
    if (d.ownerEmailSent === false) parts.push("Email to the owner couldn't be sent");
  } else if (d.emailSent === false) {
    parts.push("Email to the person couldn't be sent");
  }

  return parts.length ? parts.join('. ') : null;
}

function toRow(log) {
  return {
    id: String(log._id),
    actor: log.actorName || 'Unknown admin',
    action: log.action,
    actionText: ACTION_TEXT[log.action] || log.action,
    target: log.targetLabel || '—',
    targetType: log.targetType || null,
    category: categoryOf(log.action),
    detail: detailText(log.action, log.details),
    at: log.createdAt,
  };
}

// GET /api/admin/audit-logs?search=&category=all|accounts|cooperatives&page=&limit=
// Newest first. Search looks at who did it, what it was done to, and the
// action name as the page shows it ("suspend" finds "Suspended account").
async function listAuditLogs(req, res) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const search = (req.query.search || '').trim();
  const category = req.query.category || 'all';

  const and = [];
  if (category === 'accounts') and.push({ action: { $not: /^cooperative\./ } });
  if (category === 'cooperatives') and.push({ action: /^cooperative\./ });

  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    const needle = search.toLowerCase();
    const actions = Object.keys(ACTION_TEXT).filter((k) => ACTION_TEXT[k].toLowerCase().includes(needle));
    const or = [{ actorName: rx }, { targetLabel: rx }, { action: rx }];
    if (actions.length) or.push({ action: { $in: actions } });
    and.push({ $or: or });
  }

  const filter = and.length ? { $and: and } : {};

  const total = await AuditLog.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / limit));
  const logs = await AuditLog.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  new ApiResponse(200, { logs: logs.map(toRow), total, page, pages }, 'Audit logs fetched').send(res);
}

module.exports = { listAuditLogs, ACTION_TEXT, detailText };