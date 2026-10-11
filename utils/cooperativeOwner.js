const CooperativeMember = require('../models/CooperativeMember');
const ApiError = require('../utils/ApiError');

/**
 * assertCooperativeOwnerOrAdmin
 * -----------------------------
 * Throws 403 unless the user is a platform admin, OR is the ACTIVE owner of
 * THAT specific cooperative. A finance manager or a member of the same
 * cooperative, or the owner of a different cooperative, is refused.
 *
 * Used where only the owner may act: editing the cooperative's profile,
 * seeing the team, and managing invitations.
 */
async function assertCooperativeOwnerOrAdmin(cooperativeId, user, message = 'Only the cooperative owner can do this') {
  if (user.role === 'admin') return;

  const membership = await CooperativeMember.findOne({
    cooperative: cooperativeId,
    user: user._id,
    role: 'owner',
    status: 'active',
  });

  if (!membership) throw ApiError.forbidden(message);
}

module.exports = { assertCooperativeOwnerOrAdmin };