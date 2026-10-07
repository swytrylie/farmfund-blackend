const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { query } = require('express-validator');
const { getFinancialCategories } = require('../controllers/financialCategory.controller');

const router = express.Router();

const listCategoriesRules = [
  query('type').optional().isIn(['income', 'expense']).withMessage('type must be "income" or "expense"'),
];

router.get('/', protect, listCategoriesRules, handleValidationErrors, asyncHandler(getFinancialCategories));

module.exports = router;