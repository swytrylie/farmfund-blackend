const CooperativeMember = require('../models/CooperativeMember');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');

// GET /api/cooperative-members?cooperative=X
// Same broader "viewing" rule as everywhere else on the cooperative side —
// any active member can see their own organization's team roster, not
// just owner/finance_manager.
async function listCooperativeMembers(req, res) {
  const { cooperative: cooperativeId } = req.query;

  if (req.user.role !== 'admin') {
    const membership = await CooperativeMember.findOne({
      cooperative: cooperativeId,
      user: req.user._id,
      status: 'active',
    });
    if (!membership) throw ApiError.forbidden('You do not have access to this resource');
  }

  const members = await CooperativeMember.find({ cooperative: cooperativeId, status: 'active' })
    .populate('user', 'firstName lastName email')
    .sort({ role: 1, createdAt: 1 })
    .lean();

  new ApiResponse(200, members, 'Cooperative members retrieved successfully').send(res);
}

module.exports = { listCooperativeMembers };