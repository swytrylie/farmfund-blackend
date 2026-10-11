const User = require('../models/User');
const Farm = require('../models/Farm');
const Loan = require('../models/Loan');
const ApiResponse = require('../utils/ApiResponse');

// Real people only: not admins, and not someone who signed up but never entered
// the email code (those accounts can't log in).
const REAL_USER = { role: { $ne: 'admin' }, isEmailVerified: { $ne: false } };

// A farm is "linked to a cooperative" when its owner has borrowed from one.
// Loans that were only asked for (pending) or turned down (rejected) don't count.
const LINKING_LOANS = { status: { $in: ['approved', 'active', 'paid_off', 'defaulted'] } };

// A farm the owner removed (soft delete) has isActive:false and is not listed.
const LIVE_FARM = { isActive: { $ne: false } };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ');
const ids = (list) => list.map((x) => String(x));

// GET /api/admin/farms?search=&link=all|linked|unlinked&page=&limit=
// Farms of real accounts, newest first. "Linked" means the farm's owner has a
// loan with a cooperative (see LINKING_LOANS).
async function listFarms(req, res) {
  const { search = '', link = 'all' } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const [realOwnerIds, borrowerIds] = await Promise.all([
    User.distinct('_id', REAL_USER),
    Loan.distinct('farmer', LINKING_LOANS),
  ]);
  const real = ids(realOwnerIds);
  const borrowers = new Set(ids(borrowerIds));
  const linkedOwners = real.filter((id) => borrowers.has(id));
  const unlinkedOwners = real.filter((id) => !borrowers.has(id));

  // ---- the four cards (not affected by search or filter) ----
  const baseFarm = { ...LIVE_FARM, owner: { $in: real } };
  const [registered, linked, sizeRows] = await Promise.all([
    Farm.countDocuments(baseFarm),
    Farm.countDocuments({ ...LIVE_FARM, owner: { $in: linkedOwners } }),
    Farm.aggregate([
      { $match: { ...baseFarm, totalAreaHectares: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$totalAreaHectares' } } },
    ]),
  ]);
  const avgSize = sizeRows && sizeRows[0] && typeof sizeRows[0].avg === 'number' ? Math.round(sizeRows[0].avg * 100) / 100 : null;

  // ---- the list ----
  const allowed = link === 'linked' ? linkedOwners : link === 'unlinked' ? unlinkedOwners : real;
  const and = [LIVE_FARM, { owner: { $in: allowed } }];

  const terms = search.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  for (const term of terms) {
    const rx = new RegExp(escapeRegex(term), 'i');
    const ownerHits = await User.distinct('_id', { ...REAL_USER, $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] });
    and.push({ $or: [{ name: rx }, { 'location.address': rx }, { owner: { $in: ownerHits } }] });
  }
  const filter = { $and: and };

  const total = await Farm.countDocuments(filter);
  const farms = await Farm.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  const ownerIds = [...new Set(ids(farms.map((f) => f.owner)))];
  const [owners, loans] = ownerIds.length
    ? await Promise.all([
        User.find({ _id: { $in: ownerIds } }).select('firstName lastName email isActive').lean(),
        Loan.find({ farmer: { $in: ownerIds }, ...LINKING_LOANS }).populate('cooperative', 'name').lean(),
      ])
    : [[], []];
  const ownerById = new Map(owners.map((u) => [String(u._id), u]));
  // owner id -> names of the cooperatives they borrowed from (no repeats)
  const coopsByOwner = new Map();
  for (const l of loans) {
    const name = l.cooperative && l.cooperative.name;
    if (!name) continue;
    const key = String(l.farmer);
    if (!coopsByOwner.has(key)) coopsByOwner.set(key, []);
    if (!coopsByOwner.get(key).includes(name)) coopsByOwner.get(key).push(name);
  }

  const rows = farms.map((f) => {
    const owner = ownerById.get(String(f.owner));
    return {
      id: String(f._id),
      name: f.name,
      farmer: owner ? fullName(owner) : 'Unknown',
      farmerEmail: owner ? owner.email : null,
      farmerStatus: owner && owner.isActive === false ? 'suspended' : 'active',
      location: (f.location && f.location.address) || null,
      sizeHectares: typeof f.totalAreaHectares === 'number' && f.totalAreaHectares > 0 ? f.totalAreaHectares : null,
      cooperatives: coopsByOwner.get(String(f.owner)) || [],
      createdAt: f.createdAt,
    };
  });

  new ApiResponse(200, {
    farms: rows,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    kpis: {
      registeredFarms: registered,
      avgFarmSizeHectares: avgSize,
      linkedToCooperative: linked,
      notLinked: registered - linked,
    },
  }, 'Farms fetched').send(res);
}

module.exports = { listFarms };