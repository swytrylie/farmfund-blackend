const { body } = require('express-validator');

/**
 * Password rule for creating an account:
 *   - 8 to 64 characters (bcrypt only reads the first 72 bytes, so a longer
 *     password would silently be cut short),
 *   - only the characters on a standard keyboard: letters, numbers and
 *     symbols, NO spaces (printable ASCII, 0x21 to 0x7E),
 *   - at least one letter, one number and one symbol.
 * This is the same rule the sign-up form checks while the person types. Each
 * check stops at the first failure so the message names ONE thing to fix.
 */
const passwordRule = body('password')
  .isString()
  .withMessage('Password is required')
  .bail()
  .isLength({ min: 8 })
  .withMessage('Password must be at least 8 characters')
  .bail()
  .isLength({ max: 64 })
  .withMessage('Password must be 64 characters or fewer')
  .bail()
  .matches(/^[\x21-\x7E]+$/)
  .withMessage('Password can only use letters, numbers and symbols from the keyboard — no spaces or accented/emoji characters')
  .bail()
  .matches(/[A-Za-z]/)
  .withMessage('Password must contain at least one letter')
  .bail()
  .matches(/[0-9]/)
  .withMessage('Password must contain at least one number')
  .bail()
  .matches(/[^A-Za-z0-9]/)
  .withMessage('Password must contain at least one symbol (for example ! @ # $ %)');

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
// Organization names: letters and numbers from any language, plus spaces and
// the punctuation real names use (apostrophes, & , . ( ) / # -). No < or > or
// other markup characters.
const ORG_NAME_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '’.,&()/#-]*$/u;

const registerRules = [
  body('firstName').trim().notEmpty().withMessage('firstName is required').isLength({ max: 50 }).matches(NAME_PATTERN).withMessage('firstName can only contain letters, spaces, apostrophes, hyphens and periods'),
  body('lastName').trim().notEmpty().withMessage('lastName is required').isLength({ max: 50 }).matches(NAME_PATTERN).withMessage('lastName can only contain letters, spaces, apostrophes, hyphens and periods'),
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  passwordRule,
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).matches(PHONE_PATTERN).withMessage('phone can only contain digits, spaces and + ( ) . -'),
  // Optional — sent only for an Organization sign-up, and the same endpoint
  // serves both account types. Missing/null means an Individual sign-up; if it
  // IS sent it must not be blank, so a spaces-only name is refused rather than
  // quietly creating an account with no organization.
  body('orgName').optional({ values: 'null' }).trim().notEmpty().withMessage('orgName cannot be blank if provided').isLength({ max: 150 }).withMessage('orgName must be 150 characters or fewer').matches(ORG_NAME_PATTERN).withMessage("orgName can only contain letters, numbers, spaces and these symbols: ' & , . ( ) / # -"),
  // Consent: the Terms and Conditions box must have been ticked. Strictly the
  // boolean true — the string "true", 1 and so on do not count.
  body('acceptedTerms').custom((v) => v === true).withMessage('You must agree to the Terms and Conditions to create an account'),
  body('termsVersion').optional({ values: 'falsy' }).isString().trim().matches(/^[0-9A-Za-z._-]{1,20}$/).withMessage('termsVersion is not valid'),
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