const { body, param, query } = require('express-validator');

const METHODS = ['gcash', 'maya', 'cash', 'bank_transfer'];
const noAngles = (v) => !/[<>]/.test(v);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const idRule = [param('id').isMongoId().withMessage('A valid proof id is required')];

// These run AFTER the file has been received, so the text fields are filled in
// (as strings, because a form upload sends everything as text).
const submitRules = [
  body('loan').isMongoId().withMessage('Choose which loan you paid'),
  body('amount')
    .isFloat({ gt: 0, max: 500000 })
    .withMessage('Amount must be more than ₱0 and no more than ₱500,000')
    .toFloat(),
  body('method').isIn(METHODS).withMessage('Choose GCash, Maya, Cash or Bank transfer'),
  body('paymentDate')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Enter a valid payment date')
    .bail()
    .custom((value) => new Date(value).getTime() <= Date.now() + ONE_DAY_MS)
    .withMessage("The payment date can't be in the future")
    .toDate(),
  body('referenceNumber')
    .optional({ values: 'falsy' })
    .isString().withMessage('Invalid reference number')
    .bail()
    .trim()
    .isLength({ max: 50 }).withMessage('The reference number must be 50 characters or fewer')
    .matches(/^[A-Za-z0-9][A-Za-z0-9 \-_/]*$/).withMessage('The reference number can only have letters, numbers, spaces, - _ and /'),
  body('note')
    .optional({ values: 'falsy' })
    .isString().withMessage('Invalid note')
    .bail()
    .trim()
    .isLength({ max: 300 }).withMessage('The note must be 300 characters or fewer')
    .custom(noAngles).withMessage("The note can't contain < or >"),
];

const listRules = [
  query('cooperative').isMongoId().withMessage('A valid cooperative id is required'),
  query('status').optional().isIn(['pending', 'verified', 'rejected']).withMessage('Invalid status'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const mineRules = [query('loan').optional().isMongoId().withMessage('Invalid loan id')];

const noteRule = () =>
  body('note')
    .optional({ values: 'falsy' })
    .isString().withMessage('Invalid note')
    .bail()
    .trim()
    .isLength({ max: 300 }).withMessage('The note must be 300 characters or fewer')
    .custom(noAngles).withMessage("The note can't contain < or >");

const verifyRules = [...idRule, noteRule()];
const rejectRules = [
  ...idRule,
  noteRule(),
  body().custom((value) => {
    const note = value && typeof value.note === 'string' ? value.note.trim() : '';
    if (note.length < 3) throw new Error('Say why it was rejected (at least 3 characters)');
    return true;
  }),
];

module.exports = { METHODS, idRule, submitRules, listRules, mineRules, verifyRules, rejectRules };