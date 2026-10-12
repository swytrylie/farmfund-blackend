const { body } = require('express-validator');

const maintenanceRules = [body('enabled').isBoolean({ strict: true }).withMessage('enabled must be true or false')];

// Both times (ISO 8601, e.g. 2026-10-13T02:00:00.000Z) or both null to remove the window.
const windowRules = [
  body('start').optional({ nullable: true }).isISO8601().withMessage('Enter a valid start time'),
  body('end').optional({ nullable: true }).isISO8601().withMessage('Enter a valid end time'),
  body().custom((value) => {
    const has = (k) => value[k] !== undefined && value[k] !== null;
    if (has('start') !== has('end')) throw new Error('Both a start and an end time are required');
    return true;
  }),
];

module.exports = { maintenanceRules, windowRules };