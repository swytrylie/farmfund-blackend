const ApiError = require('./ApiError');

/**
 * assertOwnerOrAdmin
 * -------------------
 * Generic ownership check reused across every model that belongs to a
 * specific user (Farm directly; Field/FarmingCycle indirectly through
 * their parent Farm). Throws 403 unless the requester owns the resource
 * or is an admin.
 */
function assertOwnerOrAdmin(ownerId, user) {
  const isOwner = ownerId.toString() === user._id.toString();
  if (!isOwner && user.role !== 'admin') {
    throw ApiError.forbidden('You do not have access to this resource');
  }
}

module.exports = { assertOwnerOrAdmin };