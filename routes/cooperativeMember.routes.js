const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { listCooperativeMembersRules } = require('../validators/cooperativeMember.validator');
const { listCooperativeMembers } = require('../controllers/cooperativeMember.controller');

const router = express.Router();

router.get('/', protect, listCooperativeMembersRules, handleValidationErrors, asyncHandler(listCooperativeMembers));

module.exports = router;