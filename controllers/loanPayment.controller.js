const mongoose = require('mongoose');
const LoanPayment = require('../models/LoanPayment');
const Loan = require('../models/Loan');
const CooperativeMember = require('../models/CooperativeMember');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { assertCooperativeStaffOrAdmin } = require('../utils/cooperativeMembership');
const { round2, totalPayable } = require('../utils/loanBalance');

// Same viewing rule as loans themselves: an admin, the farmer who
// borrowed, or any active member of the lending cooperative.
// (Duplicated rather than imported from loan.controller.js, matching how
// every other controller in this project keeps its own access helper.)
async function assertCanViewLoan(loan, user) {
  if (user.role === 'admin') return;
  if (String(loan.farmer) === String(user._id)) return;

  const membership = await CooperativeMember.findOne({
    cooperative: loan.cooperative,
    user: user._id,
    status: 'active',
  });
  if (!membership) throw ApiError.forbidden('You do not have access to this resource');
}

const ACTIVE_LIKE = ['active', 'defaulted']; // payments still make sense on these

// POST /api/loan-payments
// Records money the cooperative has actually received on a loan. Only the
// LENDING cooperative's owner or finance_manager (or an admin) may do
// this — never the borrower, who could otherwise "pay" their own loan
// down by simply claiming they did.
async function createLoanPayment(req, res) {
  const { loan: loanId, amount, method, paymentDate } = req.body;

  const loan = await Loan.findById(loanId);
  if (!loan) throw ApiError.notFound('Loan not found');

  await assertCooperativeStaffOrAdmin(loan.cooperative, req.user);

  const session = await mongoose.startSession();
  let payment, amountPaid, remainingBalance, loanStatus;

  try {
    await session.withTransaction(async () => {
      // Everything below is read and written inside one transaction, and
      // the loan document is always written to at the end — so two
      // payments recorded at the same instant conflict with each other
      // and one retries against the other's result, instead of both
      // checking "does this fit?" against the same stale total and
      // together overpaying the loan.
      const fresh = await Loan.findById(loan._id).session(session);
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

      const created = await LoanPayment.create(
        [{ loan: fresh._id, amount, method, paymentDate, recordedBy: req.user._id }],
        { session }
      );
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
    });
  } finally {
    await session.endSession();
  }

  new ApiResponse(201, { payment, loanStatus, amountPaid, remainingBalance }, 'Payment recorded successfully').send(res);
}

// GET /api/loan-payments?loan=<id>          one loan's payments
// GET /api/loan-payments?cooperative=<id>   every payment on that cooperative's loans
// Exactly one of the two is required.
async function getLoanPayments(req, res) {
  const { loan: loanId, cooperative: cooperativeId } = req.query;
  if (Boolean(loanId) === Boolean(cooperativeId)) {
    throw ApiError.badRequest('Provide exactly one of: loan, cooperative');
  }

  const page = req.query.page || 1;
  const limit = req.query.limit || 20;

  let filter;
  if (loanId) {
    const loan = await Loan.findById(loanId);
    if (!loan) throw ApiError.notFound('Loan not found');
    await assertCanViewLoan(loan, req.user);
    filter = { loan: loanId };
  } else {
    if (req.user.role !== 'admin') {
      const membership = await CooperativeMember.findOne({
        cooperative: cooperativeId,
        user: req.user._id,
        status: 'active',
      });
      if (!membership) throw ApiError.forbidden('You do not have access to this resource');
    }
    const loanIds = await Loan.distinct('_id', { cooperative: cooperativeId });
    filter = { loan: { $in: loanIds } };
  }

  const [payments, total] = await Promise.all([
    LoanPayment.find(filter)
      .populate({ path: 'loan', select: 'principalAmount farmer status', populate: { path: 'farmer', select: 'firstName lastName' } })
      .populate('recordedBy', 'firstName lastName')
      .sort({ paymentDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    LoanPayment.countDocuments(filter),
  ]);

  new ApiResponse(200, payments, 'Loan payments retrieved successfully', {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }).send(res);
}

module.exports = { createLoanPayment, getLoanPayments };