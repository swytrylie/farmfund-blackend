const { body, query } = require('express-validator');

const noBrackets = (v) => !/[<>]/.test(v || '');

const listAnnouncementsRules = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('Invalid page').toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit').toInt(),
];

const sendAnnouncementRules = [
  body('title')
    .isString().withMessage('A title is required').bail()
    .trim().isLength({ min: 3, max: 120 }).withMessage('The title must be 3–120 characters').bail()
    .custom(noBrackets).withMessage('The title cannot contain < or >'),
  body('message')
    .isString().withMessage('A message is required').bail()
    .trim().isLength({ min: 3, max: 2000 }).withMessage('The message must be 3–2000 characters').bail()
    .custom(noBrackets).withMessage('The message cannot contain < or >'),
  body('audience')
    .isIn(['all', 'farm_owners', 'cooperatives']).withMessage('Choose who should receive this announcement'),
];

module.exports = { listAnnouncementsRules, sendAnnouncementRules };