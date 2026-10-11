const { body, param, query } = require('express-validator');

const NAME_MESSAGE = 'must be 1–50 characters and cannot contain < or >';
const nameRule = (field) =>
  body(field)
    .optional()
    .isString()
    .withMessage(`${field} must be text`)
    .bail()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage(`${field} ${NAME_MESSAGE}`)
    .bail()
    .custom((v) => !/[<>]/.test(v))
    .withMessage(`${field} ${NAME_MESSAGE}`);

const userIdRule = [param('id').isMongoId().withMessage('A valid account id is required')];

const listUsersRules = [
  query('search').optional().isString().trim().isLength({ max: 100 }).withMessage('Search is too long'),
  query('type').optional().isIn(['all', 'individual', 'owner', 'finance_manager', 'member']).withMessage('Invalid type'),
  query('status').optional().isIn(['all', 'active', 'suspended']).withMessage('Invalid status'),
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('Invalid page').toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit').toInt(),
];

const suspendRules = [
  ...userIdRule,
  body('reason')
    .isString()
    .withMessage('A reason is required')
    .bail()
    .trim()
    .isLength({ min: 3, max: 300 })
    .withMessage('The reason must be 3–300 characters'),
];

const updateUserRules = [
  ...userIdRule,
  nameRule('firstName'),
  nameRule('lastName'),
  body('email').optional().isString().trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body().custom((_, { req }) => ['firstName', 'lastName', 'email'].some((k) => req.body && req.body[k] !== undefined)).withMessage('Nothing to update'),
];

module.exports = { userIdRule, listUsersRules, suspendRules, updateUserRules };