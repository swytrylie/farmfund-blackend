const mongoose = require('mongoose');

/**
 * RecordAccess
 * ------------
 * An admin's time-limited permission to look at ONE farmer's financial
 * records. Created on the admin "Financial Record Monitoring" page when the
 * admin states a reason; checked every time the records are opened.
 * (Each grant and each view is also written to the Audit Logs.)
 */
const recordAccessSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    caseRef: { type: String, trim: true, maxlength: 60 },
    notes: { type: String, trim: true, maxlength: 500 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

recordAccessSchema.index({ admin: 1, farmer: 1, expiresAt: -1 });

module.exports = mongoose.model('RecordAccess', recordAccessSchema);