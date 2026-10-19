const CoopCreditLimit = require('../models/CoopCreditLimit');
const CooperativeMember = require('../models/CooperativeMember');
const Cooperative = require('../models/Cooperative');
const Loan = require('../models/Loan');
const Notification = require('../models/Notification');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { creditFor, outstandingWith, VERIFIED_LIMIT } = require('../utils/creditLimit');
const { recordAudit } = require('../utils/audit');

const STAFF_ROLES = ['owner', 'finance_manager'];
const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ') || 'A farmer';
const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });

// The caller's active place in that cooperative ('owner' | 'finance_manager') or null.
async function staffRole(cooperativeId, user) {
  const m = await CooperativeMember.findOne({ cooperative: cooperativeId, user: user._id, role: { $in: STAFF_ROLES }, status: 'active' }).select('role').lean();
  return m ? m.role : null;
}

// Both the cooperative's staff and the farmer must really be connected: staff of an
// active cooperative, and a farmer who has (or had) a loan with it. Anything else is
// answered like "not found" so ids can't be probed.
async function loadContext(cooperativeId, farmerId, user) {
  const role = await staffRole(cooperativeId, user);
  if (!role) throw ApiError.forbidden('Only the cooperative owner or finance manager can see a credit limit');
  const coop = await Cooperative.findById(cooperativeId).select('name status').lean();
  if (!coop || coop.status !== 'active') throw ApiError.notFound('Cooperative not found');
  const hasLoan = await Loan.exists({ farmer: farmerId, cooperative: cooperativeId });
  const farmer = hasLoan ? await User.findById(farmerId).select('firstName lastName email').lean() : null;
  if (!farmer) throw ApiError.notFound('This farmer has no loans with your cooperative');
  return { role, coop, farmer };
}

async function view({ coop, farmer, role }) {
  const stored = await CoopCreditLimit.findOne({ cooperative: coop._id, farmer: farmer._id }).lean();
  const credit = await creditFor(farmer._id, coop._id);
  const outstanding = await outstandingWith(farmer._id, coop._id);
  return {
    farmer: { id: String(farmer._id), name: fullName(farmer), email: farmer.email || null },
    cooperative: { id: String(coop._id), name: coop.name },
    standardLimit: VERIFIED_LIMIT,
    maxLimit: CoopCreditLimit.MAX_LIMIT,
    currentLimit: stored ? stored.limit : VERIFIED_LIMIT, // the number in force for this cooperative
    custom: Boolean(stored),
    effectiveLimit: credit.limit, // 0 while the Barangay Certificate is not verified
    barangayStatus: credit.barangayStatus,
    outstanding, // what the farmer still owes THIS cooperative
    available: credit.available,
    note: stored && stored.note ? stored.note : null,
    setByName: stored && stored.setByName ? stored.setByName : null,
    setAt: stored ? stored.updatedAt || stored.createdAt || null : null,
    canEdit: role === 'owner',
  };
}

// GET /api/credit-limits?cooperative=<id>&farmer=<id>
async function get(req, res) {
  const ctx = await loadContext(req.query.cooperative, req.query.farmer, req.user);
  new ApiResponse(200, { creditLimit: await view(ctx) }, 'Credit limit fetched').send(res);
}

// PUT /api/credit-limits  { cooperative, farmer, limit, note }
// Only that cooperative's OWNER. The number replaces the standard PHP 25,000 for
// this farmer's loans with this cooperative only, up to PHP 100,000, and never
// below what the farmer still owes it.
async function save(req, res) {
  const { cooperative, farmer: farmerId, limit, note } = req.body;
  const ctx = await loadContext(cooperative, farmerId, req.user);
  if (ctx.role !== 'owner') throw ApiError.forbidden('Only the cooperative owner can change a farmer\'s credit limit');

  const existing = await CoopCreditLimit.findOne({ cooperative, farmer: farmerId }).lean();
  const before = existing ? existing.limit : VERIFIED_LIMIT;
  if (Math.round(limit * 100) === Math.round(before * 100)) {
    throw ApiError.badRequest(`The credit limit is already ${peso(before)}. Enter a different amount.`);
  }

  const owed = await outstandingWith(farmerId, cooperative);
  if (limit + 0.001 < owed) {
    throw ApiError.badRequest(`${fullName(ctx.farmer)} still owes ${peso(owed)} to your cooperative. The limit can't be lower than that.`);
  }

  await CoopCreditLimit.findOneAndUpdate(
    { cooperative, farmer: farmerId },
    { $set: { limit, previousLimit: before, note, setBy: req.user._id, setByName: fullName(req.user) } },
    { upsert: true, new: true, runValidators: true }
  );

  // Two things that must not undo the save if they fail: the farmer's notice and the audit row.
  try {
    await Notification.create({
      user: farmerId,
      kind: 'loan_update',
      title: 'Credit limit updated',
      message: `${ctx.coop.name} ${limit > before ? 'raised' : 'changed'} your credit limit to ${peso(limit)}.`.slice(0, 200),
      details: { coopName: String(ctx.coop.name).slice(0, 200), typeLabel: 'Credit limit', amount: limit, reason: note },
      cooperative: ctx.coop._id,
    });
  } catch (err) {
    console.error('Could not tell the farmer about their new credit limit:', err && err.message);
  }
  await recordAudit(req.user, 'creditlimit.set', {
    targetType: 'user',
    targetId: farmerId,
    targetLabel: `${fullName(ctx.farmer)} — ${ctx.coop.name}`,
    details: { cooperative: ctx.coop.name, previousLimit: before, limit, note },
  });

  new ApiResponse(200, { creditLimit: await view(ctx) }, 'Credit limit saved').send(res);
}

module.exports = { get, save };