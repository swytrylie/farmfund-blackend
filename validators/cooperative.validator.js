const { body, param, query } = require('express-validator');

// Text is CHECKED against what it may contain, never HTML-escaped on the way
// in: escaping turned "Smith & Sons" into "Smith &amp; Sons" in the database.
// React escapes whatever it displays, and emails escape at the point of
// writing, so what's stored is exactly what was typed. A registration number
// is a structured value, so it gets an allowlist (slashes are common in them).
const REGISTRATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./#_()-]*$/;
const PHONE_PATTERN = /^[0-9+() .-]+$/;

const listCooperativesRules = [
  query('status').optional().isIn(['pending', 'active', 'rejected']).withMessage('Invalid status value'),
];

const cooperativeIdRule = [param('id').isMongoId().withMessage('Invalid cooperative id')];

const updateCooperativeRules = [
  param('id').isMongoId().withMessage('Invalid cooperative id'),
  body('name').optional().trim().notEmpty().withMessage('name cannot be blank').isLength({ max: 100 }).custom((v) => !/[<>]/.test(v)).withMessage('name cannot contain < or >'),
  body('registrationNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).matches(REGISTRATION_PATTERN).withMessage('registrationNumber can only contain letters, digits, spaces and . / # _ ( ) -'),
  body('address').optional({ values: 'falsy' }).trim().isLength({ max: 150 }).custom((v) => !/[<>]/.test(v)).withMessage('address cannot contain < or >'),
  body('contactEmail').optional({ values: 'falsy' }).trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('contactPhone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).matches(PHONE_PATTERN).withMessage('contactPhone can only contain digits, spaces and + ( ) . -'),
];

const updateCooperativeStatusRules = [
  param('id').isMongoId().withMessage('Invalid cooperative id'),
  body('status').isIn(['pending', 'active', 'rejected']).withMessage('Invalid status value'),
];

module.exports = { listCooperativesRules, cooperativeIdRule, updateCooperativeRules, updateCooperativeStatusRules };