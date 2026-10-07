const { body, param, query } = require('express-validator');

const createFinancialRecordRules = [
  body('farm').isMongoId().withMessage('A valid farm id is required'),
  body('category').isMongoId().withMessage('A valid category id is required'),
  body('type').isIn(['income', 'expense']).withMessage('type must be "income" or "expense"'),
  body('amount').isFloat({ min: 0, max: 500000 }).withMessage('amount must be between 0 and 500,000').toFloat(),
  body('date').optional().isISO8601().withMessage('date must be a valid date').toDate(),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
  body('paymentMethod').optional().isIn(['GCash', 'Maya', 'Cash', 'Bank Transfer']).withMessage('Invalid payment method'),
  body('farmingCycle').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid farming cycle id'),
];

const updateFinancialRecordRules = [
  param('id').isMongoId().withMessage('Invalid financial record id'),
  body('category').optional().isMongoId().withMessage('Invalid category id'),
  body('type').optional().isIn(['income', 'expense']).withMessage('type must be "income" or "expense"'),
  body('amount').optional().isFloat({ min: 0, max: 500000 }).withMessage('amount must be between 0 and 500,000').toFloat(),
  body('date').optional().isISO8601().withMessage('date must be a valid date').toDate(),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
  body('paymentMethod').optional().isIn(['GCash', 'Maya', 'Cash', 'Bank Transfer']).withMessage('Invalid payment method'),
  body('farmingCycle').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid farming cycle id'),
  // None of these text fields are HTML-escaped on the way in. Escaping before
  // saving corrupted what people typed ("Fertilizer & seeds" became
  // "Fertilizer &amp; seeds", and a MIME type like "image/jpeg" would have
  // become "image&#x2F;jpeg") — and it's the wrong layer: React escapes
  // everything it displays. Description and notes are free text and are kept
  // exactly as typed (people legitimately write things like "cost < 500").
  body('receiptMetadata.fileName').optional({ values: 'falsy' }).trim().isLength({ max: 255 }),
  body('receiptMetadata.fileUrl').optional({ values: 'falsy' }).trim().isURL().withMessage('receiptMetadata.fileUrl must be a valid URL'),
  body('receiptMetadata.fileType').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('receiptMetadata.fileSizeBytes').optional().isInt({ min: 0, max: 20 * 1024 * 1024 }).withMessage('receiptMetadata.fileSizeBytes must be under 20MB').toInt(),
  body('receiptMetadata.notes').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
];

const financialRecordIdRule = [
  param('id').isMongoId().withMessage('Invalid financial record id'),
];

const listFinancialRecordsRules = [
  query('farm').optional().isMongoId().withMessage('Invalid farm id'),
  query('category').optional().isMongoId().withMessage('Invalid category id'),
  query('type').optional().isIn(['income', 'expense']).withMessage('type must be "income" or "expense"'),
  query('startDate').optional().isISO8601().withMessage('startDate must be a valid date'),
  query('endDate').optional().isISO8601().withMessage('endDate must be a valid date'),
  query('farmingCycle').optional().isMongoId().withMessage('Invalid farming cycle id'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = {
  createFinancialRecordRules,
  updateFinancialRecordRules,
  financialRecordIdRule,
  listFinancialRecordsRules,
};