const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const {
  createLoanRules,
  loanIdRule,
  updateLoanStatusRules,
  listLoansRules,
} = require('../validators/loan.validator');
const {
  createLoan,
  getLoans,
  getLoanById,
  updateLoanStatus,
} = require('../controllers/loan.controller');

const router = express.Router();

// A farmer can request, view their own, and list their own loans.
router.post('/', protect, createLoanRules, handleValidationErrors, asyncHandler(createLoan));
router.get('/', protect, listLoansRules, handleValidationErrors, asyncHandler(getLoans));
router.get('/:id', protect, loanIdRule, handleValidationErrors, asyncHandler(getLoanById));

// Only that loan's cooperative staff (or an admin) can move it past
// pending — checked inside the controller (assertCooperativeStaffOrAdmin),
// since it depends on WHICH cooperative this specific loan belongs to, not
// a role that can be checked before the loan is even loaded.
router.patch(
  '/:id/status',
  protect,
  updateLoanStatusRules,
  handleValidationErrors,
  asyncHandler(updateLoanStatus)
);

module.exports = router;