const mongoose = require('mongoose');
const Cooperative = require('../models/Cooperative');
const ArchivedItem = require('../models/ArchivedItem');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { recordAudit } = require('../utils/audit');
const { sendAccountDeletedByAdminEmail } = require('../utils/mailer');
const {
  RETENTION_DAYS,
  planCooperative,
  countsOf,
  writeArchive,
  deleteBundle,
  parseArchive,
  restoreBundle,
  purgeArchivedItem,
  ensureArchiveReady,
  daysLeft,
} = require('../utils/archive');

const KIND_LABEL = { cooperative: 'Cooperative', user: 'Account' };
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toId = (v) => new mongoose.Types.ObjectId(String(v));

const notFoundText = 'That archived item was not found. It may have been restored or removed already.';

// ---------- delete a cooperative ----------

// GET /api/admin/cooperatives/:id/impact
// Everything "Delete cooperative" would remove, shown before the admin
// confirms. Nothing is changed.
async function getCooperativeImpact(req, res) {
  const plan = await planCooperative(toId(req.params.id));
  if (!plan) throw ApiError.notFound('Cooperative not found');
  new ApiResponse(200, {
    cooperative: { id: String(plan.coop._id), name: plan.coop.name, status: plan.coop.status },
    counts: countsOf(plan.bundle),
    people: plan.people,
    kept: plan.kept,
    retentionDays: RETENTION_DAYS,
  }).send(res);
}

// DELETE /api/admin/cooperatives/:id   { confirmName }
// Removes the cooperative, its owner and team (unless they belong elsewhere),
// invitations, and every loan, payment, reminder and notification of it. A full
// copy goes to the archive in the same database transaction, so it is either
// all deleted-and-saved or nothing at all.
async function deleteCooperative(req, res) {
  const coopId = toId(req.params.id);
  const coop = await Cooperative.findById(coopId).select('name').lean();
  if (!coop) throw ApiError.notFound('Cooperative not found');

  const typed = String(req.body.confirmName || '').trim();
  if (typed !== coop.name) throw ApiError.badRequest("The name you typed doesn't match this cooperative's name.");

  await ensureArchiveReady();
  const session = await mongoose.startSession();
  let done = null;
  try {
    await session.withTransaction(async () => {
      done = null;
      const plan = await planCooperative(coopId, session);
      if (!plan) return;
      const row = await writeArchive(
        { kind: 'cooperative', label: plan.label, bundle: plan.bundle, people: plan.people, kept: plan.kept, actor: req.user },
        session
      );
      await deleteBundle(plan.bundle, session);
      done = { plan, row };
    });
  } finally {
    await session.endSession();
  }
  if (!done) throw ApiError.conflict('This cooperative has already been deleted');

  // The people whose accounts went with it are told, like any other deleted account.
  const gone = (done.plan.bundle.User || []).slice(0, 50);
  const results = await Promise.allSettled(gone.map((u) => sendAccountDeletedByAdminEmail(u.email, u.firstName)));
  const emailsFailed = results.filter((r) => r.status === 'rejected').length;
  if (emailsFailed) console.error(`Failed to send ${emailsFailed} account-deleted email(s) after deleting a cooperative`);

  await recordAudit(req.user, 'cooperative.delete', {
    targetType: 'cooperative',
    targetId: coopId,
    targetLabel: coop.name,
    details: { counts: done.row.counts, accountsDeleted: (done.plan.bundle.User || []).length, emailsFailed, archiveId: String(done.row._id) },
  });

  new ApiResponse(
    200,
    { archiveId: String(done.row._id), counts: done.row.counts, accountsDeleted: (done.plan.bundle.User || []).length, emailsFailed },
    'Cooperative deleted'
  ).send(res);
}

// ---------- the archive ----------

