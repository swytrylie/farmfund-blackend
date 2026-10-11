const { query, param } = require('express-validator');

const listCooperativeMembersRules = [
  query('cooperative').isMongoId().withMessage('A valid cooperative id is required'),
];

const memberIdRule = [param('id').isMongoId().withMessage('A valid member id is required')];

module.exports = { listCooperativeMembersRules, memberIdRule };