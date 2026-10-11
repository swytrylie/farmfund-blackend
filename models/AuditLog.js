const mongoose = require('mongoose');

/**
 * AuditLog
 * --------
 * One row per important thing an admin does (approve a cooperative, suspend or
 * delete an account, ...). Written by utils/audit.js; read by the admin
 * "Audit Logs" page.
 *
 * actorName / targetLabel are copied in at the time on purpose: the person or
 * cooperative may be deleted later, and the log must still say who and what.
 */
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, trim: true, maxlength: 120 },
    action: { type: String, required: true, trim: true, maxlength: 60 },
    targetType: { type: String, trim: true, maxlength: 40 },
    targetId: { type: String, trim: true, maxlength: 60 },
    targetLabel: { type: String, trim: true, maxlength: 200 },
    details: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);