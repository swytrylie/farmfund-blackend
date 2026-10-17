const crypto = require('crypto');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { syncLoanStages } = require('../utils/loanStages');

// GET /api/cron/loans — called once a day by Vercel's scheduler (see vercel.json).
// Moves crop loans into and out of their grace period and announces calamity
// freezes that have ended. Vercel sends "Authorization: Bearer <CRON_SECRET>";
// anything else is refused, so nobody can trigger it from the outside.
async function runLoanStages(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new ApiError(503, 'Scheduled loan updates are not set up (CRON_SECRET is missing).');

  const given = Buffer.from(String(req.get('authorization') || ''));
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw ApiError.unauthorized('Not allowed.');
  }

  const result = await syncLoanStages({});
  new ApiResponse(200, result, 'Loan stages updated').send(res);
}

module.exports = { runLoanStages };
