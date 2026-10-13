const mongoose = require('mongoose');
const ApiError = require('./ApiError');
const cloudinary = require('./cloudinary');
const { recordAudit } = require('./audit');
const { USER_TRANSIENT_FIELDS } = require('./backup');
const ArchivedItem = require('../models/ArchivedItem');

// The recycle bin behind "Delete cooperative" and "Delete user account".
//
// Deleting copies everything that is about to disappear into one ArchivedItem
// row, in the SAME database transaction as the deletes, so there is never a
// delete without a copy. Restoring puts the copy back, also in one
// transaction. Everything is read and written through the raw collections (no
// validation or password hooks), like backups, so what comes back is exactly
// what was saved.

const { EJSON } = mongoose.mongo.BSON;

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// One row can't be bigger than the database's 16 MB document limit; leave room.
const MAX_DATA_CHARS = 12 * 1000 * 1000;

const MODELS = {
  Cooperative: require('../models/Cooperative'),
  CooperativeMember: require('../models/CooperativeMember'),
  CooperativeInvite: require('../models/CooperativeInvite'),
  User: require('../models/User'),
  Farm: require('../models/Farm'),
  Field: require('../models/Field'),
  FarmingCycle: require('../models/FarmingCycle'),
  FinancialRecord: require('../models/FinancialRecord'),
  Budget: require('../models/Budget'),
  DismissedAlert: require('../models/DismissedAlert'),
  Certificate: require('../models/Certificate'),
  Loan: require('../models/Loan'),
  LoanPayment: require('../models/LoanPayment'),
  PaymentTransaction: require('../models/PaymentTransaction'),
  LoanReminder: require('../models/LoanReminder'),
  Notification: require('../models/Notification'),
};
const KNOWN = Object.keys(MODELS);

// What each kind of record is called in messages.
const LABEL = {
  Cooperative: 'cooperative',
  CooperativeMember: 'team memberships',
  CooperativeInvite: 'invitations',
  User: 'accounts',
  Farm: 'farms',
  Field: 'fields',
  FarmingCycle: 'farming cycles',
  FinancialRecord: 'financial records',
  Budget: 'budgets',
  DismissedAlert: 'dismissed alerts',
  Certificate: 'certificates',
  Loan: 'loans',
  LoanPayment: 'payments',
  PaymentTransaction: 'payment transactions',
  LoanReminder: 'reminders',
  Notification: 'notifications',
};

const ROLE_LABEL = { owner: 'Owner', finance_manager: 'Financial Manager', member: 'Member' };

const sid = (v) => String(v);
const col = (name) => MODELS[name].collection;
const idsOf = (docs) => docs.map((d) => d._id);
const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ');
const withSession = (session, extra = {}) => (session ? { ...extra, session } : extra);
const find = (name, filter, session) => col(name).find(filter, withSession(session)).toArray();

function stripUser(u) {
  const copy = { ...u };
  for (const f of USER_TRANSIENT_FIELDS) delete copy[f];
  return copy;
}

// Adds the documents of `extra` to `into`, skipping any id already present.
function mergeInto(into, extra) {
  for (const [name, docs] of Object.entries(extra)) {
    const seen = new Set((into[name] || []).map((d) => sid(d._id)));
    const list = into[name] || (into[name] = []);
    for (const d of docs) {
      if (!seen.has(sid(d._id))) {
        seen.add(sid(d._id));
        list.push(d);
      }
    }
  }
  return into;
}

// ---------- reading what belongs to some accounts ----------

// Everything that belongs ONLY to these people: their farms and what is inside
// them, budgets, certificates, notifications, dismissed alerts and team
// memberships. Admin accounts are never returned.
async function readUserData(userIds, session) {
  const out = {};
  if (!userIds.length) return out;
  const users = await find('User', { _id: { $in: userIds }, role: { $ne: 'admin' } }, session);
  if (!users.length) return out;
  const ids = idsOf(users);
  out.User = users.map(stripUser);

  const farms = await find('Farm', { owner: { $in: ids } }, session);
  out.Farm = farms;
  const farmIds = idsOf(farms);
  if (farmIds.length) {
    const fields = await find('Field', { farm: { $in: farmIds } }, session);
    out.Field = fields;
    if (fields.length) out.FarmingCycle = await find('FarmingCycle', { field: { $in: idsOf(fields) } }, session);
    out.FinancialRecord = await find('FinancialRecord', { farm: { $in: farmIds } }, session);
    out.Budget = await find('Budget', { farm: { $in: farmIds } }, session);
  }
  out.DismissedAlert = await find('DismissedAlert', { user: { $in: ids } }, session);
  out.Certificate = await find('Certificate', { farmer: { $in: ids } }, session);
  out.Notification = await find('Notification', { user: { $in: ids } }, session);
  out.CooperativeMember = await find('CooperativeMember', { user: { $in: ids } }, session);
  return out;
}

