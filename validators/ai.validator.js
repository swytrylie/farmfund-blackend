const { body, query } = require('express-validator');

const chatRules = [
  body('message')
    .isString().withMessage('message must be text')
    .trim()
    .isLength({ min: 1, max: 1000 }).withMessage('message must be 1 to 1,000 characters'),
];

const refreshRules = [query('refresh').optional().isIn(['0', '1']).withMessage('refresh must be 0 or 1')];

module.exports = { chatRules, refreshRules };
