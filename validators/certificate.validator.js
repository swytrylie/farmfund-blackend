const { body, param } = require('express-validator');

const noAngles = (v) => !/[<>]/.test(v);

const idRule = [param('id').isMongoId().withMessage('A valid certificate id is required')];
const farmerIdRule = [param('farmerId').isMongoId().withMessage('A valid farmer id is required')];

// These run AFTER the file has been received, so the text fields are filled in.
const createRules = [
  body('title')
    .isString().withMessage('Enter a title for the certificate')
    .bail()
    .trim()
    .isLength({ min: 3, max: 100 }).withMessage('The title must be 3 to 100 characters')
    .custom(noAngles).withMessage("The title can't contain < or >"),
  body('issuer')
    .optional({ values: 'falsy' })
    .isString().withMessage('Invalid issuer')
    .bail()
    .trim()
    .isLength({ max: 100 }).withMessage('The issuer must be 100 characters or fewer')
    .custom(noAngles).withMessage("The issuer can't contain < or >"),
  body('issuedOn')
    .optional({ values: 'falsy' })
    .isISO8601().withMessage('Enter a valid date')
    .bail()
    .custom((v) => new Date(v).getTime() <= Date.now() + 24 * 3600 * 1000).withMessage("The date can't be in the future"),
];

const reviewRules = [
  param('id').isMongoId().withMessage('A valid certificate id is required'),
  body('status').isIn(['verified', 'rejected']).withMessage('Choose Verified or Rejected'),
  body('note')
    .optional({ values: 'falsy' })
    .isString().withMessage('Invalid note')
    .bail()
    .trim()
    .isLength({ max: 300 }).withMessage('The note must be 300 characters or fewer')
    .custom(noAngles).withMessage("The note can't contain < or >"),
  body().custom((value) => {
    if (value && value.status === 'rejected') {
      const note = typeof value.note === 'string' ? value.note.trim() : '';
      if (note.length < 3) throw new Error('Say why it was rejected (at least 3 characters)');
    }
    return true;
  }),
];

module.exports = { idRule, farmerIdRule, createRules, reviewRules };