const { query } = require('express-validator');

const listCooperativeMembersRules = [
  query('cooperative').isMongoId().withMessage('A valid cooperative id is required'),
];

module.exports = { listCooperativeMembersRules };