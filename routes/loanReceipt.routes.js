const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth');
const { listMine } = require('../controllers/loanReceipt.controller');

const router = express.Router();

// A receipt belongs to the farmer it was issued to: they only ever get their own.
router.use(protect);
router.get('/', asyncHandler(listMine));

module.exports = router;