const CalamityClaim = require('../models/CalamityClaim');
const Loan = require('../models/Loan');
const User = require('../models/User');
const Cooperative = require('../models/Cooperative');
const CooperativeMember = require('../models/CooperativeMember');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const storage = require('../utils/cloudinary');
const { sniff } = require('../utils/fileSniff');
const { recordAudit } = require('../utils/audit');
const { round2 } = require('../utils/loanBalance');
const { CROPS, CALAMITIES, FREEZE_DAYS, DAY_MS } = require('../utils/loanTerms');
const { publicClaim, isBlocking, RUNNING } = require('../utils/relief');
const { syncLoanStages } = require('../utils/loanStages');
const {
  tellAdminsClaim, tellFarmerClaimVerified, tellFarmerClaimRejected, tellCoopStaffClaim, tellFarmerFreezeStarted, fullName,
} = require('../utils/stageNotices');
const loanController = require('./loan.controller');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idOf = (v) => String(v && v._id ? v._id : v);
const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// POST /api/calamity-claims  (multipart: loan, calamity, description, file)
// A farmer asks for disaster relief on one of their own running crop loans.
// The proof must really be a PDF, JPG or PNG. It goes to a FarmFund admin
// first; the cooperative does not hear of it until the admin verifies it.
async function createClaim(req, res) {
  const { loan: loanId, calamity, description } = req.body;

  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    throw ApiError.badRequest('Upload a photo or PDF as proof that your farm was affected');
  }
  const kind = sniff(req.file.buffer);
  if (!kind) throw ApiError.badRequest('Only PDF, JPG or PNG files can be uploaded');

  // Bring the loan's stage up to date first (it may have just entered or left its grace period).
  await syncLoanStages({ loan: loanId });
  const loan = await Loan.findById(loanId).lean();
  // Someone else's loan looks exactly like one that does not exist.
  if (!loan || String(loan.farmer) !== String(req.user._id)) throw ApiError.notFound('Loan not found');
  if (!loan.growingDays) throw ApiError.badRequest('Disaster relief is only for crop loans');
  if (!RUNNING.includes(loan.status)) throw ApiError.badRequest('Disaster relief can only be requested for a loan that is active or in its grace period');
  const balance = (await loanController.balanceOf(loan));
  if (balance <= 0.001) throw ApiError.badRequest('This loan has nothing left to pay');

  const existing = await CalamityClaim.find({ loan: loan._id }).lean();
  if (existing.some((c) => isBlocking(c))) {
    throw ApiError.conflict('You already have a disaster relief claim for this loan that is still in progress.');
  }

  if (!storage.isConfigured()) throw new ApiError(503, 'File storage is not set up yet. Please try again later.');
  let stored;
  try {
    stored = await storage.uploadBuffer(req.file.buffer, storage.CLAIM_FOLDER);
  } catch (err) {
    console.error('Disaster claim upload to Cloudinary failed:', err && err.message);
    throw new ApiError(502, 'The file could not be stored. Please try again.');
  }

  const rawName = typeof req.file.originalname === 'string' ? req.file.originalname : '';
  let claim;
  try {
    claim = await CalamityClaim.create({
      loan: loan._id,
      cooperative: loan.cooperative,
      farmer: req.user._id,
      calamity,
      description,
      file: {
        publicId: stored.publicId,
        format: kind.ext,
        bytes: req.file.buffer.length,
        originalName: rawName.replace(/[<>\r\n]/g, '').slice(0, 200) || undefined,
      },
    });
  } catch (err) {
    await storage.destroy(stored.publicId);
    throw err;
  }

  // Two claims sent at the same moment could both pass the check above. The
  // earliest one stays; any other is taken back.
  const open = (await CalamityClaim.find({ loan: loan._id }).sort({ _id: 1 }).lean()).filter((c) => isBlocking(c));
  if (open.length && String(open[0]._id) !== String(claim._id)) {
    await CalamityClaim.deleteOne({ _id: claim._id });
    await storage.destroy(stored.publicId);
    throw ApiError.conflict('You already have a disaster relief claim for this loan that is still in progress.');
  }

  await tellAdminsClaim(claim, loan, req.user);

  new ApiResponse(201, { claim: publicClaim(claim) }, 'Disaster relief claim submitted. An admin will check your proof first.').send(res);
}

function toQueueRow(c, farmer, loan, coop) {
  const pub = publicClaim(c);
  return {
    ...pub,
    farmer: { id: idOf(c.farmer), name: farmer ? fullName(farmer) : 'Deleted account', email: farmer ? farmer.email : null },
    cooperative: { id: idOf(c.cooperative), name: coop ? coop.name : 'Unknown cooperative' },
    loan: loan
      ? { id: idOf(loan._id), principalAmount: loan.principalAmount, cropLabel: loan.crop && CROPS[loan.crop] ? CROPS[loan.crop].label : null, status: loan.status, dueDate: loan.dueDate || null }
      : { id: idOf(c.loan), principalAmount: null, cropLabel: null, status: null, dueDate: null },
  };
}