// What deleting one account removes, plus the readable summary.
async function planUser(userId, session) {
  const bundle = await readUserData([userId], session);
  if (!bundle.User || !bundle.User.length) return null;
  const u = bundle.User[0];
  const membership = (bundle.CooperativeMember || []).find((m) => m.status !== 'removed');
  return {
    bundle,
    label: `${fullName(u)} <${u.email}>`,
    people: [{ name: fullName(u), email: u.email, role: membership ? ROLE_LABEL[membership.role] || 'Member' : 'Individual' }],
    kept: [],
  };
}

// ---------- reading what belongs to a cooperative ----------

// Works out everything "Delete cooperative" would remove. Returns null when
// the cooperative doesn't exist.
//
// The owner and the team are removed with it, EXCEPT anyone who also belongs to
// another cooperative, has loans with another cooperative, or is an admin: their
// account is kept and only their place in this cooperative goes. Borrowers
// (people with loans here) keep their accounts; only the loans go.
async function planCooperative(coopId, session) {
  const [coop] = await find('Cooperative', { _id: coopId }, session);
  if (!coop) return null;

  const memberships = await find('CooperativeMember', { cooperative: coopId }, session);
  const invites = await find('CooperativeInvite', { cooperative: coopId }, session);
  const loans = await find('Loan', { cooperative: coopId }, session);
  const loanIds = idsOf(loans);

  const payments = loanIds.length ? await find('LoanPayment', { loan: { $in: loanIds } }, session) : [];
  const txIds = payments.map((p) => p.paymentTransaction).filter(Boolean);
  const transactions = txIds.length ? await find('PaymentTransaction', { _id: { $in: txIds } }, session) : [];
  const reminders = await find(
    'LoanReminder',
    loanIds.length ? { $or: [{ cooperative: coopId }, { loan: { $in: loanIds } }] } : { cooperative: coopId },
    session
  );
  const notifications = await find(
    'Notification',
    loanIds.length ? { $or: [{ cooperative: coopId }, { loan: { $in: loanIds } }] } : { cooperative: coopId },
    session
  );

  const team = memberships.filter((m) => m.status !== 'removed');
  const teamIds = team.map((m) => m.user);
  const roleOf = new Map(team.map((m) => [sid(m.user), m.role]));
  const teamUsers = teamIds.length ? await find('User', { _id: { $in: teamIds } }, session) : [];
  const elsewhere = teamIds.length
    ? await find('CooperativeMember', { user: { $in: teamIds }, cooperative: { $ne: coopId }, status: { $ne: 'removed' } }, session)
    : [];
  const otherLoans = teamIds.length ? await find('Loan', { farmer: { $in: teamIds }, cooperative: { $ne: coopId } }, session) : [];
  const elsewhereSet = new Set(elsewhere.map((m) => sid(m.user)));
  const otherLoanSet = new Set(otherLoans.map((l) => sid(l.farmer)));

  const people = [];
  const kept = [];
  const doomed = [];
  for (const u of teamUsers) {
    const role = ROLE_LABEL[roleOf.get(sid(u._id))] || 'Member';
    const who = { name: fullName(u), email: u.email, role };
    if (u.role === 'admin') kept.push({ ...who, reason: 'is an administrator' });
    else if (elsewhereSet.has(sid(u._id))) kept.push({ ...who, reason: 'also belongs to another cooperative' });
    else if (otherLoanSet.has(sid(u._id))) kept.push({ ...who, reason: 'has loans with another cooperative' });
    else {
      doomed.push(u._id);
      people.push(who);
    }
  }

  const bundle = {
    Cooperative: [coop],
    CooperativeMember: memberships,
    CooperativeInvite: invites,
    Loan: loans,
    LoanPayment: payments,
    PaymentTransaction: transactions,
    LoanReminder: reminders,
    Notification: notifications,
  };
  mergeInto(bundle, await readUserData(doomed, session));

  return { coop, bundle, label: coop.name, people, kept, doomedIds: doomed };
}

