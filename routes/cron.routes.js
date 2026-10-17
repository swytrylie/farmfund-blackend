const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { runScheduledBackup } = require('../controllers/backupCron.controller');
const { runLoanStages } = require('../controllers/loanCron.controller');

const router = express.Router();

// Not behind the normal sign-in: the scheduler has no account. The route
// checks its own secret instead.
router.get('/backup', asyncHandler(runScheduledBackup));
router.get('/loans', asyncHandler(runLoanStages));

module.exports = router;