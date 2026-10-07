// Everything about one-time codes lives here, so signup, password change and
// email change all follow exactly the same safety rules:
//
//   1. Codes are never stored. Only a keyed hash (HMAC-SHA256) of the code is.
//      Someone who reads the database cannot read anyone's code.
//   2. A code allows 5 wrong guesses, then it is destroyed. A new one must be
//      requested. Each guess is counted BEFORE it is checked, in one atomic
//      database step, so firing many guesses at once cannot sneak extra
//      attempts through.
//   3. A new code can be requested once every 60 seconds, and at most 5 times
//      per hour per account. The 60-second gate is also one atomic step, so
//      sending many requests at once still produces only one email.
//   4. Codes come from a cryptographically secure random source (crypto.randomInt),
//      not Math.random.
const crypto = require('node:crypto');
const ApiError = require('./ApiError');

const OTP_TTL_MS = 10 * 60 * 1000; // a code works for 10 minutes
const MAX_ATTEMPTS = 5; // wrong guesses allowed per code
const RESEND_COOLDOWN_MS = 60 * 1000; // minimum gap between two codes
const MAX_SENDS_PER_WINDOW = 5; // codes per account per hour
const SEND_WINDOW_MS = 60 * 60 * 1000;

function tooMany(message, retryAfterSeconds) {
  return new ApiError(429, message, retryAfterSeconds ? { retryAfterSeconds } : null);
}

function waitText(seconds) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function secret() {
  const key = process.env.OTP_SECRET || process.env.JWT_ACCESS_SECRET;
  if (!key) throw new Error('OTP_SECRET (or JWT_ACCESS_SECRET) must be set');
  return key;
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

// The user id and purpose are part of what gets hashed, so a hash copied
// from one account (or one purpose) can never be valid for another.
function hashCode(userId, purpose, code) {
  return crypto.createHmac('sha256', secret()).update(`${userId}:${purpose}:${code}`).digest('hex');
}

function hashesMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// The database fields that describe one fresh code. Used directly when an
// account is first created, and by issueOtp for every later code.
function buildOtp(userId, purpose, now = new Date(), sendWindowStart = now, sendCount = 1) {
  const code = generateCode();
  return {
    code,
    fields: {
      otpHash: hashCode(userId, purpose, code),
      otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
      otpPurpose: purpose,
      otpAttempts: 0,
      otpLastSentAt: now,
      otpSendWindowStart: sendWindowStart,
      otpSendCount: sendCount,
    },
  };
}

// Creates a new code for an EXISTING account, enforcing the 60-second gap and
// the per-hour cap. Returns the plain code (to put in the email — it is not
// kept anywhere). Throws a 429 with a plain-language message if it is too soon.
async function issueOtp(User, userId, purpose, extraFields = {}) {
  const now = new Date();
  const current = await User.findById(userId).select('+otpLastSentAt +otpSendWindowStart +otpSendCount');
  if (!current) throw ApiError.badRequest('Account not found');

  let windowStart = current.otpSendWindowStart;
  let count = current.otpSendCount || 0;
  if (!windowStart || now.getTime() - windowStart.getTime() >= SEND_WINDOW_MS) {
    windowStart = now;
    count = 0;
  }
  if (count >= MAX_SENDS_PER_WINDOW) {
    const wait = Math.max(1, Math.ceil((windowStart.getTime() + SEND_WINDOW_MS - now.getTime()) / 1000));
    throw tooMany(`Too many codes requested for this account. Please try again in ${waitText(wait)}.`, wait);
  }

  const { code, fields } = buildOtp(userId, purpose, now, windowStart, count + 1);
  const cutoff = new Date(now.getTime() - RESEND_COOLDOWN_MS);

  // The 60-second gate: this update only goes through if the last code was
  // sent more than 60 seconds ago. Two requests at the same moment cannot
  // both pass.
  const claimed = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [{ otpLastSentAt: { $exists: false } }, { otpLastSentAt: null }, { otpLastSentAt: { $lte: cutoff } }],
    },
    { $set: { ...fields, ...extraFields } },
    { new: true }
  );

  if (!claimed) {
    const latest = await User.findById(userId).select('+otpLastSentAt');
    const sentAt = latest?.otpLastSentAt ? latest.otpLastSentAt.getTime() : now.getTime();
    const wait = Math.max(1, Math.ceil((sentAt + RESEND_COOLDOWN_MS - now.getTime()) / 1000));
    throw tooMany(`Please wait ${waitText(wait)} before requesting another code.`, wait);
  }

  return code;
}

// If the email could not be sent, the person should be able to try again
// straight away instead of waiting out the 60 seconds for nothing.
async function releaseCooldown(User, userId) {
  await User.updateOne({ _id: userId }, { $unset: { otpLastSentAt: 1 } });
}

// Checks a code the person typed. On success the code is used up (it cannot
// be used twice). On failure it throws, and counts the wrong guess.
async function checkAndConsumeOtp(User, userId, purpose, code) {
  const now = new Date();
  const user = await User.findById(userId).select('+otpHash +otpExpiresAt +otpPurpose +otpAttempts');

  if (
    !user ||
    user.otpPurpose !== purpose ||
    !user.otpHash ||
    !user.otpExpiresAt ||
    user.otpExpiresAt < now
  ) {
    throw ApiError.badRequest('Invalid or expired code');
  }

  // Use up one guess BEFORE looking at the code. If the guesses are already
  // used up, this finds nothing and the code is destroyed.
  const claimed = await User.findOneAndUpdate(
    { _id: userId, otpHash: user.otpHash, otpPurpose: purpose, otpAttempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { otpAttempts: 1 } },
    { new: true }
  ).select('+otpHash +otpAttempts');

  if (!claimed) {
    await destroyOtp(User, userId, user.otpHash);
    throw tooMany('Too many incorrect attempts. Please request a new code.');
  }

  if (!hashesMatch(claimed.otpHash, hashCode(userId, purpose, code))) {
    const left = MAX_ATTEMPTS - claimed.otpAttempts;
    if (left <= 0) {
      await destroyOtp(User, userId, claimed.otpHash);
      throw tooMany('Too many incorrect attempts. Please request a new code.');
    }
    throw ApiError.badRequest(`Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`);
  }

  // Correct. Use the code up in one step so two requests at the same moment
  // cannot both succeed with it.
  const used = await User.findOneAndUpdate(
    { _id: userId, otpHash: claimed.otpHash, otpPurpose: purpose },
    { $unset: { otpHash: 1, otpExpiresAt: 1, otpPurpose: 1, otpAttempts: 1 } }
  );
  if (!used) throw ApiError.badRequest('Invalid or expired code');
}

// Throws away a code (and anything that was waiting on it).
async function destroyOtp(User, userId, onlyIfHash) {
  await User.updateOne(
    { _id: userId, otpHash: onlyIfHash },
    { $unset: { otpHash: 1, otpExpiresAt: 1, otpPurpose: 1, otpAttempts: 1, pendingPasswordHash: 1, pendingEmail: 1 } }
  );
}

module.exports = {
  OTP_TTL_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  MAX_SENDS_PER_WINDOW,
  SEND_WINDOW_MS,
  generateCode,
  hashCode,
  buildOtp,
  issueOtp,
  releaseCooldown,
  checkAndConsumeOtp,
};