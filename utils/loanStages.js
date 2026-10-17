const Loan = require('../models/Loan');
const LoanPayment = require('../models/LoanPayment');
const CalamityClaim = require('../models/CalamityClaim');
const User = require('../models/User');
const Cooperative = require('../models/Cooperative');
const { GRACE_DAYS, scheduleFor, graceFixFor } = require('./loanTerms');
const { round2, totalPayable } = require('./loanBalance');
const { tellFarmerGrace, tellFarmerFreezeEnded } = require('./stageNotices');

/**
 * Loan stages
 * -----------
 * A crop loan moves through time on its own:
 *
 *   active --(harvest day)--> grace_period --(15 days later)--> active again
 *
 * During the grace period the farmer can pay at any time and nothing extra is
 * charged. After it, the loan is simply an active loan whose due date has come
 * (the normal overdue rules apply). Nobody sets grace_period by hand.
 *
 * This runs in two places: once a day from the scheduler (routes/cron), and
 * every time loans are loaded, for just the loans being loaded, so a screen is
 * never out of date even if the scheduler has not run yet.
 *
 * Each change is made with a guard on the status it expects ("only if still
 * active"), so two runs at the same moment cannot both make it, and the
 * farmer is told exactly once. Nothing in here ever throws: reading a loan
 * list must not fail because of a stage update.
 *
 * It also finishes two clean-ups: loans approved when the grace period was 2
 * days get the 15-day due date (only when their due date is still the old
 * automatic one), and a calamity freeze that has run out is announced to the
 * farmer once.
 */
const CANDIDATE_STATUSES = ['approved', 'active', 'grace_period'];
const SELECT = 'status issuedDate dueDate growingDays delayDays graceDays farmer cooperative principalAmount interestRatePercent termMonths rateBasis crop';

async function remainingOf(loan) {
  const sums = await LoanPayment.aggregate([{ $match: { loan: loan._id } }, { $group: { _id: null, paid: { $sum: '$amount' } } }]);
  return round2(Math.max(0, totalPayable(loan) - round2((sums[0] && sums[0].paid) || 0)));
}

// scope: { farmer }, { cooperative } or { loan } narrows the work; {} means every loan.
async function syncLoanStages(scope = {}, now = new Date()) {
  const result = { graceStarted: 0, graceEnded: 0, dueDatesFixed: 0, freezesEnded: 0 };
  try {
    const where = { status: { $in: CANDIDATE_STATUSES }, growingDays: { $gt: 0 }, issuedDate: { $exists: true } };
    if (scope.farmer) where.farmer = scope.farmer;
    if (scope.cooperative) where.cooperative = scope.cooperative;
    if (scope.loan) where._id = scope.loan;
    const loans = await Loan.find(where).select(SELECT).lean();

    for (const loan of loans) {
      try {
        // 1. Loans approved under the old 2-day rule get the 15-day due date.
        if (loan.graceDays !== GRACE_DAYS) {
          const fixed = graceFixFor(loan);
          const set = fixed ? { graceDays: GRACE_DAYS, dueDate: fixed } : { graceDays: GRACE_DAYS };
          const done = await Loan.findOneAndUpdate({ _id: loan._id, graceDays: { $ne: GRACE_DAYS } }, { $set: set }, { new: true }).lean();
          if (done) {
            loan.graceDays = GRACE_DAYS;
            if (fixed) {
              loan.dueDate = fixed;
              result.dueDatesFixed += 1;
            }
          }
        }

        const sched = scheduleFor(loan);
        if (!sched) continue;

        // 2. Harvest day: an active loan enters its grace period.
        if (loan.status === 'active' && now >= sched.harvestAt && now <= sched.graceEndsAt) {
          const done = await Loan.findOneAndUpdate({ _id: loan._id, status: 'active' }, { $set: { status: 'grace_period', graceStartedAt: now } }, { new: true }).lean();
          if (done) {
            result.graceStarted += 1;
            const [farmer, coop, remaining] = await Promise.all([
              User.findById(done.farmer).select('firstName lastName email').lean(),
              Cooperative.findById(done.cooperative).select('name').lean(),
              remainingOf(done),
            ]);
            await tellFarmerGrace(done, farmer, coop, { remaining, dueDate: sched.graceEndsAt });
          }
        // 3. The grace period is over: back to an ordinary active loan.
        } else if (loan.status === 'grace_period' && now > sched.graceEndsAt) {
          const done = await Loan.findOneAndUpdate({ _id: loan._id, status: 'grace_period' }, { $set: { status: 'active' } }, { new: true }).lean();
          if (done) result.graceEnded += 1;
        }
      } catch (err) {
        console.error('Could not update a loan stage:', err && err.message);
      }
    }

    // 4. A calamity freeze that ran out: tell the farmer, once.
    const claimWhere = { 'freeze.endsAt': { $lte: now }, 'freeze.endNotifiedAt': { $exists: false } };
    if (scope.farmer) claimWhere.farmer = scope.farmer;
    if (scope.cooperative) claimWhere.cooperative = scope.cooperative;
    if (scope.loan) claimWhere.loan = scope.loan;
    const ended = await CalamityClaim.find(claimWhere).lean();
    for (const claim of ended) {
      try {
        const taken = await CalamityClaim.findOneAndUpdate({ _id: claim._id, 'freeze.endNotifiedAt': { $exists: false } }, { $set: { 'freeze.endNotifiedAt': now } }, { new: true }).lean();
        if (!taken) continue;
        const loan = await Loan.findById(claim.loan).lean();
        if (!loan || loan.status === 'paid_off') continue;
        result.freezesEnded += 1;
        const [farmer, coop] = await Promise.all([
          User.findById(claim.farmer).select('firstName lastName email').lean(),
          Cooperative.findById(claim.cooperative).select('name').lean(),
        ]);
        await tellFarmerFreezeEnded(claim, loan, farmer, coop);
      } catch (err) {
        console.error('Could not finish a calamity freeze:', err && err.message);
      }
    }
  } catch (err) {
    console.error('Could not update loan stages:', err && err.message);
  }
  return result;
}

module.exports = { syncLoanStages };
