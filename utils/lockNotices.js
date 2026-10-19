const User = require('../models/User');
const Notification = require('../models/Notification');

const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ') || 'A user';

/**
 * To every active admin: someone who is locked out sent a message. It lands in
 * the admin's bell. Never throws: the message itself is already saved.
 */
async function tellAdminsAboutLock(user, message) {
  try {
    const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
    const name = fullName(user);
    await Promise.all(
      admins.map((a) =>
        Notification.create({
          user: a._id,
          kind: 'account_locked',
          title: 'Locked account needs help',
          message: `${name} is locked out and sent you a message.`.slice(0, 200),
          details: { farmerName: name.slice(0, 200), contactEmail: user.email, reason: String(message).slice(0, 300) },
          lockedUser: user._id,
        })
      )
    );
  } catch (err) {
    console.error('Could not tell the admins about a locked account:', err && err.message);
  }
}

// An admin dealt with it (unlocked the account): the alerts are done.
async function clearLockAlerts(userId) {
  try {
    await Notification.updateMany(
      { kind: 'account_locked', lockedUser: userId, readAt: { $exists: false } },
      { $set: { readAt: new Date() } }
    );
  } catch (err) {
    console.error('Could not clear the locked-account alerts:', err && err.message);
  }
}

module.exports = { tellAdminsAboutLock, clearLockAlerts };