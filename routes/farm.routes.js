const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const {
  createFarmRules,
  updateFarmRules,
  farmIdRule,
  listFarmsRules,
} = require('../validators/farm.validator');
const {
  createFarm,
  getFarms,
  getFarmById,
  updateFarm,
  deleteFarm,
} = require('../controllers/farm.controller');

const router = express.Router();

// Every route requires login. Ownership (not role) is checked inside
// the controller, since it depends on the specific farm being accessed.
router.post('/', protect, createFarmRules, handleValidationErrors, asyncHandler(createFarm));
router.get('/', protect, listFarmsRules, handleValidationErrors, asyncHandler(getFarms));
router.get('/:id', protect, farmIdRule, handleValidationErrors, asyncHandler(getFarmById));
router.patch('/:id', protect, updateFarmRules, handleValidationErrors, asyncHandler(updateFarm));
router.delete('/:id', protect, farmIdRule, handleValidationErrors, asyncHandler(deleteFarm));

module.exports = router;