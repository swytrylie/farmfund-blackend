const { body, param, query } = require('express-validator');

const createLoanRules = [
  body('cooperative').isMongoId().withMessage('A valid cooperative id is required'),
  body('principalAmount').isFloat({ min: 0, max: 500000 }).withMessage('principalAmount must be between 0 and 500,000').toFloat(),
  body('interestRatePercent').isFloat({ min: 0, max: 100 }).withMessage('interestRatePercent must be between 0 and 100').toFloat(),
  body('termMonths').isInt({ min: 1, max: 120 }).withMessage('termMonths must be between 1 and 120').toInt(),
];

const loanIdRule = [param('id').isMongoId().withMessage('Invalid loan id')];

const updateLoanStatusRules = [
  param('id').isMongoId().withMessage('Invalid loan id'),
  body('status')
    .isIn(['pending', 'approved', 'active', 'paid_off', 'defaulted', 'rejected'])
    .withMessage('Invalid status value'),
  body('dueDate').optional().isISO8601().withMessage('dueDate must be a valid date').toDate(),
];

const listLoansRules = [
  query('status').optional().isIn(['pending', 'approved', 'active', 'paid_off', 'defaulted', 'rejected']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = { createLoanRules, loanIdRule, updateLoanStatusRules, listLoansRules };