function countsOf(bundle) {
  const out = {};
  for (const [name, docs] of Object.entries(bundle)) if (docs.length) out[name] = docs.length;
  return out;
}

// ---------- deleting + archiving ----------

// Saves the copy. Must be called inside the same transaction as deleteBundle.
async function writeArchive({ kind, label, bundle, people, kept, actor }, session) {
  const data = EJSON.stringify({ v: 1, data: bundle });
  if (data.length > MAX_DATA_CHARS) {
    throw new ApiError(413, "There is too much data to keep a recoverable copy, so nothing was deleted.");
  }
  const now = new Date();
  const row = {
    _id: new mongoose.Types.ObjectId(),
    kind,
    label: String(label).slice(0, 300),
    counts: countsOf(bundle),
    people: people.slice(0, 200),
    kept: kept.slice(0, 100),
    data,
    sizeBytes: Buffer.byteLength(data),
    deletedBy: actor && actor._id,
    deletedByName: actor ? fullName(actor) || undefined : undefined,
    expiresAt: new Date(now.getTime() + RETENTION_DAYS * DAY_MS),
    createdAt: now,
    updatedAt: now,
  };
  await ArchivedItem.collection.insertOne(row, withSession(session));
  return row;
}

async function deleteBundle(bundle, session) {
  for (const [name, docs] of Object.entries(bundle)) {
    if (!docs.length) continue;
    await col(name).deleteMany({ _id: { $in: idsOf(docs) } }, withSession(session));
  }
}

// ---------- reading a saved copy ----------

function parseArchive(item) {
  let parsed;
  try {
    parsed = EJSON.parse(item.data);
  } catch {
    throw ApiError.internal('This archived item is damaged (unreadable data), so it was not used.');
  }
  const data = parsed && parsed.v === 1 && parsed.data;
  if (!data || typeof data !== 'object') throw ApiError.internal('This archived item is damaged, so it was not used.');
  for (const [name, docs] of Object.entries(data)) {
    if (!KNOWN.includes(name) || !Array.isArray(docs)) throw ApiError.internal('This archived item is damaged (unexpected data), so it was not used.');
  }
  const counts = item.counts || {};
  for (const name of Object.keys(counts)) {
    if (!data[name] || data[name].length !== counts[name]) {
      throw ApiError.internal('This archived item is damaged (records are missing), so it was not used.');
    }
  }
  return data;
}

// ---------- restoring ----------

async function idsInDb(name, list, session) {
  const unique = [...new Map(list.filter(Boolean).map((v) => [sid(v), v])).values()];
  if (!unique.length) return new Set();
  const docs = await col(name).find({ _id: { $in: unique } }, withSession(session, { projection: { _id: 1 } })).toArray();
  return new Set(docs.map((d) => sid(d._id)));
}

