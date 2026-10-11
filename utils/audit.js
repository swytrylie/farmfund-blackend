const AuditLog = require('../models/AuditLog');

// Writes one audit row. NEVER throws: the thing the admin just did has already
// happened, and a logging hiccup must not turn it into an error.
async function recordAudit(actor, action, { targetType, targetId, targetLabel, details } = {}) {
  try {
    const actorName = actor ? [actor.firstName, actor.lastName].filter(Boolean).join(' ') : undefined;
    await AuditLog.create({
      actor: actor && actor._id,
      actorName,
      action,
      targetType,
      targetId: targetId === undefined || targetId === null ? undefined : String(targetId),
      targetLabel,
      details,
    });
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = { recordAudit };