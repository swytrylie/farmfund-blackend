const mongoose = require('mongoose');
const User = require('../models/User');
const CooperativeMember = require('../models/CooperativeMember');
const Farm = require('../models/Farm');
const Field = require('../models/Field');
const FarmingCycle = require('../models/FarmingCycle');
const FinancialRecord = require('../models/FinancialRecord');
const Budget = require('../models/Budget');
const Loan = require('../models/Loan');
const DismissedAlert = require('../models/DismissedAlert');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { recordAudit } = require('../utils/audit');
const {
  sendAccountSuspendedEmail,
  sendAccountReactivatedEmail,
  sendAccountDeletedByAdminEmail,
  sendAdminEmailChangeNotice,
  sendAdminPasswordResetRequest,
} = require('../utils/mailer');

// Real people only: not admins, and not someone who signed up but never entered
// the email code (those accounts can't log in).
const REAL_USER = { role: { $ne: 'admin' }, isEmailVerified: { $ne: false } };

const TYPE_LABEL = {
  owner: 'Cooperative Owner',
  finance_manager: 'Financial Manager',
  member: 'Member',
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ');

function toRow(u, membership) {
  const role = membership && membership.role;
  const coop = membership && membership.cooperative;
  return {
    id: String(u._id),
    firstName: u.firstName,
    lastName: u.lastName,
    name: fullName(u),
    email: u.email,
    type: role || 'individual',
    typeLabel: TYPE_LABEL[role] || 'Individual',
    org: coop && coop.name ? coop.name : null,
    status: u.isActive === false ? 'suspended' : 'active',
    statusReason: u.isActive === false ? u.statusReason || null : null,
    statusChangedAt: u.statusChangedAt || null,
    statusChangedBy: u.statusChangedBy && u.statusChangedBy.firstName ? fullName(u.statusChangedBy) : null,
    joined: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
  };
}

// Loads one ordinary (non-admin) account or throws the right error.
async function loadTarget(id, select) {
  const target = await User.findById(id).select(select || 'firstName lastName email role isActive statusReason');
  if (!target) throw ApiError.notFound('Account not found');
  if (target.role === 'admin') throw ApiError.forbidden("Admin accounts can't be changed from here");
  return target;
}

// GET /api/admin/users?search=&type=&status=&page=&limit=
async function listUsers(req, res) {
  const { search = '', type = 'all', status = 'all' } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const and = [REAL_USER];

  const terms = search.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  for (const term of terms) {
    const rx = new RegExp(escapeRegex(term), 'i');
    and.push({ $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] });
  }

  if (type === 'individual') {
    const memberIds = await CooperativeMember.distinct('user', { status: 'active' });
    and.push({ _id: { $nin: memberIds } });
  } else if (type !== 'all') {
    const ids = await CooperativeMember.distinct('user', { status: 'active', role: type });
    and.push({ _id: { $in: ids } });
  }

  if (status === 'active') and.push({ isActive: { $ne: false } });
  if (status === 'suspended') and.push({ isActive: false });

  const filter = { $and: and };

  const [total, activeCount, suspendedCount] = await Promise.all([
    User.countDocuments(filter),
    User.countDocuments({ ...REAL_USER, isActive: { $ne: false } }),
    User.countDocuments({ ...REAL_USER, isActive: false }),
  ]);

  const users = await User.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('statusChangedBy', 'firstName lastName')
    .lean();

  const memberships = users.length
    ? await CooperativeMember.find({ user: { $in: users.map((u) => u._id) }, status: 'active' })
        .populate('cooperative', 'name')
        .lean()
    : [];
  const byUser = new Map();
  for (const m of memberships) if (!byUser.has(String(m.user))) byUser.set(String(m.user), m);

  new ApiResponse(200, {
    users: users.map((u) => toRow(u, byUser.get(String(u._id)))),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    counts: { active: activeCount, suspended: suspendedCount },
  }).send(res);
}

