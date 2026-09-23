const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect, authorize } = require('../middleware/auth');
const {
  createCropRules,
  updateCropRules,
  cropIdRule,
  listCropsRules,
} = require('../validators/crop.validator');
const {
  createCrop,
  getCrops,
  getCropById,
  updateCrop,
  deleteCrop,
} = require('../controllers/crop.controller');

const router = express.Router();

// Reading crops: any logged-in user (crops are shared reference data everyone needs)
router.get('/', protect, listCropsRules, handleValidationErrors, asyncHandler(getCrops));
router.get('/:id', protect, cropIdRule, handleValidationErrors, asyncHandler(getCropById));

// Writing crops: admin only — this is shared master data, not something
// every farmer should be able to edit or delete out from under others.
router.post('/', protect, authorize('admin'), createCropRules, handleValidationErrors, asyncHandler(createCrop));
router.patch('/:id', protect, authorize('admin'), updateCropRules, handleValidationErrors, asyncHandler(updateCrop));
router.delete('/:id', protect, authorize('admin'), cropIdRule, handleValidationErrors, asyncHandler(deleteCrop));

module.exports = router;