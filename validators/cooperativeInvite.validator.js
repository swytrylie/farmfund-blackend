const { body, param, query } = require('express-validator');

// Same name rule as signup and profile edits: letters from any language,
// spaces, apostrophes (straight and curly), hyphens and periods — checked, not
// HTML-escaped (escaping saved "O'Brien" as "O&#x27;Brien").
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$/u;

const createInviteRules = [
  body('cooperative').isMongoId().withMessage('A valid cooperative id is required'),
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('role').isIn(['finance_manager', 'member']).withMessage('role must be finance_manager or member'),
];

const listInvitesRules = [
  query('cooperative').isMongoId().withMessage('A valid cooperative id is required'),
];

const inviteIdRule = [param('id').isMongoId().withMessage('Invalid invite id')];

const tokenRule = [param('token').isHexadecimal().isLength({ min: 64, max: 64 }).withMessage('Invalid invite token')];

const acceptInviteRules = [
  param('token').isHexadecimal().isLength({ min: 64, max: 64 }).withMessage('Invalid invite token'),
  body('firstName').trim().notEmpty().withMessage('First name is required').isLength({ max: 50 }).matches(NAME_PATTERN).withMessage('First name can only contain letters, spaces, apostrophes, hyphens and periods'),
  body('lastName').trim().notEmpty().withMessage('Last name is required').isLength({ max: 50 }).matches(NAME_PATTERN).withMessage('Last name can only contain letters, spaces, apostrophes, hyphens and periods'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Za-z]/)
    .withMessage('Password must contain at least one letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number'),
];

module.exports = { createInviteRules, listInvitesRules, inviteIdRule, tokenRule, acceptInviteRules };