// PATCH /api/admin/users/:id/suspend   { reason }
// Blocks login straight away: the access-token check (protect) reads isActive
// on every request, and the stored refresh token is wiped so the session
// can't be renewed either.
async function suspendUser(req, res) {
  const target = await loadTarget(req.params.id);
  if (String(target._id) === String(req.user._id)) throw ApiError.badRequest("You can't suspend your own account");
  if (target.isActive === false) throw ApiError.conflict('This account is already suspended');

  const reason = req.body.reason;
  const now = new Date();
  const updated = await User.findOneAndUpdate(
    { _id: target._id, role: { $ne: 'admin' }, isActive: { $ne: false } },
    {
      $set: { isActive: false, statusReason: reason, statusChangedAt: now, statusChangedBy: req.user._id },
      $unset: { refreshTokenHash: 1 },
    },
    { new: true }
  );
  if (!updated) throw ApiError.conflict('This account is already suspended');

  let emailSent = false;
  try {
    await sendAccountSuspendedEmail(target.email, target.firstName, reason);
    emailSent = true;
  } catch (err) {
    console.error('Failed to send suspended email:', err.message);
  }

  await recordAudit(req.user, 'user.suspend', {
    targetType: 'user', targetId: target._id, targetLabel: `${fullName(target)} <${target.email}>`,
    details: { reason, emailSent },
  });

  new ApiResponse(200, {
    id: String(target._id), status: 'suspended', statusReason: reason, statusChangedAt: now,
    statusChangedBy: fullName(req.user), emailSent,
  }, 'Account suspended').send(res);
}

// PATCH /api/admin/users/:id/reactivate
async function reactivateUser(req, res) {
  const target = await loadTarget(req.params.id);
  if (target.isActive !== false) throw ApiError.conflict('This account is not suspended');

  const now = new Date();
  const updated = await User.findOneAndUpdate(
    { _id: target._id, role: { $ne: 'admin' }, isActive: false },
    {
      $set: { isActive: true, statusChangedAt: now, statusChangedBy: req.user._id, failedLoginAttempts: 0 },
      $unset: { statusReason: 1, lockUntil: 1 },
    },
    { new: true }
  );
  if (!updated) throw ApiError.conflict('This account is not suspended');

  let emailSent = false;
  try {
    await sendAccountReactivatedEmail(target.email, target.firstName);
    emailSent = true;
  } catch (err) {
    console.error('Failed to send reactivated email:', err.message);
  }

  await recordAudit(req.user, 'user.reactivate', {
    targetType: 'user', targetId: target._id, targetLabel: `${fullName(target)} <${target.email}>`,
    details: { emailSent },
  });

  new ApiResponse(200, {
    id: String(target._id), status: 'active', statusReason: null, statusChangedAt: now,
    statusChangedBy: fullName(req.user), emailSent,
  }, 'Account reactivated').send(res);
}

// PATCH /api/admin/users/:id   { firstName?, lastName?, email? }
// Changing the email signs the person out everywhere and tells BOTH addresses.
async function updateUser(req, res) {
  const target = await loadTarget(req.params.id);

  const next = {};
  for (const key of ['firstName', 'lastName', 'email']) {
    if (req.body[key] !== undefined && req.body[key] !== target[key]) next[key] = req.body[key];
  }
  if (Object.keys(next).length === 0) {
    return new ApiResponse(200, { id: String(target._id), unchanged: true, emailSent: null }, 'Nothing to change').send(res);
  }

  const emailChanged = next.email !== undefined;
  if (emailChanged) {
    const taken = await User.findOne({ email: next.email, _id: { $ne: target._id } }).select('_id');
    if (taken) throw ApiError.conflict('That email is already used by another account');
  }

  const update = { $set: next };
  if (emailChanged) {
    // New address: no half-finished email change or old "wasn't me" link may survive.
    update.$unset = {
      refreshTokenHash: 1, pendingEmail: 1, emailUndoTokenHash: 1, emailUndoExpiresAt: 1, previousEmail: 1,
    };
  }

  let updated;
  try {
    updated = await User.findOneAndUpdate({ _id: target._id, role: { $ne: 'admin' } }, update, { new: true });
  } catch (err) {
    if (err && err.code === 11000) throw ApiError.conflict('That email is already used by another account');
    throw err;
  }
  if (!updated) throw ApiError.notFound('Account not found');

  let emailSent = null;
  if (emailChanged) {
    emailSent = false;
    const first = next.firstName || target.firstName;
    try {
      await sendAdminEmailChangeNotice(target.email, first, target.email, next.email, false);
      emailSent = true;
    } catch (err) {
      console.error('Failed to send email-change notice to the old address:', err.message);
    }
    try {
      await sendAdminEmailChangeNotice(next.email, first, target.email, next.email, true);
    } catch (err) {
      console.error('Failed to send email-change notice to the new address:', err.message);
    }
  }

  const before = { firstName: target.firstName, lastName: target.lastName, email: target.email };
  await recordAudit(req.user, 'user.update', {
    targetType: 'user', targetId: target._id, targetLabel: `${fullName(updated)} <${updated.email}>`,
    details: { before, after: next, emailSent },
  });

  new ApiResponse(200, {
    id: String(updated._id), firstName: updated.firstName, lastName: updated.lastName,
    name: fullName(updated), email: updated.email, emailSent,
  }, 'Account updated').send(res);
}

