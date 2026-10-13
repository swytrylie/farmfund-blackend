const mongoose = require('mongoose');

/**
 * ArchivedItem
 * ------------
 * The "recycle bin". When an admin deletes a cooperative or a user account, a
 * full copy of everything that was removed is kept here for 30 days so it can
 * be looked at and, if it was a mistake, put back.
 *
 * - data is the whole snapshot as one text value (Extended JSON, the same
 *   format backups use, so ids and dates survive). It holds password hashes
 *   and invitation codes, so it is never selected by default and never sent to
 *   the browser; the admin pages only ever see the summary fields.
 * - counts / people / kept are the readable summary shown on the Archive page.
 * - expiresAt is when it is removed for good (see utils/archive.js).
 *
 * Not part of a backup, on purpose: a restore of an old backup must not
 * resurrect or erase the recycle bin.
 */
const archivedItemSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['cooperative', 'user'], required: true },
    label: { type: String, required: true, trim: true, maxlength: 300 },
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    people: { type: [mongoose.Schema.Types.Mixed], default: [] },
    kept: { type: [mongoose.Schema.Types.Mixed], default: [] },
    data: { type: String, required: true, select: false },
    sizeBytes: { type: Number, default: 0 },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deletedByName: { type: String, trim: true, maxlength: 120 },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

archivedItemSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ArchivedItem', archivedItemSchema);