const crypto = require('crypto');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { createBackup } = require('../utils/backup');

// GET /api/cron/backup — called once a day by Vercel's scheduler (see
// vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>" with it;
// anything else is refused, so nobody can trigger it from the outside.
async function runScheduledBackup(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new ApiError(503, 'Scheduled backups are not set up (CRON_SECRET is missing).');

  const given = Buffer.from(String(req.get('authorization') || ''));
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw ApiError.unauthorized('Not allowed.');
  }

  const backup = await createBackup({ type: 'scheduled', actor: null });
  new ApiResponse(200, { id: String(backup._id), totalRecords: backup.totalRecords, sizeBytes: backup.sizeBytes }, 'Scheduled backup completed').send(res);
}

module.exports = { runScheduledBackup };