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