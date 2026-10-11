const { query } = require('express-validator');

const listAuditLogsRules = [
  query('search').optional().isString().trim().isLength({ max: 100 }).withMessage('Search is too long'),
  query('category').optional().isIn(['all', 'accounts', 'cooperatives']).withMessage('Invalid category'),
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('Invalid page').toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit').toInt(),
];

module.exports = { listAuditLogsRules };