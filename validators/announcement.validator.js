const { param, query } = require('express-validator');

const listMineRules = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('Invalid page').toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit').toInt(),
];

const announcementIdRule = [param('id').isMongoId().withMessage('A valid announcement id is required')];

module.exports = { listMineRules, announcementIdRule };