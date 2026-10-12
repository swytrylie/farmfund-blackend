const mongoose = require('mongoose');

/**
 * Backup
 * ------
 * One saved copy ("snapshot") of the platform's data. The data itself lives in
 * BackupChunk rows; this row is the label on the box: when it was taken, by
 * whom, how big it is and how many records of each kind it holds.
 *   manual    = an admin pressed "Run Backup Now"
 *   scheduled = the daily automatic backup
 *   safety    = taken automatically just before a restore, so a restore can be undone
 * A backup that could not be completed is kept as status "failed" (with the
 * reason) so the admin can see that last night's backup did not work.
 */
const backupSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['manual', 'scheduled', 'safety'], required: true },
    status: { type: String, enum: ['completed', 'failed'], required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, trim: true },
    sizeBytes: { type: Number, default: 0 },
    totalRecords: { type: Number, default: 0 },
    // { User: 12, Farm: 4, ... } — every kind of record the backup covers
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    error: { type: String, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

backupSchema.index({ createdAt: -1 });
backupSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('Backup', backupSchema);