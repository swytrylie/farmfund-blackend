const User = require('../models/User');
const LoginEvent = require('../models/LoginEvent');
const ApiResponse = require('../utils/ApiResponse');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ');

// What a row says and how its badge reads, per outcome.
const OUTCOME = {
  success: { action: 'Logged in', status: 'success' },
  wrong_password: { action: 'Login failed: wrong password', status: 'failed' },
  unknown_email: { action: 'Login failed: no account with this email', status: 'failed' },
  locked: { action: 'Login blocked: account temporarily locked', status: 'locked' },
  suspended: { action: 'Login blocked: account suspended', status: 'suspended' },
  unverified: { action: 'Login blocked: email not verified', status: 'unverified' },
  org_not_approved: { action: "Login blocked: organization isn't approved", status: 'not_approved' },
};
const FALLBACK = { action: 'Login failed', status: 'failed' };

function toRow(e, user) {
  const o = e.success ? OUTCOME.success : OUTCOME[e.reason] || FALLBACK;
  const name = fullName(user);
  return {
    id: String(e._id),
    user: name || e.email || 'Unknown',
    email: (user && user.email) || e.email || null,
    knownUser: Boolean(user),
    action: o.action,
    status: o.status,
    device: e.device || 'Unknown device',
    ip: e.ip || '—',
    at: e.createdAt,
  };
}

// GET /api/admin/activity?search=&filter=all|logins|failed&page=&limit=
// The login log, newest first. "logins" = the ones that worked; "failed" =
// every attempt that did not get in (wrong password, locked, suspended, ...).
// Search looks at the person's name, the email that was typed, and the IP.
async function listActivity(req, res) {
  const { search = '', filter = 'all' } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const and = [];
  if (filter === 'logins') and.push({ success: true });
  if (filter === 'failed') and.push({ success: false });

  const terms = search.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  for (const term of terms) {
    const rx = new RegExp(escapeRegex(term), 'i');
    const people = await User.distinct('_id', { $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] });
    and.push({ $or: [{ email: rx }, { ip: rx }, { device: rx }, { user: { $in: people } }] });
  }
  const where = and.length ? { $and: and } : {};

  const total = await LoginEvent.countDocuments(where);
  const events = await LoginEvent.find(where)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  const userIds = [...new Set(events.filter((e) => e.user).map((e) => String(e.user)))];
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select('firstName lastName email').lean() : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));

  new ApiResponse(200, {
    activity: events.map((e) => toRow(e, e.user ? byId.get(String(e.user)) : null)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  }, 'Activity fetched').send(res);
}

module.exports = { listActivity };