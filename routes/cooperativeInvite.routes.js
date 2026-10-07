const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const {
  createInviteRules,
  listInvitesRules,
  inviteIdRule,
  tokenRule,
  acceptInviteRules,
} = require('../validators/cooperativeInvite.validator');
const {
  createInvite,
  listInvites,
  revokeInvite,
  getInviteByToken,
  acceptInvite,
} = require('../controllers/cooperativeInvite.controller');

const router = express.Router();

// Authenticated — a cooperative's own staff managing invites
router.post('/', protect, createInviteRules, handleValidationErrors, asyncHandler(createInvite));
router.get('/', protect, listInvitesRules, handleValidationErrors, asyncHandler(listInvites));
router.delete('/:id', protect, inviteIdRule, handleValidationErrors, asyncHandler(revokeInvite));

// PUBLIC — the invitee has no account yet, so no session can exist
router.get('/:token', tokenRule, handleValidationErrors, asyncHandler(getInviteByToken));
router.post('/:token/accept', acceptInviteRules, handleValidationErrors, asyncHandler(acceptInvite));

module.exports = router;