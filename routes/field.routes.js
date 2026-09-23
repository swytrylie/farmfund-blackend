const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const {
  createFieldRules,
  updateFieldRules,
  fieldIdRule,
  listFieldsRules,
} = require('../validators/field.validator');
const {
  createField,
  getFields,
  getFieldById,
  updateField,
  deleteField,
} = require('../controllers/field.controller');

const router = express.Router();

router.post('/', protect, createFieldRules, handleValidationErrors, asyncHandler(createField));
router.get('/', protect, listFieldsRules, handleValidationErrors, asyncHandler(getFields));
router.get('/:id', protect, fieldIdRule, handleValidationErrors, asyncHandler(getFieldById));
router.patch('/:id', protect, updateFieldRules, handleValidationErrors, asyncHandler(updateField));
router.delete('/:id', protect, fieldIdRule, handleValidationErrors, asyncHandler(deleteField));

module.exports = router;