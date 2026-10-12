const { body, param, query } = require('express-validator');

const listBackupsRules = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('Invalid page').toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit').toInt(),
];

const backupIdRule = [param('id').isMongoId().withMessage('Invalid backup id')];

// Restoring overwrites live data, so the request must carry the typed word.
const restoreRules = [
  ...backupIdRule,
  body('confirm').equals('RESTORE').withMessage('Type RESTORE to confirm the restore'),
];

module.exports = { listBackupsRules, backupIdRule, restoreRules };