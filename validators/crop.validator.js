const { body, param, query } = require('express-validator');

/**
 * Crop validators
 * ---------------
 * Every rule here mirrors and TIGHTENS the Mongoose schema — validating
 * here means bad requests are rejected with a clear 400 *before* ever
 * reaching the database, rather than relying on Mongoose alone.
 *
 * Text is stored exactly as typed (React escapes it when displaying it).
 * Names and varieties only refuse < and >.
 */

const ALLOWED_CATEGORIES = ['grain', 'vegetable', 'fruit', 'legume', 'root', 'other'];

const noBrackets = (v) => !/[<>]/.test(v || '');

const createCropRules = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('name must be 2-100 characters')
    .custom(noBrackets)
    .withMessage('name cannot contain < or >'),

  body('variety')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 100 })
    .withMessage('variety must be at most 100 characters')
    .custom(noBrackets)
    .withMessage('variety cannot contain < or >'),

  body('category')
    .optional({ values: 'falsy' })
    .trim()
    .isIn(ALLOWED_CATEGORIES)
    .withMessage(`category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`),

  body('typicalGrowingDays')
    .optional({ values: 'falsy' })
    .isInt({ min: 0, max: 1000 })
    .withMessage('typicalGrowingDays must be an integer between 0 and 1000')
    .toInt(),
];

const updateCropRules = [
  param('id').isMongoId().withMessage('Invalid crop id'),

  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('name must be 2-100 characters')
    .custom(noBrackets)
    .withMessage('name cannot contain < or >'),

  body('variety')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 100 })
    .withMessage('variety must be at most 100 characters')
    .custom(noBrackets)
    .withMessage('variety cannot contain < or >'),

  body('category')
    .optional({ values: 'falsy' })
    .trim()
    .isIn(ALLOWED_CATEGORIES)
    .withMessage(`category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`),

  body('typicalGrowingDays')
    .optional({ values: 'falsy' })
    .isInt({ min: 0, max: 1000 })
    .toInt(),

  body('isActive').optional().isBoolean().toBoolean(),
];

const cropIdRule = [param('id').isMongoId().withMessage('Invalid crop id')];

const listCropsRules = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  // Search text is only used to look things up; the controller already escapes
  // it for the regex, and it is never stored, so no HTML-escaping here
  // (that used to break searches like "Smith & Sons").
  query('search').optional().trim().isLength({ max: 100 }),
  query('category').optional().trim().isIn(ALLOWED_CATEGORIES),
];

module.exports = {
  createCropRules,
  updateCropRules,
  cropIdRule,
  listCropsRules,
  ALLOWED_CATEGORIES,
};