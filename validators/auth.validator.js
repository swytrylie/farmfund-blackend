const { body } = require('express-validator');

/**
 * Password rule: minimum 8 characters, at least one letter and one
 * number. Long enough to resist brute force, simple enough not to
 * frustrate real users into picking worse passwords elsewhere.
 */
const passwordRule = body('password')
  .isLength({ min: 8 })
  .withMessage('Password must be at least 8 characters')
  .matches(/[A-Za-z]/)
  .withMessage('Password must contain at least one letter')
  .matches(/[0-9]/)
  .withMessage('Password must contain at least one number');

// Text fields are CHECKED against what they may contain, not HTML-escaped on
// the way in. Escaping before storing was corrupting real data — "O'Brien"
// was saved as "O&#x27;Brien" and "Smith & Sons" as "Smith &amp; Sons" — and
// it's the wrong layer anyway: React escapes everything it displays, and the
// emails escape names at the point they're written into the message. So the
// stored value is exactly what the person typed.
//
// Names allow letters from any language (so "Peña" and "Muñoz" work), spaces,
// apostrophes (straight and curly), hyphens and periods — nothing else.
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$/u; // a plain space only — \s would also allow tabs and line breaks
const PHONE_PATTERN = /^[0-9+() .-]+$/;

const registerRules = [
  body('firstName').trim().notEmpty().withMessage('firstName is required').isLength({ max: 50 }).matches(NAME_PATTERN).withMessage('firstName can only contain letters, spaces, apostrophes, hyphens and periods'),
  body('lastName').trim().notEmpty().withMessage('lastName is required').isLength({ max: 50 }).matches(NAME_PATTERN).withMessage('lastName can only contain letters, spaces, apostrophes, hyphens and periods'),
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  passwordRule,
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).matches(PHONE_PATTERN).withMessage('phone can only contain digits, spaces and + ( ) . -'),
  // Optional — present only for an Organization sign-up. Kept separate from
  // a required orgName check, since this same endpoint serves both account
  // types depending on whether orgName was sent at all.
  body('orgName').optional({ values: 'falsy' }).trim().notEmpty().withMessage('orgName cannot be blank if provided').isLength({ max: 150 }).custom((v) => !/[<>]/.test(v)).withMessage('orgName cannot contain < or >'),
];

const loginRules = [
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

const updateProfileRules = [
  body('firstName').optional().trim().notEmpty().withMessage('firstName cannot be blank').isLength({ max: 50 }).matches(NAME_PATTERN).withMessage('firstName can only contain letters, spaces, apostrophes, hyphens and periods'),
  body('lastName').optional().trim().notEmpty().withMessage('lastName cannot be blank').isLength({ max: 50 }).matches(NAME_PATTERN).withMessage('lastName can only contain letters, spaces, apostrophes, hyphens and periods'),
  body('email').optional().trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).matches(PHONE_PATTERN).withMessage('phone can only contain digits, spaces and + ( ) . -'),
];

// Same strength rule as passwordRule above, just bound to a different field
// name (newPassword, not password) — express-validator's body() is tied to
// one specific field, so this can't be the same rule object reused directly.
const changePasswordRules = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Za-z]/)
    .withMessage('Password must contain at least one letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number'),
];

const otpCodeRule = body('code')
  .trim()
  .isLength({ min: 6, max: 6 })
  .withMessage('Code must be 6 digits')
  .isNumeric()
  .withMessage('Code must be numeric');

const verifySignupRules = [
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  otpCodeRule,
];

const resendSignupOtpRules = [
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
];

const verifyPasswordChangeRules = [otpCodeRule];

// Changing the login email: needs the new address and the CURRENT password.
const requestEmailChangeRules = [
  body('newEmail').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

const verifyEmailChangeRules = [otpCodeRule];

// Forgot password — three public steps (the person is not logged in).
const forgotPasswordRules = [
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
];

const verifyForgotPasswordRules = [
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  otpCodeRule,
];

const resetPasswordRules = [
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('resetToken').trim().matches(/^[0-9a-f]{64}$/).withMessage('Reset session is invalid. Please start again.'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Za-z]/)
    .withMessage('Password must contain at least one letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number'),
];

// The "No, secure my account" link from the email-changed notice.
const undoEmailChangeRules = [
  body('token').trim().matches(/^[0-9a-f]{64}$/).withMessage('This link is not valid.'),
];

module.exports = {
  registerRules,
  loginRules,
  updateProfileRules,
  changePasswordRules,
  verifySignupRules,
  resendSignupOtpRules,
  verifyPasswordChangeRules,
  requestEmailChangeRules,
  verifyEmailChangeRules,
  forgotPasswordRules,
  verifyForgotPasswordRules,
  resetPasswordRules,
  undoEmailChangeRules,
};