const User = require('../models/User');
const Cooperative = require('../models/Cooperative');
const CooperativeMember = require('../models/CooperativeMember');
const Loan = require('../models/Loan');
const LoginEvent = require('../models/LoginEvent');
const ApiResponse = require('../utils/ApiResponse');
const { lastMonths, bucketGrowth, REAL_USER } = require('./admin.controller');

const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA_MS = 8 * 60 * 60 * 1000; // Manila is UTC+8 all year
// A loan that was only asked for (pending) or turned down (rejected) isn't money lent.
const LENT = { status: { $in: ['approved', 'active', 'paid_off', 'defaulted'] } };

const round2 = (n) => Math.round(n * 100) / 100;
const startOfMonthManila = (now) => {
  const m = new Date(now.getTime() + MANILA_MS);
  return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 1) - MANILA_MS);
};

// Active and pending cooperatives whose owner confirmed their email. A sign-up
// that never entered the email code leaves a pending cooperative behind, and it
// must not be counted.
async function loadCooperatives() {
  const coops = await Cooperative.find({ status: { $in: ['active', 'pending'] } })
    .select('name status createdAt')
    .sort({ name: 1 })
    .lean();
  if (coops.length === 0) return [];
  const owners = await CooperativeMember.find({
    cooperative: { $in: coops.map((c) => c._id) },
    role: 'owner',
    status: 'active',
  })
    .populate('user', 'isEmailVerified')
    .lean();
  const verified = new Set(
    owners.filter((o) => o.user && o.user.isEmailVerified !== false).map((o) => String(o.cooperative))
  );
  return coops.filter((c) => verified.has(String(c._id)));
}

// GET /api/admin/reports  — ADMIN ONLY (route-level authorize)
// Everything on the Reports & Analytics page, in one call. System-level
// numbers only; nothing about any individual farmer's records.
async function getReports(req, res) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const monthStart = startOfMonthManila(now);
  const firstMonth = lastMonths(now, 6)[0];
  const growthFrom = new Date(Date.UTC(firstMonth.year, firstMonth.month, 1) - MANILA_MS);

  const [totalAccounts, newThisMonth, suspendedAccounts, loginsLast7Days, failedLast7Days, growthRows, coops] =
    await Promise.all([
      User.countDocuments(REAL_USER),
      User.countDocuments({ ...REAL_USER, createdAt: { $gte: monthStart } }),
      User.countDocuments({ ...REAL_USER, isActive: false }),
      LoginEvent.countDocuments({ success: true, createdAt: { $gte: weekAgo } }),
      LoginEvent.countDocuments({ success: false, createdAt: { $gte: weekAgo } }),
      User.find({ ...REAL_USER, createdAt: { $gte: growthFrom } }).select('createdAt').lean(),
      loadCooperatives(),
    ]);

  const coopIds = coops.map((c) => c._id);
  const [memberRows, loanRows] = coopIds.length
    ? await Promise.all([
        CooperativeMember.aggregate([
          { $match: { cooperative: { $in: coopIds }, status: 'active' } },
          { $group: { _id: '$cooperative', members: { $sum: 1 } } },
        ]),
        Loan.aggregate([
          { $match: { ...LENT, cooperative: { $in: coopIds } } },
          { $group: { _id: '$cooperative', farmers: { $addToSet: '$farmer' }, volume: { $sum: '$principalAmount' } } },
        ]),
      ])
    : [[], []];

  const membersBy = new Map(memberRows.map((r) => [String(r._id), r.members]));
  const loansBy = new Map(loanRows.map((r) => [String(r._id), r]));
  const allFarmers = new Set();

  const cooperatives = coops.map((c) => {
    const l = loansBy.get(String(c._id));
    const farmerList = l ? l.farmers.map(String) : [];
    farmerList.forEach((f) => allFarmers.add(f));
    return {
      id: String(c._id),
      name: c.name,
      status: c.status,
      members: membersBy.get(String(c._id)) || 0,
      farmers: farmerList.length,
      loanVolume: l ? round2(l.volume) : 0,
    };
  });

  new ApiResponse(200, {
    accountGrowth: bucketGrowth(growthRows.map((r) => r.createdAt), now, 6),
    platformActivity: {
      totalAccounts,
      newThisMonth,
      loginsLast7Days,
      failedLast7Days,
      suspendedAccounts,
      pendingCooperatives: cooperatives.filter((c) => c.status === 'pending').length,
    },
    cooperatives,
    totals: {
      cooperatives: cooperatives.length,
      members: cooperatives.reduce((s, c) => s + c.members, 0),
      // A farmer who borrowed from two cooperatives is counted once here.
      farmers: allFarmers.size,
      loanVolume: round2(cooperatives.reduce((s, c) => s + c.loanVolume, 0)),
    },
    generatedAt: now,
  }).send(res);
}

module.exports = { getReports };