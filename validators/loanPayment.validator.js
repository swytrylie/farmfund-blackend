const { body, query } = require('express-validator');

const METHODS = ['cash', 'bank_transfer', 'mobile_wallet', 'other'];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const listLoanPaymentsRules = [
  query('loan').optional().isMongoId().withMessage('Invalid loan id'),
  query('cooperative').optional().isMongoId().withMessage('Invalid cooperative id'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const createLoanPaymentRules = [
  body('loan').isMongoId().withMessage('A valid loan id is required'),
  // Same ₱500,000 ceiling as every other money field in the app — a
  // larger balance is simply paid in more than one recorded payment.
  body('amount')
    .isFloat({ gt: 0, max: 500000 })
    .withMessage('Amount must be more than ₱0 and no more than ₱500,000')
    .toFloat(),
  body('method').optional().isIn(METHODS).withMessage(`method must be one of: ${METHODS.join(', ')}`),
  // Backdating is fine (recording last week's cash payment today), a
  // future date isn't — a day of slack covers timezone differences.
  body('paymentDate')
    .optional()
    .isISO8601()
    .withMessage('paymentDate must be a valid date')
    .custom((value) => new Date(value).getTime() <= Date.now() + ONE_DAY_MS)
    .withMessage('paymentDate cannot be in the future')
    .toDate(),
];

module.exports = { listLoanPaymentsRules, createLoanPaymentRules };