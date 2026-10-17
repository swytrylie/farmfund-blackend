const mongoose = require('mongoose');
const LoanPayment = require('../models/LoanPayment');
const Loan = require('../models/Loan');
const ApiError = require('./ApiError');
const { round2, totalPayable } = require('./loanBalance');

const ACTIVE_LIKE = ['active', 'grace_period', 'defaulted']; // payments still make sense on these

/**
 * recordLoanPayment
 * -----------------
 * The one place money is added to a loan. Used when staff type a payment in
 * by hand AND when staff verify a farmer's proof of payment, so both follow
 * exactly the same rules.
 *
 * Everything is read and written inside one transaction, and the loan
 * document is always written to at the end — so two payments recorded at the
 * same instant conflict with each other and one retries against the other's
 * result, instead of both checking "does this fit?" against the same stale
 * total and together overpaying the loan.
 *
 * `inside(session, payment)` is optional. It runs in that same transaction
 * right after the payment is created, so a caller can change something else
 * (mark a proof as verified) and have both succeed or fail together.
 *
 * Returns { payment, loanStatus, amountPaid, remainingBalance }.
 */
async function recordLoanPayment({ loanId, amount, method, paymentDate, recordedBy, inside }) {
  const session = await mongoose.startSession();
  let payment, amountPaid, remainingBalance, loanStatus;

  try {
    await session.withTransaction(async () => {
      const fresh = await Loan.findById(loanId).session(session);
      if (!fresh) throw ApiError.notFound('Loan not found');
      if (!ACTIVE_LIKE.includes(fresh.status)) {
        throw ApiError.badRequest(`Payments can only be recorded on active loans (this loan is ${fresh.status})`);
      }

      const payable = totalPayable(fresh);
      const sums = await LoanPayment.aggregate([
        { $match: { loan: fresh._id } },
        { $group: { _id: null, paid: { $sum: '$amount' } } },
      ]).session(session);
      const paidBefore = round2(sums[0]?.paid || 0);
      const remainingBefore = round2(payable - paidBefore);

      if (amount > remainingBefore + 0.001) {
        throw ApiError.badRequest(`This payment is more than the remaining balance of ₱${remainingBefore.toFixed(2)}`);
      }

      const created = await LoanPayment.create([{ loan: fresh._id, amount, method, paymentDate, recordedBy }], { session });
      payment = created[0];

      amountPaid = round2(paidBefore + amount);
      remainingBalance = Math.max(0, round2(payable - amountPaid));
      const paidOff = remainingBalance <= 0.001;
      loanStatus = paidOff ? 'paid_off' : fresh.status;

      await Loan.updateOne(
        { _id: fresh._id },
        { $set: { updatedAt: new Date(), ...(paidOff ? { status: 'paid_off' } : {}) } },
        { session }
      );

      if (inside) await inside(session, payment);
    });
  } finally {
    await session.endSession();
  }

  return { payment, loanStatus, amountPaid, remainingBalance };
}

module.exports = { recordLoanPayment, ACTIVE_LIKE };