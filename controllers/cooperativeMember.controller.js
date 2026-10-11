const mongoose = require('mongoose');
const CooperativeMember = require('../models/CooperativeMember');
const Cooperative = require('../models/Cooperative');
const User = require('../models/User');
const Farm = require('../models/Farm');
const DismissedAlert = require('../models/DismissedAlert');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { assertCooperativeOwnerOrAdmin } = require('../utils/cooperativeOwner');
const { sendAccountRemovedEmail } = require('../utils/mailer');

// GET /api/cooperative-members?cooperative=X
// The team roster is the OWNER's to see — finance managers and members
// can't view it.
async function listCooperativeMembers(req, res) {
  const { cooperative: cooperativeId } = req.query;

  await assertCooperativeOwnerOrAdmin(cooperativeId, req.user, 'Only the cooperative owner can view the team');

  const members = await CooperativeMember.find({ cooperative: cooperativeId, status: 'active' })
    .populate('user', 'firstName lastName email')
    .sort({ role: 1, createdAt: 1 })
    .lean();

  new ApiResponse(200, members, 'Cooperative members retrieved successfully').send(res);
}

// DELETE /api/cooperative-members/:id
// Removes a finance manager or member from the cooperative AND deletes their
// account, so the same email can sign up again later. OWNER-only (or a
// platform admin).
//
// What is deleted: the membership, the person's dismissed-alert list, and the
// account itself. What is kept: the cooperative's own records. Payments they
// recorded and reminders they sent stay in the cooperative's books — those
// rows just show no staff name afterwards.
async function removeMember(req, res) {
  const membership = await CooperativeMember.findById(req.params.id);
  if (!membership || membership.status !== 'active') throw ApiError.notFound('Member not found');

  if (req.user.role !== 'admin') {
    const caller = await CooperativeMember.findOne({
      cooperative: membership.cooperative,
      user: req.user._id,
      role: 'owner',
      status: 'active',
    });
    if (!caller) throw ApiError.forbidden('Only the cooperative owner can remove members');
  }

  if (membership.role === 'owner') throw ApiError.badRequest("The cooperative owner can't be removed");

  // Deleting an account is only safe when it exists purely for this
  // cooperative. These checks refuse (and delete nothing) otherwise.
  const otherMemberships = await CooperativeMember.countDocuments({
    user: membership.user,
    _id: { $ne: membership._id },
  });
  if (otherMemberships > 0) {
    throw ApiError.conflict("This account belongs to another cooperative too, so it can't be deleted automatically");
  }
  const farmCount = await Farm.countDocuments({ owner: membership.user });
  if (farmCount > 0) {
    throw ApiError.conflict("This account has its own farm records, so it can't be deleted automatically");
  }

  // Read before deleting — afterwards they're gone, and the email needs them.
  const target = await User.findById(membership.user).select('firstName email');
  const coop = await Cooperative.findById(membership.cooperative).select('name');

  // All-or-nothing. The membership delete is the gate: only one request can
  // ever delete it, so two quick clicks can't delete twice or email twice.
  const session = await mongoose.startSession();
  let removed = false;
  try {
    await session.withTransaction(async () => {
      removed = false;
      const gone = await CooperativeMember.findOneAndDelete(
        { _id: membership._id, status: 'active', role: { $ne: 'owner' } },
        { session }
      );
      if (!gone) return;
      await DismissedAlert.deleteMany({ user: gone.user }, { session });
      await User.deleteOne({ _id: gone.user }, { session });
      removed = true;
    });
  } finally {
    await session.endSession();
  }
  if (!removed) throw ApiError.conflict('This member has already been removed');

  // The account is already deleted at this point, so a failed email must not
  // turn into an error — it's reported back so the screen can say so.
  let emailSent = false;
  if (target && target.email) {
    try {
      await sendAccountRemovedEmail(target.email, target.firstName, coop && coop.name);
      emailSent = true;
    } catch (err) {
      console.error('Failed to send account-removed email:', err.message);
    }
  }

  new ApiResponse(200, { emailSent }, 'Member removed and account deleted').send(res);
}

module.exports = { listCooperativeMembers, removeMember };