const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const {
  createBudgetRules,
  updateBudgetRules,
  budgetIdRule,
  listBudgetsRules,
} = require('../validators/budget.validator');
const {
  createBudget,
  getBudgets,
  getBudgetById,
  updateBudget,
  deleteBudget,
} = require('../controllers/budget.controller');

const router = express.Router();

router.post('/', protect, createBudgetRules, handleValidationErrors, asyncHandler(createBudget));
router.get('/', protect, listBudgetsRules, handleValidationErrors, asyncHandler(getBudgets));
router.get('/:id', protect, budgetIdRule, handleValidationErrors, asyncHandler(getBudgetById));
router.patch('/:id', protect, updateBudgetRules, handleValidationErrors, asyncHandler(updateBudget));
router.delete('/:id', protect, budgetIdRule, handleValidationErrors, asyncHandler(deleteBudget));

module.exports = router;