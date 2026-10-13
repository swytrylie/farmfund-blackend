const mongoose = require('mongoose');
const Backup = require('../models/Backup');
const BackupChunk = require('../models/BackupChunk');
const ApiError = require('./ApiError');
const { loadBackupModels } = require('./backupModels');

const { EJSON } = mongoose.mongo.BSON;

// Limits. A backup bigger than maxBytes is refused (the database plan has
// limited space). A download bigger than maxDownloadBytes cannot be sent in
// one reply by the hosting platform.
const LIMITS = {
  chunkChars: 1500000,
  maxBytes: 100 * 1024 * 1024,
  maxDownloadBytes: 4000000,
};

// How many automatic copies are kept before the oldest are deleted.
const KEEP = { scheduled: 14, safety: 5, failed: 10 };

// Things only needed for a few minutes (sign-in codes, reset links, login
// sessions, lock counters). They are not saved in a backup, and a restore
// therefore signs everyone out rather than reviving old sessions or codes.
const USER_TRANSIENT_FIELDS = [
  'otpHash', 'otpExpiresAt', 'otpPurpose', 'otpAttempts', 'otpLastSentAt', 'otpSendWindowStart', 'otpSendCount',
  'pendingPasswordHash', 'pendingEmail', 'passwordResetTokenHash', 'passwordResetExpiresAt',
  'emailUndoTokenHash', 'emailUndoExpiresAt', 'previousEmail', 'refreshTokenHash', 'failedLoginAttempts', 'lockUntil',
];
// Left out of the downloadable file as well (they stay in the saved snapshot,
// which a restore needs): passwords, and the secret code of an invitation link.
const DOWNLOAD_SECRET_FIELDS = { User: ['passwordHash'], CooperativeInvite: ['token'] };

// Admin accounts are never saved and never overwritten: whoever is running a
// restore must still be able to sign in afterwards.
const scopeOf = (name) => (name === 'User' ? { role: { $ne: 'admin' } } : {});

function prepare(name, doc) {
  if (name !== 'User') return doc;
  const copy = { ...doc };
  for (const f of USER_TRANSIENT_FIELDS) delete copy[f];
  return copy;
}

const nameOf = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ') : '');

// ---------- taking a backup ----------

// Chunks whose backup never finished (the server stopped halfway) are removed.
async function cleanupOrphans() {
  try {
    const known = await Backup.distinct('_id', {});
    await BackupChunk.deleteMany({ backup: { $nin: known }, createdAt: { $lt: new Date(Date.now() - 60 * 60 * 1000) } });
  } catch (err) {
    console.error('Backup cleanup failed:', err.message);
  }
}

// Deletes the oldest automatic copies beyond the limits in KEEP.
async function pruneOld() {
  try {
    const rules = [
      { filter: { type: 'scheduled', status: 'completed' }, keep: KEEP.scheduled },
      { filter: { type: 'safety', status: 'completed' }, keep: KEEP.safety },
      { filter: { status: 'failed' }, keep: KEEP.failed },
    ];
    for (const { filter, keep } of rules) {
      const old = await Backup.find(filter).sort({ createdAt: -1, _id: -1 }).skip(keep).select('_id').lean();
      if (old.length === 0) continue;
      const ids = old.map((b) => b._id);
      await BackupChunk.deleteMany({ backup: { $in: ids } });
      await Backup.deleteMany({ _id: { $in: ids } });
    }
  } catch (err) {
    console.error('Backup pruning failed:', err.message);
  }
}

// Saves a snapshot of every kind of record. Returns the completed Backup.
// If anything goes wrong the half-written data is deleted, a "failed" Backup
// row is kept (so it shows in the history) and an error is thrown.
async function createBackup({ type, actor }) {
  const id = new mongoose.Types.ObjectId();
  const who = actor ? { createdBy: actor._id, createdByName: nameOf(actor) || undefined } : {};
  try {
    await cleanupOrphans();
    const counts = {};
    let sizeBytes = 0;
    let totalRecords = 0;

    for (const Model of loadBackupModels()) {
      const name = Model.modelName;
      const docs = await Model.collection.find(scopeOf(name)).toArray();
      counts[name] = docs.length;
      totalRecords += docs.length;

      const chunks = [];
      let part = [];
      let chars = 0;
      const flush = () => {
        if (part.length === 0) return;
        const data = `[${part.join(',')}]`;
        chunks.push({ backup: id, model: name, seq: chunks.length, count: part.length, data });
        sizeBytes += Buffer.byteLength(data);
        part = [];
        chars = 0;
      };
      for (const doc of docs) {
        const text = EJSON.stringify(prepare(name, doc));
        if (part.length > 0 && chars + text.length > LIMITS.chunkChars) flush();
        part.push(text);
        chars += text.length + 1;
      }
      flush();

      if (sizeBytes > LIMITS.maxBytes) throw new Error('The data is too large to back up in one piece.');
      if (chunks.length) await BackupChunk.insertMany(chunks);
    }

    const backup = await Backup.create({ _id: id, type, status: 'completed', ...who, sizeBytes, totalRecords, counts });
    await pruneOld();
    return backup;
  } catch (err) {
    try {
      await BackupChunk.deleteMany({ backup: id });
    } catch (cleanupErr) {
      console.error('Could not remove a half-written backup:', cleanupErr.message);
    }
    try {
      await Backup.create({ type, status: 'failed', ...who, error: String(err.message || 'Backup failed').slice(0, 300) });
    } catch (recordErr) {
      console.error('Could not record the failed backup:', recordErr.message);
    }
    await pruneOld();
    throw ApiError.internal(`The backup could not be completed: ${err.message || 'unknown error'}`);
  }
}

