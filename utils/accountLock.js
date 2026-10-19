/**
 * Account lockout
 * ---------------
 * Four wrong passwords in a row on an account that exists lock it. The first
 * lock lasts 15 minutes; every later lock lasts 30 minutes, which is the most
 * it ever gets. After a lock ends the person gets four fresh tries, and if
 * those fail too the next (30 minute) lock starts. A correct password, an
 * admin unlock or a password reset starts everything over.
 *
 * The server's lockUntil is the only clock that counts: the browser just
 * shows it. That is why a page refresh can never restart the countdown.
 */

const MAX_FAILED_ATTEMPTS = 4;
const LOCK_MINUTES = [15, 30]; // first lock, then every later lock (the cap)

// The extra User fields to load wherever the lock is read or changed.
const LOCK_SELECT = '+failedLoginAttempts +lockUntil +lockLevel +lockedAt +lockRequestedAt';

// A single update that clears every sign of a lock (admin unlock, reset).
const CLEAR_LOCK = {
  $set: { failedLoginAttempts: 0, lockLevel: 0 },
  $unset: { lockUntil: 1, lockedAt: 1, lockRequestMessage: 1, lockRequestedAt: 1 },
};

function lockMinutesFor(lockCount) {
  const i = Math.min(Math.max(Number(lockCount) || 1, 1), LOCK_MINUTES.length) - 1;
  return LOCK_MINUTES[i];
}

// Counts one wrong password. Returns true when this was the one that locked
// the account. The caller saves the user.
function registerFailedAttempt(user, now = Date.now()) {
  user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
  if (user.failedLoginAttempts < MAX_FAILED_ATTEMPTS) return false;

  user.lockLevel = (user.lockLevel || 0) + 1;
  user.lockedAt = new Date(now);
  user.lockUntil = new Date(now + lockMinutesFor(user.lockLevel) * 60 * 1000);
  user.failedLoginAttempts = 0;
  // A message to the admin belongs to ONE lock: a new lock starts without one.
  user.lockRequestMessage = undefined;
  user.lockRequestedAt = undefined;
  return true;
}

// Same thing for a document that is about to be saved after a correct login.
function clearLockOn(user) {
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  user.lockLevel = 0;
  user.lockedAt = undefined;
  user.lockRequestMessage = undefined;
  user.lockRequestedAt = undefined;
}

// Did the person already write to the admin during THIS lock? (A lock that
// began before lockedAt was recorded has no start time: any message counts.)
function requestSent(user) {
  if (!user.lockRequestedAt) return false;
  if (!user.lockedAt) return true;
  return new Date(user.lockRequestedAt) >= new Date(user.lockedAt);
}

// What the browser needs to show the lock screen. secondsLeft is worked out on
// the server so a wrong clock on the person's computer can't skew the timer.
function lockDetails(user, now = Date.now()) {
  const until = new Date(user.lockUntil).getTime();
  return {
    lockedAt: user.lockedAt ? new Date(user.lockedAt).toISOString() : null,
    lockedUntil: new Date(until).toISOString(),
    secondsLeft: Math.max(0, Math.ceil((until - now) / 1000)),
    minutes: lockMinutesFor(user.lockLevel),
    lockCount: user.lockLevel || 1,
    requestSent: requestSent(user),
  };
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  LOCK_MINUTES,
  LOCK_SELECT,
  CLEAR_LOCK,
  lockMinutesFor,
  registerFailedAttempt,
  clearLockOn,
  requestSent,
  lockDetails,
};