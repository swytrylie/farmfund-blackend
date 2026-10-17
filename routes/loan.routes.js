const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { uploadCertificateFile } = require('../middleware/uploadCertificate');
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
  loanOptions,
  collateralLink,
} = require('../controllers/loan.controller');

const router = express.Router();

// A farmer can request, view their own, and list their own loans. A request
// is a form with a file (the proof of the collateral), so the upload is read
// before the rest of the form is checked.
router.post('/', protect, uploadCertificateFile, createLoanRules, handleValidationErrors, asyncHandler(createLoan));
router.get('/', protect, listLoansRules, handleValidationErrors, asyncHandler(getLoans));
router.get('/options', protect, asyncHandler(loanOptions)); // before '/:id' so "options" is never taken for an id
router.get('/:id/collateral/link', protect, loanIdRule, handleValidationErrors, asyncHandler(collateralLink));
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