// Puts a saved copy back. Call inside a transaction. Throws ApiError(409) —
// before changing anything — when the copy can't come back as a whole (the
// cooperative or the person's email has been taken since). Anything that merely
// depends on something that no longer exists is left out and reported.
// Returns { restored: {Model: n}, skipped: [text] }.
async function restoreBundle(data, kind, session) {
  const snap = (n) => data[n] || [];
  const skipped = [];
  const skipCount = {};
  const note = (name) => {
    skipCount[name] = (skipCount[name] || 0) + 1;
  };

  // --- the cooperative itself ---
  let coopAlive = new Set();
  const coopDocs = snap('Cooperative');
  if (kind === 'cooperative') {
    const coop = coopDocs[0];
    if (!coop) throw ApiError.internal('This archived item is damaged (no cooperative in it), so it was not used.');
    if ((await idsInDb('Cooperative', [coop._id], session)).size) throw ApiError.conflict('This cooperative already exists, so there is nothing to restore.');
    if (coop.registrationNumber) {
      const clash = await col('Cooperative').find({ registrationNumber: coop.registrationNumber }, withSession(session, { projection: { _id: 1 } })).toArray();
      if (clash.length) {
        throw ApiError.conflict(`Another cooperative now uses the registration number ${coop.registrationNumber}, so this one can't be restored.`);
      }
    }
  }

  // --- accounts ---
  const users = snap('User');
  const userInDb = await idsInDb('User', idsOf(users), session);
  const emails = users.map((u) => String(u.email || '').toLowerCase()).filter(Boolean);
  const taken = emails.length ? await col('User').find({ email: { $in: emails } }, withSession(session, { projection: { _id: 1, email: 1 } })).toArray() : [];
  const takenBy = new Map(taken.map((t) => [String(t.email).toLowerCase(), sid(t._id)]));

  const ownerIds = new Set(snap('CooperativeMember').filter((m) => m.role === 'owner' && kind === 'cooperative').map((m) => sid(m.user)));
  const userInsert = [];
  const userSkipped = new Set();
  for (const u of users) {
    if (userInDb.has(sid(u._id))) {
      if (kind === 'user') throw ApiError.conflict('This account already exists, so there is nothing to restore.');
      continue;
    }
    const owner = takenBy.get(String(u.email || '').toLowerCase());
    if (owner) {
      if (kind === 'user') {
        throw ApiError.conflict(`The email ${u.email} is now used by another account, so this account can't be restored. Change or delete that account first.`);
      }
      if (ownerIds.has(sid(u._id))) {
        throw ApiError.conflict(
          `The owner's email (${u.email}) is now used by another account, so this cooperative can't be restored. Change or delete that account first.`
        );
      }
      userSkipped.add(sid(u._id));
      skipped.push(`${fullName(u) || 'An account'} <${u.email}> was left out: that email now belongs to another account.`);
      continue;
    }
    userInsert.push(u);
  }

  // Which accounts exist once this is done: the restored ones, plus any that
  // are simply still there (kept team members, borrowers).
  const refUsers = [
    ...snap('CooperativeMember').map((m) => m.user),
    ...snap('Loan').map((l) => l.farmer),
    ...snap('Notification').map((n) => n.user),
    ...snap('Farm').map((f) => f.owner),
    ...snap('DismissedAlert').map((d) => d.user),
    ...snap('Certificate').map((c) => c.farmer),
  ];
  const userAlive = await idsInDb('User', refUsers, session);
  for (const u of userInsert) userAlive.add(sid(u._id));
  for (const id of userSkipped) userAlive.delete(id);

  if (kind === 'cooperative') coopAlive.add(sid(coopDocs[0]._id));
  else coopAlive = await idsInDb('Cooperative', [...snap('CooperativeMember').map((m) => m.cooperative), ...snap('Loan').map((l) => l.cooperative)], session);

  // --- everything else, in an order where a record's parent comes first ---
  const alive = {};
  const toInsert = { User: userInsert };
  if (kind === 'cooperative') toInsert.Cooperative = coopDocs;
  alive.User = userAlive;
  alive.Cooperative = coopAlive;

  const existingTokens = snap('CooperativeInvite').length
    ? new Set((await col('CooperativeInvite').find({ token: { $in: snap('CooperativeInvite').map((i) => i.token) } }, withSession(session, { projection: { token: 1 } })).toArray()).map((d) => d.token))
    : new Set();
  const pairs = snap('CooperativeMember').length
    ? await col('CooperativeMember').find({ user: { $in: snap('CooperativeMember').map((m) => m.user) } }, withSession(session, { projection: { user: 1, cooperative: 1 } })).toArray()
    : [];
  const pairSet = new Set(pairs.map((p) => `${sid(p.cooperative)}:${sid(p.user)}`));

  const has = (set, id) => set.has(sid(id));
  const rules = [
    ['CooperativeMember', (d) => has(userAlive, d.user) && has(coopAlive, d.cooperative) && !pairSet.has(`${sid(d.cooperative)}:${sid(d.user)}`)],
    ['CooperativeInvite', (d) => has(coopAlive, d.cooperative) && !existingTokens.has(d.token)],
    ['Farm', (d) => has(userAlive, d.owner)],
    ['Field', (d) => has(alive.Farm, d.farm)],
    ['FarmingCycle', (d) => has(alive.Field, d.field)],
    ['FinancialRecord', (d) => has(alive.Farm, d.farm)],
    ['Budget', (d) => has(alive.Farm, d.farm)],
    ['DismissedAlert', (d) => has(userAlive, d.user)],
    ['Certificate', (d) => has(userAlive, d.farmer)],
    ['Loan', (d) => has(userAlive, d.farmer) && has(coopAlive, d.cooperative)],
    ['LoanPayment', (d) => has(alive.Loan, d.loan)],
    ['LoanReminder', (d) => has(alive.Loan, d.loan)],
    ['Notification', (d) => has(userAlive, d.user) && (!d.loan || has(alive.Loan, d.loan))],
  ];
  for (const [name, ok] of rules) {
    const docs = snap(name);
    const inDb = await idsInDb(name, idsOf(docs), session);
    alive[name] = new Set(inDb);
    toInsert[name] = [];
    for (const d of docs) {
      if (inDb.has(sid(d._id))) continue; // already there
      if (!ok(d)) {
        note(name);
        continue;
      }
      toInsert[name].push(d);
      alive[name].add(sid(d._id));
    }
  }
  // A payment's gateway record only comes back with a payment that comes back.
  const wantedTx = new Set(toInsert.LoanPayment.map((p) => p.paymentTransaction).filter(Boolean).map(sid));
  const txDocs = snap('PaymentTransaction');
  const txInDb = await idsInDb('PaymentTransaction', idsOf(txDocs), session);
  toInsert.PaymentTransaction = txDocs.filter((t) => wantedTx.has(sid(t._id)) && !txInDb.has(sid(t._id)));

  for (const [name, n] of Object.entries(skipCount)) {
    skipped.push(`${n} of the ${LABEL[name]} ${n === 1 ? 'was' : 'were'} left out because something they belong to no longer exists.`);
  }

  const restored = {};
  for (const name of KNOWN) {
    const docs = toInsert[name];
    if (!docs || !docs.length) continue;
    await col(name).insertMany(docs, withSession(session, { ordered: true }));
    restored[name] = docs.length;
  }
  return { restored, skipped };
}

