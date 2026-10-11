const User = require('../models/User');
const Cooperative = require('../models/Cooperative');
const CooperativeMember = require('../models/CooperativeMember');
const ApiResponse = require('../utils/ApiResponse');

// "Today", "this month" etc. are worked out in Philippine time (UTC+8, no
// daylight saving) no matter where the server runs — Vercel's servers are in UTC,
// which would otherwise cut the day at 8 AM Manila time.
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Real people only: not admins, and not someone who signed up but never
// entered the email code (those accounts exist in the database but can't log in).
const REAL_USER = { role: { $ne: 'admin' }, isEmailVerified: { $ne: false } };

function startOfTodayManila(now) {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - TZ_OFFSET_MS);
}

// The last `count` calendar months (Manila time), oldest first.
function lastMonths(now, count = 6) {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MS);
  let year = shifted.getUTCFullYear();
  let month = shifted.getUTCMonth();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.unshift({ year, month, label: MONTH_NAMES[month], value: 0 });
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
  }
  return out;
}

function monthStartUtc(year, month) {
  return new Date(Date.UTC(year, month, 1) - TZ_OFFSET_MS);
}

// How many new accounts were created in each of the last months.
function bucketGrowth(createdDates, now, count = 6) {
  const months = lastMonths(now, count);
  for (const d of createdDates) {
    const shifted = new Date(new Date(d).getTime() + TZ_OFFSET_MS);
    const slot = months.find((m) => m.year === shifted.getUTCFullYear() && m.month === shifted.getUTCMonth());
    if (slot) slot.value += 1;
  }
  return months.map(({ label, value }) => ({ month: label, value }));
}

function fullName(u) {
  return [u && u.firstName, u && u.lastName].filter(Boolean).join(' ') || 'Unknown';
}

// Cooperatives (newest first) paired with their owner, leaving out any whose
// owner never verified their email — an unverified sign-up leaves a pending
// cooperative behind, and it shouldn't show up in front of the admin.
async function loadCooperativesWithOwners(filter, limit) {
  let query = Cooperative.find(filter).sort({ createdAt: -1 });
  if (limit) query = query.limit(limit);
  const coops = await query.lean();
  if (coops.length === 0) return [];
  const owners = await CooperativeMember.find({
    cooperative: { $in: coops.map((c) => c._id) },
    role: 'owner',
    status: 'active',
  })
    .populate('user', 'firstName lastName email isEmailVerified')
    .lean();
  const ownerByCoop = new Map();
  for (const o of owners) if (o.user) ownerByCoop.set(String(o.cooperative), o.user);
  return coops
    .map((coop) => ({ coop, owner: ownerByCoop.get(String(coop._id)) || null }))
    .filter(({ owner }) => owner && owner.isEmailVerified !== false);
}

// GET /api/admin/dashboard  — ADMIN ONLY (route-level authorize)
async function getDashboard(req, res) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const todayStart = startOfTodayManila(now);
  const firstMonth = lastMonths(now, 6)[0];
  const growthFrom = monthStartUtc(firstMonth.year, firstMonth.month);

  const [
    totalUsers,
    newThisWeek,
    activeToday,
    suspendedAccounts,
    activeCooperatives,
    growthRows,
    recentUsers,
    pendingPairs,
    recentCoopPairs,
  ] = await Promise.all([
    User.countDocuments(REAL_USER),
    User.countDocuments({ ...REAL_USER, createdAt: { $gte: weekAgo } }),
    User.countDocuments({ ...REAL_USER, lastLoginAt: { $gte: todayStart } }),
    User.countDocuments({ ...REAL_USER, isActive: false }),
    Cooperative.countDocuments({ status: 'active' }),
    User.find({ ...REAL_USER, createdAt: { $gte: growthFrom } }).select('createdAt').lean(),
    User.find(REAL_USER).sort({ createdAt: -1 }).limit(8).select('firstName lastName createdAt').lean(),
    loadCooperativesWithOwners({ status: 'pending' }),
    loadCooperativesWithOwners({}, 20),
  ]);

  const recentActivity = [
    ...recentUsers.map((u) => ({
      id: `user-${u._id}`,
      type: 'account',
      text: `New account created: ${fullName(u)}`,
      at: u.createdAt,
    })),
    ...recentCoopPairs.map(({ coop }) => ({
      id: `coop-${coop._id}`,
      type: 'cooperative',
      text: `New cooperative registered: ${coop.name}`,
      at: coop.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 8);

  const pendingApprovals = pendingPairs
    .slice()
    .reverse() // oldest application first — they've waited longest
    .slice(0, 20)
    .map(({ coop, owner }) => ({
      id: String(coop._id),
      name: fullName(owner),
      email: owner.email,
      role: 'Cooperative Owner',
      org: coop.name,
      submittedAt: coop.createdAt,
    }));

  new ApiResponse(200, {
    kpis: {
      totalUsers,
      newThisWeek,
      activeCooperatives,
      pendingCooperatives: pendingPairs.length,
      activeToday,
      suspendedAccounts,
    },
    accountGrowth: bucketGrowth(growthRows.map((r) => r.createdAt), now, 6),
    recentActivity,
    pendingApprovals,
  }).send(res);
}

module.exports = { getDashboard, startOfTodayManila, lastMonths, bucketGrowth, REAL_USER };