const CalamityClaim = require('../models/CalamityClaim');
const CooperativeMember = require('../models/CooperativeMember');
const { CALAMITIES } = require('./loanTerms');

/**
 * Disaster relief, as the loan screens see it
 * -------------------------------------------
 * Each loan can carry the latest disaster relief claim for it, shaped for the
 * person looking:
 *   - the farmer sees their own claim in every state;
 *   - an admin sees every claim;
 *   - a cooperative's owner / finance manager sees it only once an admin has
 *     verified it (a pending or rejected claim is between the farmer and the admin).
 * The server also works out what that person may do next (canRequest for the
 * farmer, canFreeze for the owner), so no screen has to guess.
 */
const RUNNING = ['active', 'grace_period'];
const STAFF_ROLES = ['owner', 'finance_manager'];
const idOf = (v) => String(v && v._id ? v._id : v);

// What leaves the server about a claim: never the file's storage reference.
function publicClaim(c, now = new Date()) {
  if (!c) return null;
  const f = c.file || {};
  const fr = c.freeze || {};
  return {
    id: String(c._id),
    loanId: idOf(c.loan),
    status: c.status,
    calamity: c.calamity,
    calamityLabel: CALAMITIES[c.calamity] || 'Calamity',
    description: c.description || null,
    hasFile: Boolean(f.format),
    fileName: f.originalName || null,
    fileType: f.format || null,
    bytes: typeof f.bytes === 'number' ? f.bytes : null,
    createdAt: c.createdAt,
    review: c.status === 'pending' ? null : { note: c.reviewNote || null, reviewedByName: c.reviewedByName || null, reviewedAt: c.reviewedAt || null },
    freeze: fr.activatedAt
      ? {
          activatedAt: fr.activatedAt,
          activatedByName: fr.activatedByName || null,
          endsAt: fr.endsAt || null,
          previousDueDate: fr.previousDueDate || null,
          newDueDate: fr.newDueDate || null,
          running: Boolean(fr.endsAt && new Date(fr.endsAt) > now),
        }
      : null,
  };
}

// A claim that stops the farmer from sending another one: it is waiting for the
// admin, or it was verified and its freeze has not run out yet (or was not
// activated yet).
function isBlocking(c, now = new Date()) {
  if (c.status === 'pending') return true;
  if (c.status !== 'verified') return false;
  const fr = c.freeze || {};
  if (!fr.activatedAt) return true;
  return Boolean(fr.endsAt && new Date(fr.endsAt) > now);
}

// Adds `relief` to each plain loan object (call after balances are attached).
// viewer: the signed-in user.
async function attachRelief(loans, viewer, now = new Date()) {
  if (!loans.length) return loans;
  const claims = await CalamityClaim.find({ loan: { $in: loans.map((l) => l._id) } }).sort({ createdAt: -1, _id: -1 }).lean();
  const byLoan = new Map();
  for (const c of claims) {
    const k = String(c.loan);
    if (!byLoan.has(k)) byLoan.set(k, []);
    byLoan.get(k).push(c);
  }

  const memberships = viewer.role === 'admin' ? [] : await CooperativeMember.find({ user: viewer._id, status: 'active' }).select('cooperative role').lean();
  const roleIn = new Map(memberships.map((m) => [String(m.cooperative), m.role]));

  return loans.map((l) => {
    const list = byLoan.get(String(l._id)) || [];
    const isFarmer = idOf(l.farmer) === String(viewer._id);
    const coopRole = roleIn.get(idOf(l.cooperative));
    const isStaff = !isFarmer && STAFF_ROLES.includes(coopRole);
    const isOwner = !isFarmer && coopRole === 'owner';
    const isAdmin = viewer.role === 'admin';

    let claim = null;
    if (isAdmin || isFarmer) claim = list[0] || null;
    else if (isStaff) claim = list.find((c) => c.status === 'verified') || null;

    const running = RUNNING.includes(l.status) && Boolean(l.growingDays) && (l.remainingBalance || 0) > 0;
    const canRequest = isFarmer && running && !list.some((c) => isBlocking(c, now));
    const canFreeze = isOwner && running && Boolean(claim) && claim.status === 'verified' && !(claim.freeze && claim.freeze.activatedAt);

    return { ...l, relief: { claim: publicClaim(claim, now), canRequest, canFreeze } };
  });
}

module.exports = { publicClaim, isBlocking, attachRelief, RUNNING };
