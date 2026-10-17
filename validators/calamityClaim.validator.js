const { body, param, query } = require('express-validator');
const { CALAMITY_KEYS } = require('../utils/loanTerms');

const noAngles = (v) => !/[<>]/.test(v);

// A farmer reports a calamity on one of their loans. Who the farmer is and
// which cooperative the loan belongs to come from the saved loan, never from
// this form.
const createClaimRules = [
  body('loan').isMongoId().withMessage('A valid loan id is required'),
  body('calamity').isIn(CALAMITY_KEYS).withMessage('Choose what happened to your farm'),
  body('description')
    .isString().withMessage('Describe what happened')
    .bail()
    .customSanitizer((v) => v.replace(/[<>]/g, '').trim())
    .isLength({ min: 5, max: 500 }).withMessage('Describe what happened in 5 to 500 characters'),
];

const claimReviewRules = [
  param('id').isMongoId().withMessage('Invalid claim id'),
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

const claimQueueRules = [
  query('status').optional().isIn(['pending', 'verified', 'rejected', 'all']).withMessage('Invalid status'),
  query('search').optional().isString().isLength({ max: 100 }).withMessage('The search is too long'),
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('Invalid page').toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit').toInt(),
];

const claimIdRule = [param('id').isMongoId().withMessage('Invalid claim id')];

module.exports = { createClaimRules, claimReviewRules, claimQueueRules, claimIdRule };
