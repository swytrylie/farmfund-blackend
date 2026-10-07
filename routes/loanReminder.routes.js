const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { createLoanReminderRules, listLoanRemindersRules } = require('../validators/loanReminder.validator');
const { createLoanReminder, getLoanReminders } = require('../controllers/loanReminder.controller');

const router = express.Router();

router.get('/', protect, listLoanRemindersRules, handleValidationErrors, asyncHandler(getLoanReminders));
router.post('/', protect, createLoanReminderRules, handleValidationErrors, asyncHandler(createLoanReminder));

module.exports = router;