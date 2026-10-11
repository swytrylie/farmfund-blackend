const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { listCooperativeMembersRules, memberIdRule } = require('../validators/cooperativeMember.validator');
const { listCooperativeMembers, removeMember } = require('../controllers/cooperativeMember.controller');

const router = express.Router();

router.get('/', protect, listCooperativeMembersRules, handleValidationErrors, asyncHandler(listCooperativeMembers));
router.delete('/:id', protect, memberIdRule, handleValidationErrors, asyncHandler(removeMember));

module.exports = router;