function toRow(item, now = new Date()) {
  return {
    id: String(item._id),
    kind: item.kind,
    kindLabel: KIND_LABEL[item.kind] || item.kind,
    label: item.label,
    counts: item.counts || {},
    deletedAt: item.createdAt,
    deletedBy: item.deletedByName || '—',
    expiresAt: item.expiresAt,
    daysLeft: daysLeft(item, now),
    sizeBytes: item.sizeBytes || 0,
  };
}

// GET /api/admin/archive?kind=all|cooperative|user&search=&page=&limit=
// Only items still inside their 30 days; the newest first.
async function listArchive(req, res) {
  const now = new Date();
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const kind = req.query.kind || 'all';
  const search = (req.query.search || '').trim();

  const live = { expiresAt: { $gt: now } };
  const filter = { ...live };
  if (kind !== 'all') filter.kind = kind;
  if (search) filter.label = new RegExp(escapeRegex(search), 'i');

  const [total, all, cooperatives, users, rows] = await Promise.all([
    ArchivedItem.countDocuments(filter),
    ArchivedItem.countDocuments(live),
    ArchivedItem.countDocuments({ ...live, kind: 'cooperative' }),
    ArchivedItem.countDocuments({ ...live, kind: 'user' }),
    ArchivedItem.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);

  new ApiResponse(200, {
    items: rows.map((r) => toRow(r, now)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    counts: { all, cooperative: cooperatives, user: users },
    retentionDays: RETENTION_DAYS,
  }).send(res);
}

// GET /api/admin/archive/:id — the summary only (never the saved data itself,
// which holds password hashes and invitation codes).
async function getArchived(req, res) {
  const now = new Date();
  const item = await ArchivedItem.findById(req.params.id).lean();
  if (!item || new Date(item.expiresAt) <= now) throw ApiError.notFound(notFoundText);
  new ApiResponse(200, { ...toRow(item, now), people: item.people || [], kept: item.kept || [] }).send(res);
}

// POST /api/admin/archive/:id/restore
// Puts everything back in one transaction. Refused (changing nothing) when the
// cooperative's registration number or the owner's email has been taken since.
async function restoreArchived(req, res) {
  const now = new Date();
  const item = await ArchivedItem.findById(req.params.id).select('+data').lean();
  if (!item || new Date(item.expiresAt) <= now) throw ApiError.notFound(notFoundText);
  const data = parseArchive(item);

  const session = await mongoose.startSession();
  let outcome = null;
  try {
    await session.withTransaction(async () => {
      outcome = null;
      // The archive row is the gate: only one request can ever restore it.
      const gone = await ArchivedItem.collection.deleteOne({ _id: item._id }, { session });
      if (!gone.deletedCount) return;
      outcome = await restoreBundle(data, item.kind, session);
    });
  } finally {
    await session.endSession();
  }
  if (!outcome) throw ApiError.conflict('That archived item is no longer available.');

  await recordAudit(req.user, `${item.kind}.restore`, {
    targetType: item.kind,
    targetId: item._id,
    targetLabel: item.label,
    details: { restored: outcome.restored, skipped: outcome.skipped.length },
  });

  new ApiResponse(
    200,
    { kind: item.kind, label: item.label, restored: outcome.restored, skipped: outcome.skipped },
    item.kind === 'cooperative' ? 'Cooperative restored' : 'Account restored'
  ).send(res);
}

// DELETE /api/admin/archive/:id — remove it for good, before the 30 days are up.
async function purgeArchived(req, res) {
  const item = await purgeArchivedItem(req.params.id);
  if (!item) throw ApiError.notFound(notFoundText);

  await recordAudit(req.user, `${item.kind}.purge`, {
    targetType: item.kind,
    targetId: item._id,
    targetLabel: item.label,
    details: { auto: false },
  });

  new ApiResponse(200, {}, 'Permanently deleted').send(res);
}

module.exports = { getCooperativeImpact, deleteCooperative, listArchive, getArchived, restoreArchived, purgeArchived };