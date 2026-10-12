const mongoose = require('mongoose');

/**
 * BackupChunk
 * -----------
 * A piece of a backup's data: up to ~1.5 MB of one kind of record, saved as
 * text. (A database document can be at most 16 MB, so big collections are
 * cut into several chunks.) Chunks only mean something together with their
 * Backup row.
 */
const backupChunkSchema = new mongoose.Schema(
  {
    backup: { type: mongoose.Schema.Types.ObjectId, ref: 'Backup', required: true },
    model: { type: String, required: true },
    seq: { type: Number, required: true },
    count: { type: Number, required: true },
    data: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

backupChunkSchema.index({ backup: 1, model: 1, seq: 1 });

module.exports = mongoose.model('BackupChunk', backupChunkSchema);