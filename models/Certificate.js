const mongoose = require('mongoose');

/**
 * Certificate
 * -----------
 * A document (PDF or photo) a farmer uploads to their profile, such as a
 * training certificate or a registration. The file itself is kept privately on
 * Cloudinary; only its reference is stored here. The admin and the staff of a
 * cooperative the farmer has a loan with can open it and mark it Verified or
 * Rejected.
 */
const certificateSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // What kind of document this is. Only a verified barangay_certificate
    // raises the farmer's credit limit; income_certificate is supporting
    // evidence; 'other' is everything else (and every certificate uploaded
    // before types existed).
    type: { type: String, enum: ['barangay_certificate', 'income_certificate', 'other'], default: 'other' },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    issuer: { type: String, trim: true, maxlength: 100 },
    issuedOn: { type: Date },

    file: {
      publicId: { type: String, required: true },
      format: { type: String, required: true }, // pdf | jpg | png
      bytes: { type: Number, required: true },
      originalName: { type: String, trim: true, maxlength: 200 },
    },

    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    reviewNote: { type: String, trim: true, maxlength: 300 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedByName: { type: String, trim: true },
    reviewedByRole: { type: String, enum: ['admin', 'cooperative'] },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Certificate', certificateSchema);