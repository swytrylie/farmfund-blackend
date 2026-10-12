const { body, param, query } = require('express-validator');

const farmerIdRule = [param('id').isMongoId().withMessage('A valid farmer id is required')];

const listFarmersRules = [
  query('search').optional().isString().trim().isLength({ max: 100 }).withMessage('Search is too long'),
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('Invalid page').toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit').toInt(),
];

const noBrackets = (v) => !/[<>]/.test(v || '');

const grantAccessRules = [
  ...farmerIdRule,
  body('reason')
    .isString().withMessage('A reason for access is required').bail()
    .trim().isLength({ min: 3, max: 300 }).withMessage('The reason must be 3–300 characters').bail()
    .custom(noBrackets).withMessage('The reason cannot contain < or >'),
  body('caseRef')
    .optional({ values: 'falsy' })
    .isString().withMessage('Case number must be text').bail()
    .trim().isLength({ max: 60 }).withMessage('The case number must be at most 60 characters').bail()
    .custom(noBrackets).withMessage('The case number cannot contain < or >'),
  body('notes')
    .optional({ values: 'falsy' })
    .isString().withMessage('Notes must be text').bail()
    .trim().isLength({ max: 500 }).withMessage('Notes must be at most 500 characters').bail()
    .custom(noBrackets).withMessage('Notes cannot contain < or >'),
];

module.exports = { farmerIdRule, listFarmersRules, grantAccessRules };