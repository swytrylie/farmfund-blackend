const User = require('../models/User');
const Farm = require('../models/Farm');
const Field = require('../models/Field');
const FarmingCycle = require('../models/FarmingCycle');
const FinancialRecord = require('../models/FinancialRecord');
const Budget = require('../models/Budget');
const Loan = require('../models/Loan');
const LoanPayment = require('../models/LoanPayment');
const RecordAccess = require('../models/RecordAccess');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { recordAudit } = require('../utils/audit');

// Real people only: not admins, and not someone who signed up but never entered
// the email code (those accounts can't log in).
const REAL_USER = { role: { $ne: 'admin' }, isEmailVerified: { $ne: false } };
const LIVE_FARM = { isActive: { $ne: false } };
// A loan that was only asked for (pending) or turned down (rejected) isn't money lent.
const LENT = { status: { $in: ['approved', 'active', 'grace_period', 'paid_off', 'defaulted'] } };
const ACCESS_HOURS = 24;

const MANILA_MS = 8 * 60 * 60 * 1000; // Manila is UTC+8 all year
const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDayManila = (now = new Date()) => new Date(Math.floor((now.getTime() + MANILA_MS) / DAY_MS) * DAY_MS - MANILA_MS);
const startOfMonthManila = (now = new Date()) => {
  const m = new Date(now.getTime() + MANILA_MS);
  return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 1) - MANILA_MS);
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ');
const ids = (list) => list.map((x) => String(x));
const sumOf = (rows, key) => (rows.find((r) => r._id === key) || {}).total || 0;
const round2 = (n) => Math.round(n * 100) / 100;

// Farmers = real people who have a farm that is still registered.
async function farmerIds() {
  const real = await User.distinct('_id', REAL_USER);
  const owners = await Farm.distinct('owner', { ...LIVE_FARM, owner: { $in: real } });
  return ids(owners);
}

// ---------------------------------------------------------------------------
// GET /api/admin/financial/overview
// System-level totals only: no individual farmer's records.
// ---------------------------------------------------------------------------
async function getOverview(req, res) {
  const now = new Date();
  const today = startOfDayManila(now);
  const monthStart = startOfMonthManila(now);

  const farmers = await farmerIds();
  const farmerSet = new Set(farmers);

  // Which farmers have used each feature (a farmer = a person with a farm).
  const ownersOfFarms = async (farmList) => (farmList.length ? ids(await Farm.distinct('owner', { _id: { $in: farmList } })) : []);
  const [recordFarms, budgetFarms, cycleFields, borrowers] = await Promise.all([
    FinancialRecord.distinct('farm'),
    Budget.distinct('farm'),
    FarmingCycle.distinct('field'),
    Loan.distinct('farmer'),
  ]);
  const cycleFarms = cycleFields.length ? await Field.distinct('farm', { _id: { $in: cycleFields } }) : [];
  const [recordOwners, budgetOwners, cycleOwners] = await Promise.all([
    ownersOfFarms(recordFarms),
    ownersOfFarms(budgetFarms),
    ownersOfFarms(cycleFarms),
  ]);
  const users = (list) => new Set(list.filter((id) => farmerSet.has(String(id))).map(String)).size;
  const adoption = [
    { feature: 'Income & Expenses', activeUsers: users(recordOwners) },
    { feature: 'Budgets', activeUsers: users(budgetOwners) },
    { feature: 'Crops & Livestock (farming cycles)', activeUsers: users(cycleOwners) },
    { feature: 'Loans & Debt', activeUsers: users(borrowers) },
  ].map((f) => ({ ...f, ratePercent: farmers.length ? Math.round((f.activeUsers / farmers.length) * 100) : null }));

  const [transactionsToday, monthRows, loanRows] = await Promise.all([
    FinancialRecord.countDocuments({ createdAt: { $gte: today } }),
    FinancialRecord.aggregate([
      { $match: { date: { $gte: monthStart } } },
      { $group: { _id: '$type', total: { $sum: '$amount' } } },
    ]),
    Loan.aggregate([{ $match: LENT }, { $group: { _id: null, total: { $sum: '$principalAmount' } } }]),
  ]);

  new ApiResponse(200, {
    metrics: {
      transactionsToday,
      incomeThisMonth: round2(sumOf(monthRows, 'income')),
      expensesThisMonth: round2(sumOf(monthRows, 'expense')),
      totalLoanVolume: round2((loanRows[0] && loanRows[0].total) || 0),
    },
    featureAdoption: adoption,
    totalFarmers: farmers.length,
  }, 'Overview fetched').send(res);
}

