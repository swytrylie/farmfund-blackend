const Certificate = require('../models/Certificate');
const Loan = require('../models/Loan');
const LoanPayment = require('../models/LoanPayment');
const CoopCreditLimit = require('../models/CoopCreditLimit');
const { totalPayable } = require('./loanBalance');

/**
 * Credit limit
 * ------------
 * A farmer's limit is worked out from their documents (and, for one
 * cooperative, from a number its owner chose) each time, so it never drifts
 * out of step with them:
 *
 *   - a VERIFIED Barangay Certificate  -> the standard limit, PHP 25,000
 *   - anything else (none, pending, rejected, or deleted) -> PHP 0, always
 *   - a cooperative's OWNER may replace the standard limit with their own
 *     number for that farmer, but only for loans with THAT cooperative (see
 *     CoopCreditLimit). It still needs the verified certificate.
 *
 * So there can be several "pools":
 *   - one for each cooperative that set a custom limit (that cooperative's
 *     loans only), and
 *   - the standard pool: every other loan of the farmer, against PHP 25,000.
 *
 * Income certificates are supporting evidence only and do not change it.
 * "Used" is what the farmer still owes of the money they borrowed, across every
 * loan that counts (waiting for a decision, approved, running, or in default).
 * Each payment frees credit as it is made: a loan's used share is its principal
 * times the part of its total (principal + interest) that is still unpaid. So a
 * PHP 10,000 loan that is half repaid uses PHP 5,000 of the limit, and a loan
 * that is paid off or rejected uses nothing. A request that has not been paid
 * on yet uses its full principal.
 */
const VERIFIED_LIMIT = 25000;
const OPEN_STATUSES = ['pending_admin', 'pending', 'approved', 'active', 'grace_period', 'defaulted'];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// What each open loan of the farmer still uses of a limit, with the cooperative it belongs to.
async function usedByLoan(farmerId) {
  const loans = await Loan.find({ farmer: farmerId, status: { $in: OPEN_STATUSES } })
    .select('principalAmount interestRatePercent termMonths rateBasis cooperative')
    .lean();
  const sums = loans.length
    ? await LoanPayment.aggregate([
        { $match: { loan: { $in: loans.map((l) => l._id) } } },
        { $group: { _id: '$loan', paid: { $sum: '$amount' } } },
      ])
    : [];
  const paidByLoan = new Map(sums.map((x) => [String(x._id), x.paid]));
  return loans.map((l) => {
    const principal = Number(l.principalAmount) || 0;
    const payable = totalPayable(l);
    let used = 0;
    if (payable > 0) {
      const unpaidShare = Math.min(1, Math.max(0, (payable - (paidByLoan.get(String(l._id)) || 0)) / payable));
      used = principal * unpaidShare;
    }
    return { coop: String(l.cooperative), used };
  });
}

const pool = (limit, used) => ({ limit, used: round2(used), available: Math.max(0, round2(limit - used)) });

/**
 * creditFor(farmerId, cooperativeId?)
 *   limit / used / available - the pool that applies to a loan with `cooperativeId`
 *                              (the cooperative's own pool if its owner set a
 *                              limit, otherwise the standard pool; without a
 *                              cooperative, always the standard pool)
 *   barangayStatus           - none | pending | rejected | verified
 *   custom                   - true when the numbers above are a cooperative's own limit
 *   byCooperative            - every cooperative-set limit the farmer has:
 *                              [{ cooperativeId, cooperativeName, limit, used, available }]
 */
async function creditFor(farmerId, cooperativeId) {
  const certs = await Certificate.find({ farmer: farmerId, type: 'barangay_certificate' }).select('status').lean();
  const statuses = certs.map((c) => c.status);
  let barangayStatus = 'none';
  if (statuses.includes('verified')) barangayStatus = 'verified';
  else if (statuses.includes('pending')) barangayStatus = 'pending';
  else if (statuses.includes('rejected')) barangayStatus = 'rejected';
  const verified = barangayStatus === 'verified';

  const custom = await CoopCreditLimit.find({ farmer: farmerId }).populate('cooperative', 'name').lean();
  const customByCoop = new Map(custom.map((c) => [String((c.cooperative && c.cooperative._id) || c.cooperative), c]));

  const loans = await usedByLoan(farmerId);

  // The standard pool: loans with cooperatives that did NOT set their own limit.
  const standardUsed = loans.filter((l) => !customByCoop.has(l.coop)).reduce((s, l) => s + l.used, 0);
  const standard = pool(verified ? VERIFIED_LIMIT : 0, standardUsed);

  const byCooperative = custom.map((c) => {
    const coopId = String((c.cooperative && c.cooperative._id) || c.cooperative);
    const used = loans.filter((l) => l.coop === coopId).reduce((s, l) => s + l.used, 0);
    return {
      cooperativeId: coopId,
      cooperativeName: (c.cooperative && c.cooperative.name) || null,
      ...pool(verified ? c.limit : 0, used),
      setLimit: c.limit,
    };
  });

  const own = cooperativeId ? byCooperative.find((c) => c.cooperativeId === String(cooperativeId)) : null;
  if (own) {
    const { limit, used, available } = own;
    return { limit, used, available, barangayStatus, custom: true, byCooperative };
  }
  return { ...standard, barangayStatus, custom: false, byCooperative };
}

// What the farmer still owes ONE cooperative, in the same "used share" terms as the limit.
async function outstandingWith(farmerId, cooperativeId) {
  const loans = await usedByLoan(farmerId);
  return round2(loans.filter((l) => l.coop === String(cooperativeId)).reduce((s, l) => s + l.used, 0));
}

module.exports = { creditFor, outstandingWith, VERIFIED_LIMIT, OPEN_STATUSES };