// POST /api/admin/users/:id/password-reset
// The admin never sets or sees a password. This emails the person a nudge to
// use the normal Forgot Password steps.
async function requestPasswordReset(req, res) {
  const target = await loadTarget(req.params.id);
  if (target.isActive === false) throw ApiError.conflict('This account is suspended. Reactivate it first.');

  try {
    await sendAdminPasswordResetRequest(target.email, target.firstName);
  } catch (err) {
    console.error('Failed to send password-reset request email:', err.message);
    throw ApiError.internal('Could not send the email right now. Please try again shortly.');
  }

  await recordAudit(req.user, 'user.password_reset_request', {
    targetType: 'user', targetId: target._id, targetLabel: `${fullName(target)} <${target.email}>`,
  });

  new ApiResponse(200, { emailSent: true }, 'Password reset email sent').send(res);
}

// DELETE /api/admin/users/:id
// Permanent. Refused (deleting nothing) when it would damage a cooperative's
// books: an owner, or someone with loans. Otherwise removes the account and
// everything that belongs only to it.
async function deleteUser(req, res) {
  const target = await loadTarget(req.params.id);
  if (String(target._id) === String(req.user._id)) throw ApiError.badRequest("You can't delete your own account");

  const ownership = await CooperativeMember.findOne({ user: target._id, role: 'owner', status: 'active' }).populate(
    'cooperative',
    'name'
  );
  if (ownership) {
    const coopName = ownership.cooperative && ownership.cooperative.name;
    throw ApiError.conflict(
      `${fullName(target)} owns ${coopName ? `"${coopName}"` : 'a cooperative'}, so the account can't be deleted. Suspend it instead.`
    );
  }
  const loanCount = await Loan.countDocuments({ farmer: target._id });
  if (loanCount > 0) {
    throw ApiError.conflict(
      `${fullName(target)} has ${loanCount} loan record${loanCount === 1 ? '' : 's'} in a cooperative's books, so the account can't be deleted. Suspend it instead.`
    );
  }

  const session = await mongoose.startSession();
  let deleted = false;
  try {
    await session.withTransaction(async () => {
      deleted = false;
      // The user delete is the gate: only one request can ever succeed.
      const gone = await User.findOneAndDelete({ _id: target._id, role: { $ne: 'admin' } }, { session });
      if (!gone) return;
      const farms = await Farm.find({ owner: target._id }).select('_id').session(session).lean();
      const farmIds = farms.map((f) => f._id);
      if (farmIds.length) {
        const fields = await Field.find({ farm: { $in: farmIds } }).select('_id').session(session).lean();
        const fieldIds = fields.map((f) => f._id);
        if (fieldIds.length) await FarmingCycle.deleteMany({ field: { $in: fieldIds } }, { session });
        await Field.deleteMany({ farm: { $in: farmIds } }, { session });
        await FinancialRecord.deleteMany({ farm: { $in: farmIds } }, { session });
        await Budget.deleteMany({ farm: { $in: farmIds } }, { session });
        await Farm.deleteMany({ owner: target._id }, { session });
      }
      await CooperativeMember.deleteMany({ user: target._id }, { session });
      await DismissedAlert.deleteMany({ user: target._id }, { session });
      deleted = true;
    });
  } finally {
    await session.endSession();
  }
  if (!deleted) throw ApiError.conflict('This account has already been deleted');

  let emailSent = false;
  try {
    await sendAccountDeletedByAdminEmail(target.email, target.firstName);
    emailSent = true;
  } catch (err) {
    console.error('Failed to send account-deleted email:', err.message);
  }

  await recordAudit(req.user, 'user.delete', {
    targetType: 'user', targetId: target._id, targetLabel: `${fullName(target)} <${target.email}>`,
    details: { emailSent },
  });

  new ApiResponse(200, { emailSent }, 'Account deleted').send(res);
}

module.exports = { listUsers, suspendUser, reactivateUser, updateUser, requestPasswordReset, deleteUser };