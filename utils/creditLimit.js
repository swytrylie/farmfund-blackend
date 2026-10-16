const Certificate = require('../models/Certificate');
const Loan = require('../models/Loan');
const LoanPayment = require('../models/LoanPayment');
const { totalPayable } = require('./loanBalance');

/**
 * Credit limit
 * ------------
 * A farmer's limit is not stored anywhere - it is worked out from their
 * documents each time, so it can never drift out of step with them:
 *
 *   - a VERIFIED Barangay Certificate  -> PHP 25,000
 *   - anything else (none, pending, rejected, or deleted) -> PHP 0
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
const OPEN_STATUSES = ['pending', 'approved', 'active', 'defaulted'];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function creditFor(farmerId) {
  const certs = await Certificate.find({ farmer: farmerId, type: 'barangay_certificate' }).select('status').lean();
  const statuses = certs.map((c) => c.status);
  let barangayStatus = 'none';
  if (statuses.includes('verified')) barangayStatus = 'verified';
  else if (statuses.includes('pending')) barangayStatus = 'pending';
  else if (statuses.includes('rejected')) barangayStatus = 'rejected';

  const limit = barangayStatus === 'verified' ? VERIFIED_LIMIT : 0;

  const loans = await Loan.find({ farmer: farmerId, status: { $in: OPEN_STATUSES } })
    .select('principalAmount interestRatePercent termMonths')
    .lean();
  const sums = loans.length
    ? await LoanPayment.aggregate([
        { $match: { loan: { $in: loans.map((l) => l._id) } } },
        { $group: { _id: '$loan', paid: { $sum: '$amount' } } },
      ])
    : [];
  const paidByLoan = new Map(sums.map((x) => [String(x._id), x.paid]));
  const used = round2(
    loans.reduce((sum, l) => {
      const principal = Number(l.principalAmount) || 0;
      const payable = totalPayable(l);
      if (payable <= 0) return sum;
      const unpaidShare = Math.min(1, Math.max(0, (payable - (paidByLoan.get(String(l._id)) || 0)) / payable));
      return sum + principal * unpaidShare;
    }, 0)
  );
  const available = Math.max(0, round2(limit - used));

  return { limit, used, available, barangayStatus };
}

module.exports = { creditFor, VERIFIED_LIMIT, OPEN_STATUSES };