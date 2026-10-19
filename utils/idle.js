const ApiError = require('./ApiError');

/**
 * Idle sign-out
 * -------------
 * A session ends when its user has not DONE anything for IDLE_TIMEOUT_MINUTES
 * (default 10). "Done something" means the browser told us so: the frontend
 * sends a small POST /api/auth/activity ping when the person clicks, types,
 * scrolls or moves the mouse. Background requests (notification polling, token
 * renewal) are NOT activity — otherwise an open, untouched tab would keep its
 * session alive forever.
 *
 * The browser already signs the person out by itself at exactly 10 minutes.
 * This is the server-side backstop, for the cases the browser can't cover (the
 * tab was closed, the computer slept, a copied cookie is replayed). It allows
 * one extra minute because pings are throttled to one every 30 seconds, so the
 * stored time can trail the person's real last action by up to that long.
 */

const PING_GRACE_MS = 60 * 1000;
const SESSION_IDLE_CODE = 'SESSION_IDLE';

function idleMinutes() {
  const n = Number(process.env.IDLE_TIMEOUT_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function idleLimitMs() {
  return idleMinutes() * 60 * 1000 + PING_GRACE_MS;
}

// A user with no recorded activity (a session that began before this feature
// existed) is not treated as idle; the first ping or login records one.
function isIdle(user, now = Date.now()) {
  if (!user || !user.lastActivityAt) return false;
  const last = new Date(user.lastActivityAt).getTime();
  if (Number.isNaN(last)) return false;
  return now - last > idleLimitMs();
}

function idleError() {
  const err = ApiError.unauthorized(`You were signed out after ${idleMinutes()} minutes of inactivity.`);
  err.errorCode = SESSION_IDLE_CODE;
  return err;
}

module.exports = { isIdle, idleError, idleMinutes, idleLimitMs, SESSION_IDLE_CODE, PING_GRACE_MS };