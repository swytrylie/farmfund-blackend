const { body, param, query } = require('express-validator');

const createFarmRules = [
  body('name').trim().notEmpty().withMessage('name is required').isLength({ max: 100 }).escape(),
  body('location.address').optional({ values: 'falsy' }).trim().isLength({ max: 255 }).escape(),
  body('location.latitude').optional({ values: 'falsy' }).isFloat({ min: -90, max: 90 }).toFloat(),
  body('location.longitude').optional({ values: 'falsy' }).isFloat({ min: -180, max: 180 }).toFloat(),
  body('totalAreaHectares').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
];

const updateFarmRules = [
  param('id').isMongoId().withMessage('Invalid farm id'),
  body('name').optional().trim().isLength({ max: 100 }).escape(),
  body('location.address').optional({ values: 'falsy' }).trim().isLength({ max: 255 }).escape(),
  body('location.latitude').optional({ values: 'falsy' }).isFloat({ min: -90, max: 90 }).toFloat(),
  body('location.longitude').optional({ values: 'falsy' }).isFloat({ min: -180, max: 180 }).toFloat(),
  body('totalAreaHectares').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
  body('isActive').optional().isBoolean().toBoolean(),
];

const farmIdRule = [param('id').isMongoId().withMessage('Invalid farm id')];

const listFarmsRules = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = { createFarmRules, updateFarmRules, farmIdRule, listFarmsRules };