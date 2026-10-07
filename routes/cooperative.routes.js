const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect, authorize } = require('../middleware/auth');
const {
  listCooperativesRules,
  cooperativeIdRule,
  updateCooperativeRules,
  updateCooperativeStatusRules,
} = require('../validators/cooperative.validator');
const {
  getCooperatives,
  getCooperativeById,
  updateCooperative,
  updateCooperativeStatus,
} = require('../controllers/cooperative.controller');

const router = express.Router();

router.get('/', protect, listCooperativesRules, handleValidationErrors, asyncHandler(getCooperatives));

router.get('/:id', protect, cooperativeIdRule, handleValidationErrors, asyncHandler(getCooperativeById));

router.patch('/:id', protect, updateCooperativeRules, handleValidationErrors, asyncHandler(updateCooperative));

router.patch(
  '/:id/status',
  protect,
  authorize('admin'),
  updateCooperativeStatusRules,
  handleValidationErrors,
  asyncHandler(updateCooperativeStatus)
);

module.exports = router;