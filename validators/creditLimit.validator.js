const { body, query } = require('express-validator');
const { MAX_LIMIT } = require('../models/CoopCreditLimit');

const noAngles = (v) => !/[<>]/.test(v);

const lookupRules = [
  query('cooperative').isMongoId().withMessage('A valid cooperative id is required'),
  query('farmer').isMongoId().withMessage('A valid farmer id is required'),
];

const saveRules = [
  body('cooperative').isMongoId().withMessage('A valid cooperative id is required'),
  body('farmer').isMongoId().withMessage('A valid farmer id is required'),
  body('limit')
    .isFloat({ min: 0, max: MAX_LIMIT })
    .withMessage(`The credit limit must be between ₱0 and ₱${MAX_LIMIT.toLocaleString('en-US')}`)
    .bail()
    .custom((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6)
    .withMessage('Use at most 2 decimal places')
    .toFloat(),
  body('note')
    .isString().withMessage('Say why you are changing the limit')
    .bail()
    .trim()
    .isLength({ min: 3, max: 300 }).withMessage('The reason must be 3 to 300 characters')
    .custom(noAngles).withMessage("The reason can't contain < or >"),
];

module.exports = { lookupRules, saveRules };