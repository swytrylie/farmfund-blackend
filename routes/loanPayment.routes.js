const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { listLoanPaymentsRules, createLoanPaymentRules } = require('../validators/loanPayment.validator');
const { createLoanPayment, getLoanPayments } = require('../controllers/loanPayment.controller');

const router = express.Router();

router.get('/', protect, listLoanPaymentsRules, handleValidationErrors, asyncHandler(getLoanPayments));
router.post('/', protect, createLoanPaymentRules, handleValidationErrors, asyncHandler(createLoanPayment));

module.exports = router;