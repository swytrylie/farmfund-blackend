const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { get, save } = require('../controllers/creditLimit.controller');
const { lookupRules, saveRules } = require('../validators/creditLimit.validator');

const router = express.Router();

// Any signed-in account; the controller only lets that cooperative's owner (change)
// or owner / finance manager (view) through.
router.use(protect);

router.get('/', lookupRules, handleValidationErrors, asyncHandler(get));
router.put('/', saveRules, handleValidationErrors, asyncHandler(save));

module.exports = router;