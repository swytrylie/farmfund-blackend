const { body, param, query } = require('express-validator');

const cooperativeIdRule = [param('id').isMongoId().withMessage('A valid cooperative id is required')];
const archiveIdRule = [param('id').isMongoId().withMessage('A valid archive id is required')];

// The typed name is compared exactly by the controller, so it is only checked
// for being text here (not trimmed or changed).
const deleteCooperativeRules = [
  ...cooperativeIdRule,
  body('confirmName').isString().withMessage('Type the cooperative name to confirm').bail().isLength({ min: 1, max: 300 }).withMessage('Type the cooperative name to confirm'),
];

const listArchiveRules = [
  query('kind').optional().isIn(['all', 'cooperative', 'user']).withMessage('Invalid type'),
  query('search').optional().isString().trim().isLength({ max: 100 }).withMessage('Search is too long'),
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('Invalid page').toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit').toInt(),
];

module.exports = { cooperativeIdRule, archiveIdRule, deleteCooperativeRules, listArchiveRules };