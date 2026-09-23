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

const registerRules = [
  body('firstName').trim().notEmpty().withMessage('firstName is required').isLength({ max: 50 }).escape(),
  body('lastName').trim().notEmpty().withMessage('lastName is required').isLength({ max: 50 }).escape(),
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  passwordRule,
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).escape(),
];

const loginRules = [
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

module.exports = { registerRules, loginRules };