// ---------------------------------------------------------------------------
// GET /api/admin/financial/farmers?search=&page=&limit=
// The farmers an admin may ask to look at, with this admin's current access.
// ---------------------------------------------------------------------------
async function listFarmers(req, res) {
  const { search = '' } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const now = new Date();

  const real = await User.distinct('_id', REAL_USER);
  const and = [LIVE_FARM, { owner: { $in: real } }];
  const terms = search.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  for (const term of terms) {
    const rx = new RegExp(escapeRegex(term), 'i');
    const hits = await User.distinct('_id', { ...REAL_USER, $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] });
    and.push({ $or: [{ name: rx }, { owner: { $in: hits } }] });
  }
  const filter = { $and: and };

  const total = await Farm.countDocuments(filter);
  const farms = await Farm.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean();

  const ownerIds = ids(farms.map((f) => f.owner));
  const [owners, loans, grants] = ownerIds.length
    ? await Promise.all([
        User.find({ _id: { $in: ownerIds } }).select('firstName lastName email').lean(),
        Loan.find({ farmer: { $in: ownerIds }, ...LENT }).populate('cooperative', 'name').lean(),
        RecordAccess.find({ admin: req.user._id, farmer: { $in: ownerIds }, expiresAt: { $gt: now } }).sort({ expiresAt: -1 }).lean(),
      ])
    : [[], [], []];
  const ownerById = new Map(owners.map((u) => [String(u._id), u]));
  const coops = new Map();
  for (const l of loans) {
    const name = l.cooperative && l.cooperative.name;
    if (!name) continue;
    const key = String(l.farmer);
    if (!coops.has(key)) coops.set(key, []);
    if (!coops.get(key).includes(name)) coops.get(key).push(name);
  }
  const grantByFarmer = new Map();
  for (const g of grants) if (!grantByFarmer.has(String(g.farmer))) grantByFarmer.set(String(g.farmer), g);

  const rows = farms.map((f) => {
    const owner = ownerById.get(String(f.owner));
    const grant = grantByFarmer.get(String(f.owner));
    return {
      id: String(f.owner),
      farmer: owner ? fullName(owner) : 'Unknown',
      email: owner ? owner.email : null,
      farm: f.name,
      cooperatives: coops.get(String(f.owner)) || [],
      access: grant ? { status: 'authorized', caseRef: grant.caseRef || null, expiresAt: grant.expiresAt } : { status: 'none', caseRef: null, expiresAt: null },
    };
  });

  new ApiResponse(200, { farmers: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) }, 'Farmers fetched').send(res);
}

async function loadFarmer(id) {
  const farmer = await User.findOne({ _id: id, ...REAL_USER }).select('firstName lastName email').lean();
  if (!farmer) throw ApiError.notFound('Farmer not found');
  return farmer;
}

