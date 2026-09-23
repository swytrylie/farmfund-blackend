const { body, param, query } = require('express-validator');

const createFieldRules = [
  body('farm').isMongoId().withMessage('A valid farm id is required'),
  body('name').trim().notEmpty().withMessage('name is required').isLength({ max: 100 }).escape(),
  body('areaHectares').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
  body('soilType').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).escape(),
];

const updateFieldRules = [
  param('id').isMongoId().withMessage('Invalid field id'),
  body('name').optional().trim().isLength({ max: 100 }).escape(),
  body('areaHectares').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
  body('soilType').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).escape(),
  body('isActive').optional().isBoolean().toBoolean(),
];

const fieldIdRule = [param('id').isMongoId().withMessage('Invalid field id')];

const listFieldsRules = [
  query('farm').optional().isMongoId().withMessage('Invalid farm id'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = { createFieldRules, updateFieldRules, fieldIdRule, listFieldsRules };