// GET /api/calamity-claims/admin/queue?status=&search=&page=&limit= — admin only.
// Only farmers who asked for relief appear here, oldest waiting first.
async function adminQueue(req, res) {
  if (req.user.role !== 'admin') throw ApiError.forbidden('Only the FarmFund admin can review disaster relief claims');
  const status = req.query.status || 'pending';
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const filter = status === 'all' ? {} : { status };
  const terms = search.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (terms.length) {
    const and = terms.map((t) => {
      const rx = new RegExp(escapeRegex(t), 'i');
      return { $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] };
    });
    const people = await User.find({ $and: and }).select('_id').lean();
    filter.farmer = { $in: people.map((p) => p._id) };
  }

  const order = status === 'pending' ? 1 : -1;
  const [total, pendingCount, rows] = await Promise.all([
    CalamityClaim.countDocuments(filter),
    CalamityClaim.countDocuments({ status: 'pending' }),
    CalamityClaim.find(filter).sort({ createdAt: order, _id: order }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const [farmers, loans, coops] = rows.length
    ? await Promise.all([
        User.find({ _id: { $in: rows.map((r) => r.farmer) } }).select('firstName lastName email').lean(),
        Loan.find({ _id: { $in: rows.map((r) => r.loan) } }).select('principalAmount crop status dueDate').lean(),
        Cooperative.find({ _id: { $in: rows.map((r) => r.cooperative) } }).select('name').lean(),
      ])
    : [[], [], []];
  const farmerBy = new Map(farmers.map((f) => [String(f._id), f]));
  const loanBy = new Map(loans.map((l) => [String(l._id), l]));
  const coopBy = new Map(coops.map((c) => [String(c._id), c]));

  new ApiResponse(
    200,
    { claims: rows.map((c) => toQueueRow(c, farmerBy.get(String(c.farmer)), loanBy.get(String(c.loan)), coopBy.get(String(c.cooperative)))), total, pendingCount, page, pages: Math.max(1, Math.ceil(total / limit)) },
    'Disaster relief claims fetched'
  ).send(res);
}

// PATCH /api/calamity-claims/:id/admin-review  { status: 'verified'|'rejected', note } — admin only.
// Decided once; two admins clicking at the same moment cannot both decide it.
async function adminReview(req, res) {
  if (req.user.role !== 'admin') throw ApiError.forbidden('Only the FarmFund admin can review disaster relief claims');
  const verified = req.body.status === 'verified';
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';

  const set = {
    status: verified ? 'verified' : 'rejected',
    reviewedBy: req.user._id,
    reviewedByName: fullName(req.user),
    reviewedAt: new Date(),
  };
  if (note) set.reviewNote = note;
  const update = note ? { $set: set } : { $set: set, $unset: { reviewNote: '' } };

  const done = await CalamityClaim.findOneAndUpdate({ _id: req.params.id, status: 'pending' }, update, { new: true }).lean();
  if (!done) {
    const exists = await CalamityClaim.findById(req.params.id).select('status').lean();
    if (!exists) throw ApiError.notFound('Disaster relief claim not found');
    throw ApiError.conflict(`This claim was already ${exists.status === 'verified' ? 'verified' : 'rejected'}.`);
  }

  // Decided, so the "to verify" alert is done with for every admin.
  await Notification.updateMany({ claim: done._id, kind: 'claim_submitted', readAt: { $exists: false } }, { $set: { readAt: new Date() } }).catch(() => {});

  const [farmer, coop, loan] = await Promise.all([
    User.findById(done.farmer).select('firstName lastName email').lean(),
    Cooperative.findById(done.cooperative).select('name').lean(),
    Loan.findById(done.loan).lean(),
  ]);
  await recordAudit(req.user, verified ? 'claim.verify' : 'claim.reject', {
    targetType: 'calamity_claim',
    targetId: done._id,
    targetLabel: `${fullName(farmer)} — ${CALAMITIES[done.calamity] || 'Calamity'}`,
    details: { cooperative: coop ? coop.name : undefined, note: note || undefined },
  });

  const loanForNotice = loan || { _id: done.loan, cooperative: done.cooperative, principalAmount: 0 };
  if (verified) {
    await tellFarmerClaimVerified(done, loanForNotice, farmer, coop);
    await tellCoopStaffClaim(done, loanForNotice, farmer, coop);
  } else {
    await tellFarmerClaimRejected(done, loanForNotice, farmer, note);
  }

  new ApiResponse(200, { claim: toQueueRow(done, farmer, loan, coop) }, verified ? 'Claim verified. The cooperative can now see it.' : 'Disaster relief claim not verified').send(res);
}

// GET /api/calamity-claims/:id/proof/link — a link that opens the proof for a
// few minutes. The farmer who sent it, an admin, or (once an admin verified it)
// the lending cooperative's owner or finance manager. Anyone else gets the same
// answer as for a claim that does not exist.
async function proofLink(req, res) {
  const claim = await CalamityClaim.findById(req.params.id).select('+file.publicId').lean();
  let allowed = false;
  if (claim && claim.file && claim.file.publicId) {
    if (req.user.role === 'admin' || String(claim.farmer) === String(req.user._id)) allowed = true;
    else if (claim.status === 'verified') {
      const staff = await CooperativeMember.findOne({ cooperative: claim.cooperative, user: req.user._id, role: { $in: ['owner', 'finance_manager'] }, status: 'active' });
      allowed = Boolean(staff);
    }
  }
  if (!allowed) throw ApiError.notFound('Proof not found');
  if (!storage.isConfigured()) throw new ApiError(503, 'File storage is not set up yet. Please try again later.');

  let url;
  try {
    url = storage.signedLink(claim.file.publicId, claim.file.format);
  } catch (err) {
    console.error('Could not build claim proof link:', err && err.message);
    throw new ApiError(502, 'The file could not be opened. Please try again.');
  }
  new ApiResponse(200, { url, expiresInSeconds: storage.LINK_SECONDS, fileType: claim.file.format }, 'Link ready').send(res);
}

// POST /api/calamity-claims/:id/freeze — the lending cooperative's OWNER only.
// For a claim an admin verified: pushes that one loan's due date later by 90
// days (counted from the later of today and the current due date) and adds no
// interest in that time. Done once per claim.
async function activateFreeze(req, res) {
  const claim = await CalamityClaim.findById(req.params.id).lean();
  // Not the owner of that cooperative, or not verified by an admin yet: the
  // claim looks like it does not exist (the cooperative cannot see it before then).
  const owner = claim
    ? await CooperativeMember.findOne({ cooperative: claim.cooperative, user: req.user._id, role: 'owner', status: 'active' })
    : null;
  if (!claim || !owner || claim.status !== 'verified') throw ApiError.notFound('Disaster relief claim not found');
  if (claim.freeze && claim.freeze.activatedAt) throw ApiError.conflict('A calamity freeze was already activated for this claim.');

  await syncLoanStages({ loan: claim.loan });
  const loan = await Loan.findById(claim.loan).lean();
  if (!loan) throw ApiError.notFound('Loan not found');
  if (!RUNNING.includes(loan.status)) throw ApiError.badRequest('The freeze can only be activated on a loan that is active or in its grace period');
  if ((await loanController.balanceOf(loan)) <= 0.001) throw ApiError.badRequest('This loan has nothing left to pay');

  const now = new Date();
  const previousDue = loan.dueDate ? new Date(loan.dueDate) : now;
  const newDue = new Date(Math.max(previousDue.getTime(), now.getTime()) + FREEZE_DAYS * DAY_MS);
  const endsAt = new Date(now.getTime() + FREEZE_DAYS * DAY_MS);
  const shiftDays = (newDue.getTime() - previousDue.getTime()) / DAY_MS;

  // First the claim (so two clicks cannot both freeze), then the loan.
  const frozen = await CalamityClaim.findOneAndUpdate(
    { _id: claim._id, status: 'verified', 'freeze.activatedAt': { $exists: false } },
    { $set: { freeze: { activatedAt: now, activatedBy: req.user._id, activatedByName: fullName(req.user), endsAt, previousDueDate: previousDue, newDueDate: newDue } } },
    { new: true }
  ).lean();
  if (!frozen) throw ApiError.conflict('A calamity freeze was already activated for this claim.');

  const loanSet = { dueDate: newDue, delayDays: round2((Number(loan.delayDays) || 0) + shiftDays) };
  let moved = null;
  try {
    const guard = { _id: loan._id, status: { $in: RUNNING } };
    if (loan.dueDate) guard.dueDate = loan.dueDate;
    moved = await Loan.findOneAndUpdate(guard, { $set: loanSet }, { new: true }).lean();
  } catch (err) {
    console.error('Could not move the loan due date:', err && err.message);
  }
  if (!moved) {
    // The loan changed under us. Take the freeze back so nothing is half done.
    await CalamityClaim.updateOne({ _id: claim._id }, { $unset: { freeze: '' } }).catch(() => {});
    throw ApiError.conflict('This loan just changed. Please refresh and try again.');
  }

  const [farmer, coop] = await Promise.all([
    User.findById(claim.farmer).select('firstName lastName email').lean(),
    Cooperative.findById(claim.cooperative).select('name').lean(),
  ]);
  await recordAudit(req.user, 'claim.freeze', {
    targetType: 'calamity_claim',
    targetId: claim._id,
    targetLabel: `${fullName(farmer)} — ${peso(loan.principalAmount)}`,
    details: { cooperative: coop ? coop.name : undefined, newDueDate: newDue },
  });
  await tellFarmerFreezeStarted(frozen, moved, farmer, coop, { endsAt, newDueDate: newDue });

  new ApiResponse(200, await loanController.serializeLoanFor(moved._id, req.user), 'Calamity freeze activated').send(res);
}

module.exports = { createClaim, adminQueue, adminReview, proofLink, activateFreeze };