// ---------- leaving the archive for good ----------

// Files of archived certificates live in Cloudinary, outside the database.
function certificateFiles(item) {
  if (!item.counts || !item.counts.Certificate || !item.data) return [];
  try {
    return (parseArchive(item).Certificate || []).map((c) => c && c.file && c.file.publicId).filter(Boolean);
  } catch {
    return [];
  }
}

// Removes one archived item for good. Returns the removed row, or null when it
// was already gone. Deleting the row comes first: a leftover file is harmless,
// a row pointing at a deleted file is not.
async function purgeArchivedItem(id) {
  const item = await ArchivedItem.findById(id).select('+data').lean();
  if (!item) return null;
  const gone = await ArchivedItem.deleteOne({ _id: item._id });
  if (!gone || gone.deletedCount === 0) return null;
  if (cloudinary.isConfigured()) {
    for (const publicId of certificateFiles(item)) await cloudinary.destroy(publicId);
  }
  return item;
}

// Removes everything past its 30 days. Run by the nightly job.
async function purgeExpired(now = new Date(), limit = 25) {
  const due = await ArchivedItem.find({ expiresAt: { $lte: now } }).sort({ expiresAt: 1 }).limit(limit).select('_id').lean();
  let purged = 0;
  for (const { _id } of due) {
    try {
      const item = await purgeArchivedItem(_id);
      if (!item) continue;
      purged += 1;
      await recordAudit({ firstName: 'System' }, `${item.kind}.purge`, {
        targetType: item.kind,
        targetId: item._id,
        targetLabel: item.label,
        details: { auto: true },
      });
    } catch (err) {
      console.error('Could not purge an archived item:', err.message);
    }
  }
  return purged;
}

// Makes sure the archive's collection exists before a transaction first writes
// to it (the very first delete ever). Never blocks a delete if it can't.
async function ensureArchiveReady() {
  try {
    if (typeof ArchivedItem.init === 'function') await ArchivedItem.init();
  } catch (err) {
    console.error('Archive setup check failed:', err.message);
  }
}

const daysLeft = (item, now = new Date()) => Math.max(0, Math.ceil((new Date(item.expiresAt) - now) / DAY_MS));

module.exports = {
  RETENTION_DAYS,
  MAX_DATA_CHARS,
  LABEL,
  planCooperative,
  planUser,
  countsOf,
  writeArchive,
  deleteBundle,
  parseArchive,
  restoreBundle,
  purgeArchivedItem,
  purgeExpired,
  ensureArchiveReady,
  daysLeft,
};