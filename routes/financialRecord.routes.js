const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const {
  createFinancialRecordRules,
  updateFinancialRecordRules,
  financialRecordIdRule,
  listFinancialRecordsRules,
} = require('../validators/financialRecord.validator');
const {
  createFinancialRecord,
  getFinancialRecords,
  getFinancialRecordById,
  updateFinancialRecord,
  deleteFinancialRecord,
} = require('../controllers/financialRecord.controller');

const router = express.Router();

router.post('/', protect, createFinancialRecordRules, handleValidationErrors, asyncHandler(createFinancialRecord));
router.get('/', protect, listFinancialRecordsRules, handleValidationErrors, asyncHandler(getFinancialRecords));
router.get('/:id', protect, financialRecordIdRule, handleValidationErrors, asyncHandler(getFinancialRecordById));
router.patch('/:id', protect, updateFinancialRecordRules, handleValidationErrors, asyncHandler(updateFinancialRecord));
router.delete('/:id', protect, financialRecordIdRule, handleValidationErrors, asyncHandler(deleteFinancialRecord));

module.exports = router;