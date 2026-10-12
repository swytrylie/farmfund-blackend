const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { getPublicStatus } = require('../controllers/system.controller');

const router = express.Router();

// Public on purpose: the app asks before anyone has signed in.
router.get('/status', asyncHandler(getPublicStatus));

module.exports = router;