// ---------- reading a backup back ----------

// Reads a whole backup into memory and checks it is complete BEFORE anything
// is changed. Returns { backup, data: { Model: [docs] } }.
async function loadSnapshot(backupId) {
  const backup = await Backup.findById(backupId).lean();
  if (!backup || backup.status !== 'completed') throw ApiError.notFound('That backup was not found.');

  const counts = backup.counts || {};
  const data = {};
  for (const name of Object.keys(counts)) data[name] = [];

  const chunks = await BackupChunk.find({ backup: backup._id }).sort({ model: 1, seq: 1 }).lean();
  for (const chunk of chunks) {
    if (!(chunk.model in data)) throw ApiError.internal('That backup is damaged (unexpected data), so it was not used.');
    let docs;
    try {
      docs = EJSON.parse(chunk.data);
    } catch {
      throw ApiError.internal('That backup is damaged (unreadable data), so it was not used.');
    }
    if (!Array.isArray(docs) || docs.length !== chunk.count) {
      throw ApiError.internal('That backup is damaged (a piece is incomplete), so it was not used.');
    }
    data[chunk.model].push(...docs);
  }
  for (const name of Object.keys(counts)) {
    if (data[name].length !== counts[name]) {
      throw ApiError.internal('That backup is damaged (records are missing), so it was not used.');
    }
  }
  return { backup, data };
}

// The backup as a plain file for the admin to keep: readable JSON, without
// passwords.
async function buildDownload(backupId) {
  const { backup, data } = await loadSnapshot(backupId);
  const out = {};
  for (const name of Object.keys(data)) {
    out[name] = JSON.parse(JSON.stringify(data[name]));
    for (const f of DOWNLOAD_SECRET_FIELDS[name] || []) {
      for (const doc of out[name]) delete doc[f];
    }
  }
  const file = {
    app: 'FarmFund',
    backupId: String(backup._id),
    type: backup.type,
    takenAt: backup.createdAt,
    note: 'Passwords and invitation codes are not included in this file. Admin accounts, audit logs and login history are not part of a backup.',
    counts: backup.counts,
    data: out,
  };
  const text = JSON.stringify(file);
  if (Buffer.byteLength(text) > LIMITS.maxDownloadBytes) {
    throw new ApiError(413, 'This backup is too large to download from here. It is still saved and can be restored.');
  }
  return { backup, file };
}

// ---------- putting a backup back ----------

// Replaces the current records of each kind with the snapshot's. Writes go
// straight to the collections (no validation or password hooks), so what was
// saved is exactly what comes back.
async function applySnapshot(data, counts) {
  const byName = new Map(loadBackupModels().map((m) => [m.modelName, m]));
  for (const name of Object.keys(counts)) {
    const Model = byName.get(name);
    if (!Model) continue; // that kind of record no longer exists
    let docs = data[name];
    if (name === 'User') docs = docs.filter((d) => d.role !== 'admin');
    await Model.collection.deleteMany(scopeOf(name));
    if (docs.length) await Model.collection.insertMany(docs, { ordered: true });
  }
}

// Restores a backup. Order of events:
//   1. read and check the backup (nothing is changed if it is damaged)
//   2. take a safety backup of the current data (nothing is changed if that fails)
//   3. replace the data
//   4. if step 3 fails halfway, put the safety backup back
// Returns { backup, safety }. On failure throws an Error with .rolledBack set.
async function restoreBackup({ backupId, actor }) {
  const snapshot = await loadSnapshot(backupId);
  const safety = await createBackup({ type: 'safety', actor });

  try {
    await applySnapshot(snapshot.data, snapshot.backup.counts);
  } catch (err) {
    const failure = new Error(err.message || 'The restore failed.');
    failure.safetyBackupId = String(safety._id);
    try {
      const back = await loadSnapshot(safety._id);
      await applySnapshot(back.data, back.backup.counts);
      failure.rolledBack = true;
    } catch (rollbackErr) {
      console.error('Rollback after a failed restore failed:', rollbackErr.message);
      failure.rolledBack = false;
    }
    throw failure;
  }
  return { backup: snapshot.backup, safety };
}

module.exports = { createBackup, restoreBackup, loadSnapshot, buildDownload, pruneOld, LIMITS, KEEP, USER_TRANSIENT_FIELDS };