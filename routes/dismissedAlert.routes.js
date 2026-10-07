const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { dismissAlertRules } = require('../validators/dismissedAlert.validator');
const { listDismissedAlerts, dismissAlert } = require('../controllers/dismissedAlert.controller');

const router = express.Router();

router.get('/', protect, asyncHandler(listDismissedAlerts));
router.post('/', protect, dismissAlertRules, handleValidationErrors, asyncHandler(dismissAlert));

module.exports = router;