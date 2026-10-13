const crypto = require('crypto');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { createBackup } = require('../utils/backup');
const { purgeExpired } = require('../utils/archive');

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
  // The same nightly visit also empties the archive of anything past its 30 days.
  // A problem here must never turn a good backup into an error.
  let purgedArchived = 0;
  try {
    purgedArchived = await purgeExpired();
  } catch (err) {
    console.error('Archive clean-up failed:', err.message);
  }

  new ApiResponse(
    200,
    { id: String(backup._id), totalRecords: backup.totalRecords, sizeBytes: backup.sizeBytes, purgedArchived },
    'Scheduled backup completed'
  ).send(res);
}

module.exports = { runScheduledBackup };