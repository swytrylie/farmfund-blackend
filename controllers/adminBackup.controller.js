const Backup = require('../models/Backup');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { recordAudit } = require('../utils/audit');
const { createBackup, restoreBackup, buildDownload } = require('../utils/backup');

const TYPE_LABEL = { manual: 'Manual', scheduled: 'Scheduled', safety: 'Before a restore' };

// The automatic backup runs once a day at 19:00 UTC = 3:00 AM Manila time (see
// vercel.json). It only really runs if CRON_SECRET is set on the server.
const SCHEDULE_HOUR_UTC = 19;

function nextScheduledAt(now) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SCHEDULE_HOUR_UTC, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

// "Oct 13, 2026, 1:05 AM" in Philippine time, for the Audit Logs.
function manilaLabel(date) {
  return new Date(date).toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toRow(b) {
  return {
    id: String(b._id),
    type: b.type,
    typeLabel: TYPE_LABEL[b.type] || b.type,
    status: b.status,
    at: b.createdAt,
    sizeBytes: b.sizeBytes || 0,
    totalRecords: b.totalRecords || 0,
    createdBy: b.createdByName || (b.type === 'scheduled' ? 'Automatic' : '—'),
    error: b.status === 'failed' ? b.error || 'The backup failed.' : null,
  };
}

// GET /api/admin/backups?page=&limit=
// Newest first, plus the three numbers shown at the top of the page.
async function listBackups(req, res) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;

  const [total, rows, lastRows, stored] = await Promise.all([
    Backup.countDocuments({}),
    Backup.find({}).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Backup.find({ status: 'completed' }).sort({ createdAt: -1, _id: -1 }).limit(1).lean(),
    Backup.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, bytes: { $sum: '$sizeBytes' }, count: { $sum: 1 } } },
    ]),
  ]);

  const scheduleEnabled = Boolean(process.env.CRON_SECRET);
  new ApiResponse(200, {
    backups: rows.map(toRow),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    summary: {
      lastBackup: lastRows[0] ? toRow(lastRows[0]) : null,
      scheduleEnabled,
      nextScheduledAt: scheduleEnabled ? nextScheduledAt(new Date()).toISOString() : null,
      storedBytes: stored[0] ? stored[0].bytes : 0,
      storedCount: stored[0] ? stored[0].count : 0,
    },
  }, 'Backups fetched').send(res);
}

// POST /api/admin/backups  — "Run Backup Now". Finishes before the answer is sent.
async function runBackup(req, res) {
  const backup = await createBackup({ type: 'manual', actor: req.user });

  await recordAudit(req.user, 'backup.create', {
    targetType: 'backup',
    targetId: backup._id,
    targetLabel: manilaLabel(backup.createdAt),
    details: { type: 'manual', totalRecords: backup.totalRecords, sizeBytes: backup.sizeBytes },
  });

  new ApiResponse(201, { backup: toRow(backup) }, 'Backup completed').send(res);
}

// GET /api/admin/backups/:id/download
async function downloadBackup(req, res) {
  const { backup, file } = await buildDownload(req.params.id);

  await recordAudit(req.user, 'backup.download', {
    targetType: 'backup',
    targetId: backup._id,
    targetLabel: manilaLabel(backup.createdAt),
    details: { type: backup.type },
  });

  const stamp = new Date(backup.createdAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  new ApiResponse(200, { filename: `farmfund-backup-${stamp}.json`, file }, 'Backup ready to download').send(res);
}

// POST /api/admin/backups/:id/restore   { confirm: 'RESTORE' }
async function restore(req, res) {
  let result;
  try {
    result = await restoreBackup({ backupId: req.params.id, actor: req.user });
  } catch (err) {
    // The restore started but did not finish: record it, then say what state things are in.
    if (err && err.safetyBackupId) {
      await recordAudit(req.user, 'backup.restore_failed', {
        targetType: 'backup',
        targetId: req.params.id,
        targetLabel: 'Restore failed',
        details: { rolledBack: err.rolledBack === true, safetyBackupId: err.safetyBackupId },
      });
      throw ApiError.internal(
        err.rolledBack
          ? 'The restore failed halfway, so your data was put back the way it was before. Nothing was lost.'
          : 'The restore failed halfway and the automatic undo also failed. A safety backup was saved just before — restore that one now.'
      );
    }
    // Stopped before anything was touched (missing or damaged backup, or the safety backup failed).
    if (err && err.isOperational) throw new ApiError(err.statusCode, `Nothing was changed. ${err.message}`);
    throw err;
  }

  await recordAudit(req.user, 'backup.restore', {
    targetType: 'backup',
    targetId: result.backup._id,
    targetLabel: manilaLabel(result.backup.createdAt),
    details: { totalRecords: result.backup.totalRecords, safetyBackupId: String(result.safety._id) },
  });

  new ApiResponse(200, {
    restoredFrom: toRow(result.backup),
    safetyBackup: toRow(result.safety),
  }, 'Backup restored').send(res);
}

module.exports = { listBackups, runBackup, downloadBackup, restore, nextScheduledAt, manilaLabel };