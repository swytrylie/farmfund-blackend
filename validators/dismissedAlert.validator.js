const { body } = require('express-validator');

const dismissAlertRules = [
  body('alertKey').trim().notEmpty().withMessage('alertKey is required').isLength({ max: 200 })
    // Keys look like "budget:<id>:<id>" or "loan:<id>:due" — an identifier, so only
    // the characters such a key can contain are accepted.
    .matches(/^[A-Za-z0-9:_-]+$/).withMessage('alertKey has an invalid format'),
];

module.exports = { dismissAlertRules };