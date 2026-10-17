const { param, query } = require('express-validator');

const KINDS = ['payment_reminder', 'payment_proof_submitted', 'certificate_submitted', 'certificate_verified'];

const listMineRules = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('Invalid page').toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit').toInt(),
];

const notificationIdRule = [param('id').isMongoId().withMessage('A valid notification id is required')];

// Optional: only mark one kind of notification as read.
const markAllRules = [query('kind').optional().isIn(KINDS).withMessage('Invalid notification kind')];

module.exports = { listMineRules, notificationIdRule, markAllRules };