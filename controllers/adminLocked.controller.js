const User = require('../models/User');
const CooperativeMember = require('../models/CooperativeMember');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { recordAudit } = require('../utils/audit');
const { sendAccountUnlockedEmail } = require('../utils/mailer');
const { CLEAR_LOCK, lockMinutesFor, requestSent } = require('../utils/accountLock');
const { clearLockAlerts } = require('../utils/lockNotices');

// Ordinary accounts only. An admin's own lock simply runs out by itself.
const NOT_ADMIN = { role: { $ne: 'admin' } };
const LOCK_FIELDS = '+lockUntil +lockedAt +lockLevel +lockRequestMessage +lockRequestedAt';

const TYPE_LABEL = { owner: 'Cooperative Owner', finance_manager: 'Financial Manager', member: 'Member' };
const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ');

// "Needs attention": the lock is running, or the person wrote to the admin and
// nobody has unlocked them yet (even if the lock has since run out).
const needsAttention = (now) => ({
  ...NOT_ADMIN,
  $or: [{ lockUntil: { $gt: now } }, { lockRequestedAt: { $exists: true } }],
});

function toRow(u, membership, now) {
  const until = u.lockUntil ? new Date(u.lockUntil) : null;
  const locked = Boolean(until && until > now);
  const role = membership && membership.role;
  const coop = membership && membership.cooperative;
  return {
    id: String(u._id),
    name: fullName(u),
    email: u.email,
    type: role || 'individual',
    typeLabel: TYPE_LABEL[role] || 'Individual',
    org: coop && coop.name ? coop.name : null,
    locked,
    lockedAt: u.lockedAt || null,
    lockedUntil: until,
    secondsLeft: locked ? Math.max(0, Math.ceil((until - now) / 1000)) : 0,
    lockCount: u.lockLevel || (locked ? 1 : 0),
    lockMinutes: lockMinutesFor(u.lockLevel || 1),
    message: requestSent(u) ? u.lockRequestMessage || null : null,
    requestedAt: requestSent(u) ? u.lockRequestedAt || null : null,
  };
}

// GET /api/admin/locked-accounts
// Every account that is locked right now, plus anyone who asked for help and is
// still waiting. People who wrote to the admin come first, newest first.
async function listLockedAccounts(req, res) {
  const now = new Date();
  const users = await User.find(needsAttention(now)).select(LOCK_FIELDS).lean();

  const memberships = users.length
    ? await CooperativeMember.find({ user: { $in: users.map((u) => u._id) }, status: 'active' }).populate('cooperative', 'name')
    : [];
  const byUser = new Map(memberships.map((m) => [String(m.user), m]));

  const rows = users.map((u) => toRow(u, byUser.get(String(u._id)), now));
  rows.sort((a, b) => {
    const ar = a.requestedAt ? new Date(a.requestedAt).getTime() : 0;
    const br = b.requestedAt ? new Date(b.requestedAt).getTime() : 0;
    if (ar !== br) return br - ar;
    return (b.lockedAt ? new Date(b.lockedAt).getTime() : 0) - (a.lockedAt ? new Date(a.lockedAt).getTime() : 0);
  });

  new ApiResponse(200, {
    accounts: rows,
    counts: { locked: rows.filter((r) => r.locked).length, waiting: rows.filter((r) => r.message).length },
  }, 'Locked accounts fetched').send(res);
}

// POST /api/admin/locked-accounts/:id/unlock
async function unlockAccount(req, res) {
  const now = new Date();
  const target = await User.findOne({ _id: req.params.id, ...NOT_ADMIN }).select('firstName lastName email role');
  if (!target) throw ApiError.notFound('Account not found');

  // One atomic step, so two admins pressing the button can't both "win".
  const result = await User.updateOne({ _id: target._id, ...needsAttention(now) }, CLEAR_LOCK);
  if (!result.matchedCount) throw ApiError.conflict('This account is not locked');

  await clearLockAlerts(target._id);

  let emailSent = false;
  try {
    await sendAccountUnlockedEmail(target.email, target.firstName);
    emailSent = true;
  } catch (err) {
    console.error('Failed to send the account-unlocked email:', err.message);
  }

  await recordAudit(req.user, 'user.unlock', {
    targetType: 'user', targetId: target._id, targetLabel: `${fullName(target)} <${target.email}>`,
    details: { emailSent },
  });

  new ApiResponse(200, { id: String(target._id), unlocked: true, emailSent }, 'Account unlocked').send(res);
}

module.exports = { listLockedAccounts, unlockAccount };