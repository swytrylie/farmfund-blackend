const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const {
  createFarmingCycleRules,
  updateFarmingCycleRules,
  farmingCycleIdRule,
  listFarmingCyclesRules,
} = require('../validators/farmingCycle.validator');
const {
  createFarmingCycle,
  getFarmingCycles,
  getFarmingCycleById,
  updateFarmingCycle,
} = require('../controllers/farmingCycle.controller');

const router = express.Router();

// No DELETE route: farming cycles are historical records, corrected via
// PATCH (e.g. marking status: 'failed'), never erased outright.
router.post('/', protect, createFarmingCycleRules, handleValidationErrors, asyncHandler(createFarmingCycle));
router.get('/', protect, listFarmingCyclesRules, handleValidationErrors, asyncHandler(getFarmingCycles));
router.get('/:id', protect, farmingCycleIdRule, handleValidationErrors, asyncHandler(getFarmingCycleById));
router.patch('/:id', protect, updateFarmingCycleRules, handleValidationErrors, asyncHandler(updateFarmingCycle));

module.exports = router;