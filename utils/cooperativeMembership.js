const CooperativeMember = require('../models/CooperativeMember');
const ApiError = require('../utils/ApiError');

/**
 * assertCooperativeStaffOrAdmin
 * ------------------------------
 * Like assertOwnerOrAdmin, but for cooperative-level actions: throws
 * ApiError.forbidden unless the user is a platform admin (kept for
 * support/oversight, same as everywhere else), OR is that SPECIFIC
 * cooperative's owner or finance_manager. A plain 'member' of the
 * cooperative, or an owner/finance_manager of a DIFFERENT cooperative,
 * is correctly rejected — this checks membership in the one cooperative
 * passed in, not just "is this person staff somewhere."
 */
async function assertCooperativeStaffOrAdmin(cooperativeId, user) {
  if (user.role === 'admin') return;

  const membership = await CooperativeMember.findOne({
    cooperative: cooperativeId,
    user: user._id,
    role: { $in: ['owner', 'finance_manager'] },
    status: 'active',
  });

  if (!membership) {
    throw ApiError.forbidden('You do not have permission to perform this action');
  }
}

module.exports = { assertCooperativeStaffOrAdmin };