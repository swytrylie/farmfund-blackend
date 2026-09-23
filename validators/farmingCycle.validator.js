const { body, param, query } = require('express-validator');

const STATUS_VALUES = ['planned', 'planting', 'growing', 'harvested', 'failed'];

const createFarmingCycleRules = [
  body('field').isMongoId().withMessage('A valid field id is required'),
  body('crop').isMongoId().withMessage('A valid crop id is required'),
  body('startDate').isISO8601().withMessage('startDate must be a valid date').toDate(),
  body('endDate').optional({ values: 'falsy' }).isISO8601().withMessage('endDate must be a valid date').toDate(),
  body('status').optional({ values: 'falsy' }).isIn(STATUS_VALUES).withMessage(`status must be one of: ${STATUS_VALUES.join(', ')}`),
  body('expectedYieldKg').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).escape(),
];

const updateFarmingCycleRules = [
  param('id').isMongoId().withMessage('Invalid farming cycle id'),
  body('endDate').optional({ values: 'falsy' }).isISO8601().toDate(),
  body('status').optional({ values: 'falsy' }).isIn(STATUS_VALUES).withMessage(`status must be one of: ${STATUS_VALUES.join(', ')}`),
  body('expectedYieldKg').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
  body('actualYieldKg').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).escape(),
];

const farmingCycleIdRule = [param('id').isMongoId().withMessage('Invalid farming cycle id')];

const listFarmingCyclesRules = [
  query('field').optional().isMongoId().withMessage('Invalid field id'),
  query('status').optional().isIn(STATUS_VALUES),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = {
  createFarmingCycleRules,
  updateFarmingCycleRules,
  farmingCycleIdRule,
  listFarmingCyclesRules,
  STATUS_VALUES,
};