// ---------------------------------------------------------------------------
// POST /api/admin/financial/farmers/:id/access   { reason, caseRef?, notes? }
// Instant, time-limited, and recorded: the reason is required, the grant is
// stored, and it is written to the Audit Logs.
// ---------------------------------------------------------------------------
async function grantAccess(req, res) {
  const farmer = await loadFarmer(req.params.id);
  const farm = await Farm.findOne({ owner: farmer._id, ...LIVE_FARM }).select('_id').lean();
  if (!farm) throw ApiError.notFound('This person has no registered farm');

  const now = new Date();
  const existing = await RecordAccess.findOne({ admin: req.user._id, farmer: farmer._id, expiresAt: { $gt: now } }).lean();
  if (existing) throw ApiError.conflict('You already have access to this farmer\'s records');

  const { reason, caseRef, notes } = req.body;
  const expiresAt = new Date(now.getTime() + ACCESS_HOURS * 60 * 60 * 1000);
  await RecordAccess.create({
    admin: req.user._id,
    farmer: farmer._id,
    reason,
    ...(caseRef ? { caseRef } : {}),
    ...(notes ? { notes } : {}),
    expiresAt,
  });

  await recordAudit(req.user, 'financial.access_granted', {
    targetType: 'user',
    targetId: farmer._id,
    targetLabel: `${fullName(farmer)} <${farmer.email}>`,
    details: { reason, caseRef: caseRef || null, expiresAt },
  });

  new ApiResponse(201, { caseRef: caseRef || null, expiresAt }, 'Access granted').send(res);
}

// ---------------------------------------------------------------------------
// GET /api/admin/financial/farmers/:id/records
// Only while this admin holds an unexpired grant. Every view is audited.
// ---------------------------------------------------------------------------
async function getFarmerRecords(req, res) {
  const farmer = await loadFarmer(req.params.id);
  const now = new Date();
  const grant = await RecordAccess.findOne({ admin: req.user._id, farmer: farmer._id, expiresAt: { $gt: now } })
    .sort({ expiresAt: -1 })
    .lean();
  if (!grant) throw ApiError.forbidden("Request access to this farmer's records first (your access may have expired)");

  const farm = await Farm.findOne({ owner: farmer._id, ...LIVE_FARM }).lean();
  let totals = [];
  let recordCount = 0;
  let records = [];
  if (farm) {
    [totals, recordCount, records] = await Promise.all([
      FinancialRecord.aggregate([
        { $match: { farm: farm._id } },
        { $group: { _id: '$type', total: { $sum: '$amount' } } },
      ]),
      FinancialRecord.countDocuments({ farm: farm._id }),
      FinancialRecord.find({ farm: farm._id }).sort({ date: -1, _id: -1 }).limit(15).populate('category', 'name').lean(),
    ]);
  }
  const income = sumOf(totals, 'income');
  const expense = sumOf(totals, 'expense');

  const loans = await Loan.find({ farmer: farmer._id }).sort({ createdAt: -1 }).populate('cooperative', 'name').lean();
  const paidRows = loans.length
    ? await LoanPayment.aggregate([
        { $match: { loan: { $in: loans.map((l) => l._id) } } },
        { $group: { _id: '$loan', total: { $sum: '$amount' } } },
      ])
    : [];
  const paidBy = new Map(paidRows.map((r) => [String(r._id), r.total]));

  await recordAudit(req.user, 'financial.view_records', {
    targetType: 'user',
    targetId: farmer._id,
    targetLabel: `${fullName(farmer)} <${farmer.email}>`,
    details: { caseRef: grant.caseRef || null },
  });

  new ApiResponse(200, {
    farmer: { id: String(farmer._id), name: fullName(farmer), email: farmer.email },
    farm: farm ? { name: farm.name, location: (farm.location && farm.location.address) || null } : null,
    access: { caseRef: grant.caseRef || null, expiresAt: grant.expiresAt },
    summary: { income: round2(income), expense: round2(expense), net: round2(income - expense), recordCount },
    records: records.map((r) => ({
      id: String(r._id),
      date: r.date,
      type: r.type,
      category: (r.category && r.category.name) || '—',
      amount: r.amount,
      description: r.description || null,
    })),
    loans: loans.map((l) => ({
      id: String(l._id),
      cooperative: (l.cooperative && l.cooperative.name) || '—',
      principal: l.principalAmount,
      paid: round2(paidBy.get(String(l._id)) || 0),
      status: l.status,
      dueDate: l.dueDate || null,
    })),
  }, 'Records fetched').send(res);
}

module.exports = { getOverview, listFarmers, grantAccess, getFarmerRecords, startOfDayManila, startOfMonthManila };