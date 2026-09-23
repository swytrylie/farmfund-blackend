const mongoose = require('mongoose');

/**
 * ReceiptMetadata
 * ----------------
 * EMBEDDED sub-document (not its own collection).
 * Used by: FinancialRecord, LoanPayment
 * Reason: "Receipt metadata belongs directly to the [parent] and is
 * always retrieved together with it" — no independent lifecycle.
 */
const receiptMetadataSchema = new mongoose.Schema(
  {
    fileName: { type: String, trim: true },
    fileUrl: { type: String, trim: true }, // S3 / Atlas storage / CDN link
    fileType: { type: String, trim: true }, // e.g. 'image/jpeg', 'application/pdf'
    fileSizeBytes: { type: Number, min: 0 },
    uploadedAt: { type: Date, default: Date.now },
    ocrExtractedAmount: { type: Number }, // optional, if OCR is ever added
    notes: { type: String, trim: true },
  },
  { _id: false } // no separate _id — it's not a standalone document
);

module.exports = receiptMetadataSchema;
