const { body, param, query } = require('express-validator');

const categoryLineItemRules = (prefix) => [
  body(`${prefix}.*.category`).isMongoId().withMessage('Each category id must be valid'),
  body(`${prefix}.*.allocatedAmount`).isFloat({ min: 0, max: 500000 }).withMessage('allocatedAmount must be between 0 and 500,000').toFloat(),
];

const createBudgetRules = [
  body('farm').isMongoId().withMessage('A valid farm id is required'),
  body('name').trim().notEmpty().withMessage('name is required').isLength({ max: 100 }).custom((v) => !/[<>]/.test(v)).withMessage('name cannot contain < or >'),
  body('periodStart').isISO8601().withMessage('periodStart must be a valid date').toDate(),
  body('periodEnd').isISO8601().withMessage('periodEnd must be a valid date').toDate()
    .custom((end, { req }) => {
      if (new Date(end) <= new Date(req.body.periodStart)) {
        throw new Error('periodEnd must be after periodStart');
      }
      return true;
    }),
  body('totalAmount').isFloat({ min: 0, max: 500000 }).withMessage('totalAmount must be between 0 and 500,000').toFloat(),
  body('categories').optional().isArray().withMessage('categories must be an array'),
  ...categoryLineItemRules('categories'),
];

const updateBudgetRules = [
  param('id').isMongoId().withMessage('Invalid budget id'),
  body('name').optional().trim().isLength({ max: 100 }).custom((v) => !/[<>]/.test(v)).withMessage('name cannot contain < or >'),
  body('periodStart').optional().isISO8601().withMessage('periodStart must be a valid date').toDate(),
  body('periodEnd').optional().isISO8601().withMessage('periodEnd must be a valid date').toDate(),
  body('totalAmount').optional().isFloat({ min: 0, max: 500000 }).withMessage('totalAmount must be between 0 and 500,000').toFloat(),
  body('categories').optional().isArray().withMessage('categories must be an array'),
  ...categoryLineItemRules('categories'),
];

const budgetIdRule = [param('id').isMongoId().withMessage('Invalid budget id')];

const listBudgetsRules = [
  query('farm').optional().isMongoId().withMessage('Invalid farm id'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = { createBudgetRules, updateBudgetRules, budgetIdRule, listBudgetsRules };