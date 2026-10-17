const { body, param, query } = require('express-validator');
const { CROP_KEYS, COLLATERAL_KEYS } = require('../utils/loanTerms');

// The farmer picks a crop and a collateral type. The interest rate and the
// repayment period are worked out by the server from those two choices, so
// they are not accepted here (anything sent for them is ignored).
const createLoanRules = [
  body('cooperative').isMongoId().withMessage('A valid cooperative id is required'),
  body('principalAmount').isFloat({ min: 1, max: 500000 }).withMessage('principalAmount must be between 1 and 500,000').toFloat(),
  body('crop').isIn(CROP_KEYS).withMessage('Choose the crop this loan is for'),
  body('collateralType').isIn(COLLATERAL_KEYS).withMessage('Choose what you are putting up as collateral'),
  body('collateralDescription')
    .isString().withMessage('Describe your collateral')
    .bail()
    .customSanitizer((v) => v.replace(/[<>]/g, '').trim())
    .isLength({ min: 5, max: 500 }).withMessage('Describe your collateral in 5 to 500 characters'),
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