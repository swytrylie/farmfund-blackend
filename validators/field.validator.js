const { body, param, query } = require('express-validator');

// Text is stored exactly as typed. React escapes it when showing it on a page.
// We only refuse < and >.
const noBrackets = (v) => !/[<>]/.test(v || '');

const createFieldRules = [
  body('farm').isMongoId().withMessage('A valid farm id is required'),
  body('name').trim().notEmpty().withMessage('name is required').isLength({ max: 100 }).withMessage('name must be at most 100 characters').custom(noBrackets).withMessage('name cannot contain < or >'),
  body('areaHectares').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
  body('soilType').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('soilType must be at most 100 characters').custom(noBrackets).withMessage('soilType cannot contain < or >'),
];

const updateFieldRules = [
  param('id').isMongoId().withMessage('Invalid field id'),
  body('name').optional().trim().isLength({ max: 100 }).withMessage('name must be at most 100 characters').custom(noBrackets).withMessage('name cannot contain < or >'),
  body('areaHectares').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
  body('soilType').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('soilType must be at most 100 characters').custom(noBrackets).withMessage('soilType cannot contain < or >'),
  body('isActive').optional().isBoolean().toBoolean(),
];

const fieldIdRule = [param('id').isMongoId().withMessage('Invalid field id')];

const listFieldsRules = [
  query('farm').optional().isMongoId().withMessage('Invalid farm id'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = { createFieldRules, updateFieldRules, fieldIdRule, listFieldsRules };