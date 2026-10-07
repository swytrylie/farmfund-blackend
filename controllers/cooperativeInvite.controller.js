const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const CooperativeInvite = require('../models/CooperativeInvite');
const CooperativeMember = require('../models/CooperativeMember');
const Cooperative = require('../models/Cooperative');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { assertCooperativeStaffOrAdmin } = require('../utils/cooperativeMembership');
const { sendInviteEmail } = require('../utils/mailer');

const SALT_ROUNDS = 12;

// POST /api/cooperative-invites
// Creating an invite is restricted the same way editing the cooperative's
// own profile is — owner/finance_manager of THAT specific cooperative.
async function createInvite(req, res) {
  const { cooperative: cooperativeId, email, role } = req.body;

  await assertCooperativeStaffOrAdmin(cooperativeId, req.user);

  const coop = await Cooperative.findById(cooperativeId);
  if (!coop) throw ApiError.notFound('Cooperative not found');

  // Someone who already has a FarmFund account should be added a
  // different way (not built yet) — this flow is specifically for
  // someone brand new, so a real existing account with this email means
  // the wrong flow is being used.
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw ApiError.conflict('An account with this email already exists — this invite flow is only for brand-new accounts');
  }

  const existingPendingInvite = await CooperativeInvite.findOne({ cooperative: cooperativeId, email, status: 'pending' });
  if (existingPendingInvite) {
    throw ApiError.conflict('A pending invite already exists for this email');
  }

  // "Up to 3 finance_manager" can't be expressed as a database unique
  // index (that only ever allows 0 or 1, never "up to N") — enforced
  // here instead, at the only place new ones ever get created.
  if (role === 'finance_manager') {
    const activeCount = await CooperativeMember.countDocuments({
      cooperative: cooperativeId,
      role: 'finance_manager',
      status: 'active',
    });
    const pendingInviteCount = await CooperativeInvite.countDocuments({
      cooperative: cooperativeId,
      role: 'finance_manager',
      status: 'pending',
    });
    if (activeCount + pendingInviteCount >= 3) {
      throw ApiError.badRequest('This cooperative already has the maximum of 3 finance managers (including pending invites)');
    }
  }

  const invite = await CooperativeInvite.create({
    cooperative: cooperativeId,
    email,
    role,
    invitedBy: req.user._id,
  });

  // Email delivery is attempted but never allowed to fail the whole
  // request — the invite itself is already genuinely created and usable
  // via its real link either way, so a flaky email send shouldn't undo
  // that or confuse the caller with a false error.
  const inviteLink = `${process.env.FRONTEND_URL}/accept-invite?token=${invite.token}`;
  try {
    await sendInviteEmail(email, inviteLink, coop.name);
  } catch (err) {
    console.error('Failed to send invite email:', err.message);
  }

  new ApiResponse(201, invite, 'Invite created successfully').send(res);
}

// GET /api/cooperative-invites?cooperative=X
// Viewing pending invites uses the same broader rule as viewing the
// cooperative itself — any active member, not just owner/finance_manager.
async function listInvites(req, res) {
  const { cooperative: cooperativeId } = req.query;

  if (req.user.role !== 'admin') {
    const membership = await CooperativeMember.findOne({
      cooperative: cooperativeId,
      user: req.user._id,
      status: 'active',
    });
    if (!membership) throw ApiError.forbidden('You do not have access to this resource');
  }

  const invites = await CooperativeInvite.find({ cooperative: cooperativeId, status: 'pending' })
    .select('email role status expiresAt createdAt')
    .sort({ createdAt: -1 })
    .lean();

  new ApiResponse(200, invites, 'Invites retrieved successfully').send(res);
}

// DELETE /api/cooperative-invites/:id  — revoke a pending invite
async function revokeInvite(req, res) {
  const invite = await CooperativeInvite.findById(req.params.id);
  if (!invite) throw ApiError.notFound('Invite not found');

  await assertCooperativeStaffOrAdmin(invite.cooperative, req.user);

  invite.status = 'revoked';
  await invite.save();

  new ApiResponse(200, null, 'Invite revoked successfully').send(res);
}

// GET /api/cooperative-invites/:token  — PUBLIC, no auth
// The invitee doesn't have an account yet, so this can't require a
// session — the token itself IS the proof of authorization here.
async function getInviteByToken(req, res) {
  const invite = await CooperativeInvite.findOne({ token: req.params.token }).populate('cooperative', 'name');
  if (!invite) throw ApiError.notFound('Invite not found');
  if (invite.status !== 'pending') throw ApiError.badRequest('This invite has already been used or revoked');
  if (invite.expiresAt < new Date()) throw ApiError.badRequest('This invite has expired');

  new ApiResponse(200, {
    email: invite.email,
    role: invite.role,
    cooperativeName: invite.cooperative?.name,
  }).send(res);
}

// POST /api/cooperative-invites/:token/accept  — PUBLIC, no auth
// Atomic, same pattern as the original organization signup transaction:
// creates the real User + CooperativeMember together, and marks the
// invite accepted, all in one transaction — if any step fails, none of
// it is kept.
async function acceptInvite(req, res) {
  const { firstName, lastName, password } = req.body;

  const invite = await CooperativeInvite.findOne({ token: req.params.token });
  if (!invite) throw ApiError.notFound('Invite not found');
  if (invite.status !== 'pending') throw ApiError.badRequest('This invite has already been used or revoked');
  if (invite.expiresAt < new Date()) throw ApiError.badRequest('This invite has expired');

  const existingUser = await User.findOne({ email: invite.email });
  if (existingUser) throw ApiError.conflict('An account with this email already exists');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const session = await mongoose.startSession();
  let user;
  try {
    await session.withTransaction(async () => {
      const createdUsers = await User.create(
        [{ firstName, lastName, email: invite.email, passwordHash, role: 'user' }],
        { session }
      );
      user = createdUsers[0];

      await CooperativeMember.create(
        [{ cooperative: invite.cooperative, user: user._id, role: invite.role, status: 'active' }],
        { session }
      );

      invite.status = 'accepted';
      await invite.save({ session });
    });
  } finally {
    await session.endSession();
  }

  new ApiResponse(201, {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
  }, 'Account created successfully').send(res);
}

module.exports = { createInvite, listInvites, revokeInvite, getInviteByToken, acceptInvite };