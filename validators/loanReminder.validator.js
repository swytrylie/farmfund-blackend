const { body, query } = require('express-validator');

const TYPES = ['overdue_notice', 'upcoming_payment', 'payment_followup', 'final_overdue_notice'];

const createLoanReminderRules = [
  body('loan').isMongoId().withMessage('A valid loan id is required'),
  body('type').isIn(TYPES).withMessage(`type must be one of: ${TYPES.join(', ')}`),
  // Deliberately NOT .escape()d: this is free text that's stored as typed and
  // shown through React (which escapes on display) and the email template
  // (which escapes when it builds the HTML). Escaping it here too would
  // corrupt what's saved — an apostrophe would come back as &#x27;.
  body('message')
    .isString()
    .withMessage('A message is required')
    .trim()
    .notEmpty()
    .withMessage('A message is required')
    .isLength({ max: 200 })
    .withMessage('Message must be 200 characters or fewer'),
];

const listLoanRemindersRules = [
  query('cooperative').isMongoId().withMessage('A valid cooperative id is required'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = { createLoanReminderRules, listLoanRemindersRules };