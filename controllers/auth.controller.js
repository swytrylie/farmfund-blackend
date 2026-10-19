const crypto = require('node:crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Cooperative = require('../models/Cooperative');
const CooperativeMember = require('../models/CooperativeMember');
const { sendOtpEmail, sendEmailChangedNotice } = require('../utils/mailer');
const { recordLoginEvent } = require('../utils/loginEvents');
const { buildOtp, issueOtp, releaseCooldown, checkAndConsumeOtp } = require('../utils/otp');
const { consentFields } = require('../utils/terms');
const { isIdle, idleError } = require('../utils/idle');
const { LOCK_SELECT, registerFailedAttempt, clearLockOn, lockDetails, requestSent } = require('../utils/accountLock');
const { tellAdminsAboutLock } = require('../utils/lockNotices');

// Shared by login() and getMe() — a User's role is only ever "user" or
// "admin"; organization membership lives entirely in CooperativeMember, a
// separate collection neither endpoint would otherwise touch. Factored out
// once here specifically so the two can never drift out of sync the way
// they did before this fix (login() had this check, getMe() didn't, so a
// page refresh silently lost accountType and fell back to the farmer
// dashboard even for a real organization account).
async function getAccountTypeFields(userId) {
  const membership = await CooperativeMember.findOne({ user: userId, status: 'active' }).populate('cooperative', 'name status');
  if (!membership) return {};
  return {
    accountType: 'organization',
    orgName: membership.cooperative?.name,
    orgRole: membership.role,
    cooperativeId: membership.cooperative?._id,
    cooperativeStatus: membership.cooperative?.status,
  };
}

// An organization account (owner OR staff) can only be used once an admin has
// approved the cooperative. While it is still "pending" or was "rejected", they
// can verify their email but cannot sign in. Returns the message to show, or
// null when there is no problem (individual accounts, admins, and approved
// cooperatives all return null).
function suspendedMessage(reason) {
  const why = reason ? ` Reason: ${reason}.` : '';
  return `Your account has been suspended.${why} If you think this is a mistake, please contact support.`;
}

const COOP_PENDING_MESSAGE =
  "Your organization is still waiting for admin approval. We'll email you as soon as it's approved.";
const COOP_REJECTED_MESSAGE =
  "Your organization's application was declined, so this account can't be used. If you think this is a mistake, please contact support.";

async function getCooperativeBlockMessage(userId) {
  const membership = await CooperativeMember.findOne({ user: userId, status: 'active' }).populate('cooperative', 'status');
  const status = membership?.cooperative?.status;
  if (status === 'pending') return COOP_PENDING_MESSAGE;
  if (status === 'rejected') return COOP_REJECTED_MESSAGE;
  return null;
}

const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require('../utils/jwt');

const SALT_ROUNDS = 12;

// A wrong password counts toward the same lockout (4 strikes: a 15 minute lock,
// then 30 minutes each time, see utils/accountLock.js) everywhere a password is
// checked — login, and the "confirm with your password" steps of password
// change and email change. Otherwise someone holding a logged-in session could
// guess passwords through those pages without limit.
// Caller must have loaded LOCK_SELECT (the lock fields).
async function recordFailedPassword(user) {
  registerFailedAttempt(user);
  await user.save();
}

// The "account locked" answer. Besides the message it carries when the lock
// ends (worked out here, by the server's clock) and whether the person already
// wrote to the admin, so the lock screen can show the real countdown.
function lockedError(user) {
  const err = ApiError.forbidden(LOCKED_MESSAGE);
  err.errorCode = 'ACCOUNT_LOCKED';
  err.details = lockDetails(user);
  return err;
}

const UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // how long the "wasn't me" link works
const RESET_TICKET_MS = 10 * 60 * 1000; // how long a verified forgot-password session lasts

const LOCKED_MESSAGE = 'Account temporarily locked due to too many failed attempts. Try again later.';

const REFRESH_COOKIE_NAME = 'refreshToken';
const isProd = process.env.NODE_ENV === 'production';
const refreshCookieOptions = {
  httpOnly: true, // JavaScript can never read this cookie — blocks XSS token theft
  secure: isProd, // HTTPS only in production
  sameSite: isProd ? 'none' : 'lax', // 'none' in prod: frontend and backend are on different domains
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days, matches JWT_REFRESH_EXPIRES default
  path: '/api/auth', // only sent to auth endpoints, not the whole API
};

// Signing up again with an email whose account was never verified.
//
// The earlier attempt is replaced by this one: the details and password the
// person just typed win, any organization they started is updated to match
// (or created / removed if they switched account type), and a fresh code is
// sent — the old code stops working. Nobody can log in until the code from
// the inbox is entered, so only the real owner of the address can finish.
//
// Replacing (rather than keeping the first attempt's password) is deliberate:
// otherwise someone could sign up with a stranger's email and a password of
// their own, and the real owner would later "finish" that account.
//
// The usual limits apply first — one code per 60 seconds, 5 per hour — and
// nothing is changed if they are hit.
async function restartPendingSignup(userId, req, res) {
  const { firstName, lastName, email, password, phone, orgName } = req.body;

  const otpCode = await issueOtp(User, userId, 'signup');
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const session = await mongoose.startSession();
  let user, cooperative;

  try {
    await session.withTransaction(async () => {
      user = await User.findById(userId).session(session);
      user.firstName = firstName;
      user.lastName = lastName;
      user.phone = phone;
      user.passwordHash = passwordHash;
      // They just agreed to the Terms again on this attempt, so record that one.
      Object.assign(user, consentFields(req.body));
      await user.save({ session });

      const membership = await CooperativeMember.findOne({ user: userId, role: 'owner' }).session(session);
      const coop = membership ? await Cooperative.findById(membership.cooperative).session(session) : null;
      const coopIsStillPending = !!coop && coop.status === 'pending';

      if (orgName) {
        if (coopIsStillPending) {
          coop.name = orgName;
          coop.contactEmail = email;
          coop.contactPhone = phone;
          await coop.save({ session });
          cooperative = coop;
        } else if (!coop) {
          const createdCoop = await Cooperative.create(
            [{ name: orgName, contactEmail: email, contactPhone: phone, status: 'pending' }],
            { session }
          );
          cooperative = createdCoop[0];
          await CooperativeMember.create(
            [{ cooperative: cooperative._id, user: user._id, role: 'owner', status: 'active' }],
            { session }
          );
        } else {
          cooperative = coop; // already reviewed by an admin: leave it exactly as it is
        }
      } else if (coopIsStillPending) {
        // They started as an organization but came back as an individual.
        await CooperativeMember.deleteOne({ _id: membership._id }, { session });
        await Cooperative.deleteOne({ _id: coop._id }, { session });
      }
    });
  } finally {
    await session.endSession();
  }

  try {
    await sendOtpEmail(email, otpCode, 'your new account');
  } catch (err) {
    console.error('Failed to send signup OTP email:', err.message);
  }

  new ApiResponse(201, {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    ...(cooperative ? { cooperative: { id: cooperative._id, name: cooperative.name, status: cooperative.status } } : {}),
  }, 'Account created — check your email for a verification code').send(res);
}

// POST /api/auth/register
// orgName is optional. When present, this is an Organization sign-up: the
// User, a new Cooperative (status: "pending", awaiting admin approval —
// same flow the admin dashboard's "Pending approvals" is meant to drive),
// and a CooperativeMember linking this user as that cooperative's owner
// are all created together, in one real step. Without orgName, this is a
// plain Individual sign-up, unchanged from before.
//
// All three writes happen inside one MongoDB transaction — if creating the
// Cooperative or CooperativeMember fails partway through, the User creation
// is rolled back too, rather than leaving an orphaned account with no
// cooperative, or a cooperative with no owner.
async function register(req, res) {
  const { firstName, lastName, email, password, phone, orgName } = req.body;

  const existing = await User.findOne({ email }).select('_id isEmailVerified');
  // A VERIFIED account is a real, finished account: the email is taken.
  if (existing && existing.isEmailVerified !== false) {
    throw ApiError.conflict('An account with this email already exists');
  }
  // An account that was never verified is just a half-finished sign-up (the
  // person closed the tab, or went back to the form). It must not lock the
  // email forever, so signing up again restarts it instead of refusing.
  if (existing) return restartPendingSignup(existing._id, req, res);

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const session = await mongoose.startSession();
  let user, cooperative;

  // The id is made up front so the code's hash can be tied to this account
  // as it is created. Only the HASH of the code is saved; the code itself
  // exists just long enough to go into the email.
  const userId = new mongoose.Types.ObjectId();
  const { code: otpCode, fields: otpFields } = buildOtp(userId, 'signup');

  try {
    await session.withTransaction(async () => {
      const created = await User.create(
        [{ _id: userId, firstName, lastName, email, passwordHash, phone, isEmailVerified: false, ...consentFields(req.body), ...otpFields }],
        { session }
      );
      user = created[0];

      if (orgName) {
        const createdCoop = await Cooperative.create(
          [{ name: orgName, contactEmail: email, contactPhone: phone, status: 'pending' }],
          { session }
        );
        cooperative = createdCoop[0];

        await CooperativeMember.create(
          [{ cooperative: cooperative._id, user: user._id, role: 'owner', status: 'active' }],
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  // Attempted but never allowed to fail the whole signup — the account
  // is already genuinely created at this point; a flaky send shouldn't
  // undo that. resendSignupOtp below exists for exactly this case.
  try {
    await sendOtpEmail(email, otpCode, 'your new account');
  } catch (err) {
    console.error('Failed to send signup OTP email:', err.message);
  }

  // No accessToken here — this account genuinely cannot log in yet,
  // until verifySignupOtp confirms the code and flips isEmailVerified.
  new ApiResponse(201, {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    ...(cooperative ? { cooperative: { id: cooperative._id, name: cooperative.name, status: cooperative.status } } : {}),
  }, 'Account created — check your email for a verification code').send(res);
}

// POST /api/auth/verify-signup
// Confirms the OTP sent during register(), flips isEmailVerified to
// true, then logs them in immediately — same token-issuing shape as
// login() itself, so the frontend can treat a successful verification
// exactly like a successful login.
async function verifySignupOtp(req, res) {
  const { email, code } = req.body;

  const found = await User.findOne({ email }).select('_id');
  if (!found) throw ApiError.badRequest('Invalid or expired code');

  // Throws if the code is wrong, expired, or out of attempts; otherwise the
  // code is used up and we carry on.
  await checkAndConsumeOtp(User, found._id, 'signup', code);

  const user = await User.findById(found._id);
  user.isEmailVerified = true;

  // An organization sign-up has to be approved by an admin first, so there is
  // no session to hand out yet: the email is confirmed, and that is all.
  const blockMessage = await getCooperativeBlockMessage(user._id);
  if (blockMessage) {
    await user.save();
    const accountFields = await getAccountTypeFields(user._id);
    new ApiResponse(200, {
      pendingApproval: true,
      orgName: accountFields.orgName,
      message: blockMessage,
    }, 'Email verified successfully').send(res);
    return;
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  user.refreshTokenHash = hashToken(refreshToken);
  user.lastLoginAt = new Date();
  user.lastActivityAt = user.lastLoginAt;
  await user.save();

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);

  new ApiResponse(200, {
    accessToken,
    user: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      ...(await getAccountTypeFields(user._id)),
    },
  }, 'Email verified successfully').send(res);
}

// POST /api/auth/resend-signup-otp — in case the first email was missed,
// delayed, or the code expired before they got to it.
async function resendSignupOtp(req, res) {
  const { email } = req.body;

  const user = await User.findOne({ email });
  if (!user) throw ApiError.badRequest('No pending signup found for this email');
  if (user.isEmailVerified !== false) {
    throw ApiError.badRequest('This account is already verified');
  }

  // Enforces the 60-second wait and the 5-per-hour limit (throws if too soon).
  const otpCode = await issueOtp(User, user._id, 'signup');

  try {
    await sendOtpEmail(email, otpCode, 'your new account');
  } catch (err) {
    console.error('Failed to resend signup OTP email:', err.message);
    await releaseCooldown(User, user._id);
    throw ApiError.internal('Could not send the email right now. Please try again shortly.');
  }

  new ApiResponse(200, null, 'A new code has been sent').send(res);
}

// Tags a login error with WHY it failed, for the admin "User Activity" log.
const withReason = (err, reason) => {
  err.loginReason = reason;
  return err;
};

// POST /api/auth/login
// Every attempt is written to the login log (best-effort, never breaks the
// login). A failure is an error carrying a loginReason; it is logged here,
// before the error response goes out. A success is logged inside loginCore,
// just BEFORE the response is sent: on a serverless host like Vercel the
// function can be frozen the moment the response leaves, so nothing may be
// left to do afterwards. Errors without a reason (server faults) are not logged.
async function login(req, res) {
  try {
    await loginCore(req, res);
  } catch (err) {
    if (err && err.loginReason) {
      await recordLoginEvent(req, { user: req.loginUserId, email: req.body && req.body.email, success: false, reason: err.loginReason });
    }
    throw err;
  }
}

async function loginCore(req, res) {
  const { email, password } = req.body;

  // Explicitly select passwordHash + lockout fields since the schema hides them by default
  const user = await User.findOne({ email }).select(`+passwordHash ${LOCK_SELECT}`);

  // Same generic error whether the email doesn't exist or the password is
  // wrong — never reveal which one, or attackers can enumerate real emails.
  const invalidCredentialsError = ApiError.unauthorized('Invalid email or password');

  if (!user) throw withReason(invalidCredentialsError, 'unknown_email');
  req.loginUserId = user._id;

  // A suspended account gets a real explanation — but only once the password
  // is proven right, so strangers can't learn which emails are suspended. A
  // wrong password stays the generic error and doesn't count toward lockout.
  if (!user.isActive) {
    const passwordIsRight = await user.comparePassword(password);
    if (!passwordIsRight) throw withReason(invalidCredentialsError, 'wrong_password');
    throw withReason(ApiError.forbidden(suspendedMessage(user.statusReason)), 'suspended');
  }

  // Deliberately checks for EXACTLY `false`, not just falsy — every
  // account created before this feature existed has no value here at
  // all (`undefined`), and is treated as already-verified rather than
  // retroactively locked out. Only an account created by the new signup
  // flow, which explicitly sets this to false, is genuinely blocked
  // until verify-signup confirms the code.
  if (user.isEmailVerified === false) {
    throw withReason(
      ApiError.forbidden('Please verify your email before logging in. Check your inbox for the code, or request a new one.'),
      'unverified'
    );
  }

  if (user.isLocked()) {
    throw withReason(lockedError(user), 'locked');
  }

  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    await recordFailedPassword(user);
    // The wrong password that used up the last try locks the account: say so
    // straight away instead of a plain "wrong password".
    if (user.isLocked()) throw withReason(lockedError(user), 'wrong_password');
    throw withReason(invalidCredentialsError, 'wrong_password');
  }

  // Right password, but the organization isn't approved (yet). Said only after
  // the password is proven, so strangers can't probe which emails belong to
  // pending cooperatives.
  const loginBlockMessage = await getCooperativeBlockMessage(user._id);
  if (loginBlockMessage) throw withReason(ApiError.forbidden(loginBlockMessage), 'org_not_approved');

  // Successful login: reset lockout counters, issue fresh tokens
  clearLockOn(user);
  user.lastLoginAt = new Date();
  user.lastActivityAt = user.lastLoginAt;

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  user.refreshTokenHash = hashToken(refreshToken);
  await user.save();

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);

  // A User's role is only ever "user" or "admin" — whether someone belongs
  // to an organization lives entirely in CooperativeMember, a separate
  // collection this query wouldn't otherwise touch. Checked here so EVERY
  // login (not just the one right after an organization sign-up) correctly
  // tells the frontend to show the Org Dashboard instead of the regular
  // one. Any active membership counts, regardless of the specific role
  // (owner, finance_manager, or member) — all of them belong to the
  // organization side of the app, even if what they can each do inside it
  // differs.
  const accountFields = await getAccountTypeFields(user._id);
  await recordLoginEvent(req, { user: user._id, email: req.body && req.body.email, success: true });

  new ApiResponse(200, {
    accessToken,
    user: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      ...accountFields,
    },
  }, 'Login successful').send(res);
}

// POST /api/auth/lock-status  { email }
// The lock screen asks this every 30 seconds so it notices when an admin
// unlocks the account. Says nothing the login itself would not already say.
async function lockStatus(req, res) {
  const user = await User.findOne({ email: req.body.email }).select(LOCK_SELECT);
  if (!user || user.role === 'admin' || !user.isLocked()) {
    return new ApiResponse(200, { locked: false }, 'Not locked').send(res);
  }
  new ApiResponse(200, { locked: true, ...lockDetails(user) }, 'Locked').send(res);
}

// POST /api/auth/lock-contact  { email, message }
// A locked-out person asking the admin for help. One message per lock; it
// shows up on the admin's Locked Accounts page and in their bell.
async function contactAdminAboutLock(req, res) {
  const { email, message } = req.body;
  const user = await User.findOne({ email }).select(`${LOCK_SELECT} +lockRequestMessage`);
  if (!user || user.role === 'admin' || !user.isLocked()) {
    return new ApiResponse(200, { sent: false }, 'This account is not locked').send(res);
  }
  if (requestSent(user)) {
    return new ApiResponse(200, { sent: true, alreadySent: true }, 'Your message was already sent to the admin').send(res);
  }
  // Only if the lock is still the same one: an unlock meanwhile must not be undone by a late message.
  const sameLock = { _id: user._id, lockUntil: { $gt: new Date() }, lockRequestedAt: { $exists: false } };
  if (user.lockedAt) sameLock.lockedAt = user.lockedAt;
  const saved = await User.updateOne(sameLock, { $set: { lockRequestMessage: message, lockRequestedAt: new Date() } });
  if (!saved.matchedCount) {
    return new ApiResponse(200, { sent: false }, 'This account is not locked').send(res);
  }
  await tellAdminsAboutLock(user, message);
  new ApiResponse(200, { sent: true }, 'Your message was sent to the admin').send(res);
}

// POST /api/auth/refresh  (reads the httpOnly cookie, not the body)
async function refresh(req, res) {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) throw ApiError.unauthorized('No refresh token provided');

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const user = await User.findById(payload.sub).select('+refreshTokenHash');
  if (!user || !user.isActive) throw ApiError.unauthorized('User no longer exists');

  // Compare against the stored hash — if it doesn't match, this token was
  // already rotated out (e.g. stolen + reused after the real user logged
  // in again), so treat it as a compromise and force a fresh login.
  if (!user.refreshTokenHash || hashToken(token) !== user.refreshTokenHash) {
    user.refreshTokenHash = undefined;
    await user.save();
    throw ApiError.unauthorized('Refresh token invalid — please log in again');
  }

  // Nobody has done anything for 10 minutes: end the session for good. The
  // stored token is revoked so the cookie can't be used again, and the reply
  // carries a code the browser uses to explain why the person was signed out.
  // (Renewing a token is NOT activity, so this never extends the session.)
  if (isIdle(user)) {
    user.refreshTokenHash = undefined;
    await user.save();
    res.clearCookie(REFRESH_COOKIE_NAME, {
      path: '/api/auth',
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
    });
    throw idleError();
  }

  // If an admin rejects (or re-opens) the cooperative while someone is logged
  // in, their session ends the next time it is renewed.
  const refreshBlockMessage = await getCooperativeBlockMessage(user._id);
  if (refreshBlockMessage) throw ApiError.forbidden(refreshBlockMessage);

  // Rotation: every refresh issues a brand new refresh token and
  // invalidates the old one, limiting how long a leaked token is useful.
  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);
  user.refreshTokenHash = hashToken(newRefreshToken);
  await user.save();

  res.cookie(REFRESH_COOKIE_NAME, newRefreshToken, refreshCookieOptions);

  new ApiResponse(200, { accessToken: newAccessToken }, 'Token refreshed').send(res);
}

// POST /api/auth/activity  (protected)
// The browser sends this when the person actually does something. It is the
// only thing that extends the idle timer. An already-idle session never gets
// here: protect() has ended it.
async function recordActivity(req, res) {
  const now = new Date();
  await User.updateOne({ _id: req.user._id }, { $set: { lastActivityAt: now } });
  new ApiResponse(200, { lastActivityAt: now }, 'Activity recorded').send(res);
}

// POST /api/auth/logout
async function logout(req, res) {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await User.findByIdAndUpdate(payload.sub, { $unset: { refreshTokenHash: 1 } });
    } catch {
      // token already invalid/expired — nothing to revoke, proceed to clear cookie anyway
    }
  }
  res.clearCookie(REFRESH_COOKIE_NAME, {
  path: '/api/auth',
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
});
  new ApiResponse(200, null, 'Logged out successfully').send(res);
}

// GET /api/auth/me  (requires `protect` middleware)
async function getMe(req, res) {
  new ApiResponse(200, {
    id: req.user._id,
    firstName: req.user.firstName,
    lastName: req.user.lastName,
    email: req.user.email,
    phone: req.user.phone,
    role: req.user.role,
    ...(await getAccountTypeFields(req.user._id)),
  }).send(res);
}

// Inside a cooperative, only the OWNER may change their own name and email.
// Finance managers and members can look at them but not edit — the owner is
// the one who knows who they invited and who they are. Everyone can still
// change their own password. Accounts that belong to no cooperative (an
// individual farmer, an admin) are not affected.
const STAFF_PROFILE_LOCKED_MESSAGE =
  "Only your cooperative's owner can change your name or email. You can still change your password.";

async function assertCanEditOwnProfile(userId) {
  const membership = await CooperativeMember.findOne({ user: userId, status: 'active' }).select('role');
  if (membership && membership.role !== 'owner') {
    throw ApiError.forbidden(STAFF_PROFILE_LOCKED_MESSAGE);
  }
}

// PATCH /api/auth/me
// Updates the LOGGED-IN user's own profile — req.user._id is used
// directly, never a client-supplied id, so there's no way to edit
// someone else's account through this endpoint.
async function updateProfile(req, res) {
  const { firstName, lastName, email, phone } = req.body;
  await assertCanEditOwnProfile(req.user._id);
  const user = await User.findById(req.user._id);

  // The email address is deliberately NOT changeable here. Switching it
  // without proving the new address is really yours would let anyone with a
  // logged-in session point the account at an email they control. It goes
  // through /change-email/request and /change-email/verify instead. (Sending
  // the address you already have is harmless and simply ignored.)
  if (email && email !== user.email) {
    throw ApiError.badRequest('To change your email, confirm the new address from Account & Security.');
  }

  if (firstName !== undefined) user.firstName = firstName;
  if (lastName !== undefined) user.lastName = lastName;
  if (phone !== undefined) user.phone = phone;

  await user.save();

  new ApiResponse(200, {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    role: user.role,
  }, 'Profile updated successfully').send(res);
}

// POST /api/auth/change-password
// Requires the CURRENT password, verified the same way login() verifies
// it — this stops someone who only has a still-open session (e.g. a
// shared computer left logged in) from changing the password without
// actually knowing it.
// POST /api/auth/change-password/request
// First step: verifies the CURRENT password exactly as before, but
// instead of applying the change immediately, hashes the new one and
// holds it in pendingPasswordHash until the OTP is confirmed — the real
// passwordHash is untouched until then.
async function requestPasswordChange(req, res) {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select(`+passwordHash ${LOCK_SELECT}`);
  if (user.isLocked()) throw ApiError.forbidden(LOCKED_MESSAGE);

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    await recordFailedPassword(user);
    throw ApiError.badRequest('Current password is incorrect');
  }

  // Throws if a code was sent too recently (60 seconds) or too often (5/hour).
  const pendingPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const otpCode = await issueOtp(User, user._id, 'password_change', { pendingPasswordHash });

  try {
    await sendOtpEmail(user.email, otpCode, 'your password change');
  } catch (err) {
    console.error('Failed to send password-change OTP email:', err.message);
    await releaseCooldown(User, user._id);
    throw ApiError.internal('Could not send the email right now. Please try again shortly.');
  }

  new ApiResponse(200, null, 'A verification code has been sent to your email').send(res);
}

// POST /api/auth/change-password/verify
// Second step: confirms the code, then applies the already-hashed
// pendingPasswordHash to the real passwordHash — the plain new password
// was never stored anywhere, only ever its hash.
async function verifyPasswordChange(req, res) {
  const { code } = req.body;

  await checkAndConsumeOtp(User, req.user._id, 'password_change', code);

  const user = await User.findById(req.user._id).select('+pendingPasswordHash');
  if (!user.pendingPasswordHash) throw ApiError.badRequest('Invalid or expired code');

  user.passwordHash = user.pendingPasswordHash;
  user.pendingPasswordHash = undefined;
  await user.save();

  new ApiResponse(200, null, 'Password updated successfully').send(res);
}

// POST /api/auth/change-email/request
// Step one of changing the login email. Needs the current password (so a
// stranger at a left-open session can't redirect the account), then emails a
// code to the NEW address. The address on the account does not change yet.
async function requestEmailChange(req, res) {
  const { newEmail, password } = req.body;
  await assertCanEditOwnProfile(req.user._id);

  const user = await User.findById(req.user._id).select(`+passwordHash ${LOCK_SELECT}`);
  if (user.isLocked()) throw ApiError.forbidden(LOCKED_MESSAGE);

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    await recordFailedPassword(user);
    throw ApiError.badRequest('Password is incorrect');
  }

  if (newEmail === user.email) throw ApiError.badRequest('That is already your email address');

  const taken = await User.findOne({ email: newEmail }).select('_id');
  if (taken) throw ApiError.conflict('An account with this email already exists');

  const otpCode = await issueOtp(User, user._id, 'email_change', { pendingEmail: newEmail });

  try {
    await sendOtpEmail(newEmail, otpCode, 'your new email address');
  } catch (err) {
    console.error('Failed to send email-change OTP email:', err.message);
    await releaseCooldown(User, user._id);
    throw ApiError.internal('Could not send the email right now. Please try again shortly.');
  }

  new ApiResponse(200, null, 'A verification code has been sent to your new email address').send(res);
}

// POST /api/auth/change-email/verify
// Step two: the code that was emailed to the NEW address proves it is
// reachable by this person. Only now does the account's email change.
async function verifyEmailChange(req, res) {
  const { code } = req.body;
  await assertCanEditOwnProfile(req.user._id);

  await checkAndConsumeOtp(User, req.user._id, 'email_change', code);

  const user = await User.findById(req.user._id).select('+pendingEmail');
  if (!user.pendingEmail) throw ApiError.badRequest('Invalid or expired code');

  // Re-checked now: someone else may have registered this address in the
  // minutes since the code was sent.
  const taken = await User.findOne({ email: user.pendingEmail, _id: { $ne: user._id } }).select('_id');
  if (taken) throw ApiError.conflict('An account with this email already exists');

  const oldEmail = user.email;
  user.email = user.pendingEmail;
  user.pendingEmail = undefined;
  await user.save();

  // Tell the OLD address. If this change was not made by the owner, this is
  // how they find out — and the link in it can put things right.
  const undoToken = crypto.randomBytes(32).toString('hex');
  await User.updateOne(
    { _id: user._id },
    { $set: { emailUndoTokenHash: hashToken(undoToken), emailUndoExpiresAt: new Date(Date.now() + UNDO_WINDOW_MS), previousEmail: oldEmail } }
  );
  try {
    await sendEmailChangedNotice(oldEmail, user.email, `${process.env.FRONTEND_URL}/secure-account?token=${undoToken}`);
  } catch (err) {
    // The change itself already happened and was verified; a failed notice
    // must not turn it into an error.
    console.error('Failed to send email-changed notice:', err.message);
  }

  new ApiResponse(200, { id: user._id, email: user.email }, 'Email updated successfully').send(res);
}

// POST /api/auth/email-change/undo  (public — the person may not be able to log in)
// The "No, secure my account" button from the notice sent to the old address.
// The link carries a secret that only that inbox received; it works once.
//   - the old email is put back,
//   - every signed-in device is signed out,
//   - the current password is made unusable (whoever changed the email had
//     it), so the owner sets a new one through "Forgot password" — which
//     needs a code sent to the restored address.
async function undoEmailChange(req, res) {
  const { token } = req.body;
  const tokenHash = hashToken(token);
  const expired = ApiError.badRequest('This link has expired or was already used.');

  const user = await User.findOne({ emailUndoTokenHash: tokenHash }).select('+emailUndoTokenHash +emailUndoExpiresAt +previousEmail');
  if (!user || !user.emailUndoExpiresAt || user.emailUndoExpiresAt < new Date() || !user.previousEmail) throw expired;

  const taken = await User.findOne({ email: user.previousEmail, _id: { $ne: user._id } }).select('_id');
  if (taken) {
    throw ApiError.conflict('The original email address is now used by another account. Please contact an administrator.');
  }

  // Use the link up in one step, so opening it twice at once works once.
  const used = await User.findOneAndUpdate(
    { _id: user._id, emailUndoTokenHash: tokenHash },
    { $unset: { emailUndoTokenHash: 1, emailUndoExpiresAt: 1 } }
  );
  if (!used) throw expired;

  const restored = user.previousEmail;
  const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), SALT_ROUNDS);

  // One explicit update, so every part of it is certain to be written: the
  // address goes back, the password becomes unusable, every session ends, and
  // any code or ticket still waiting (email change, password change, reset) dies.
  await User.updateOne(
    { _id: user._id },
    {
      $set: { email: restored, passwordHash: unusablePassword, failedLoginAttempts: 0, lockLevel: 0 },
      $unset: {
        previousEmail: 1,
        refreshTokenHash: 1,
        lockUntil: 1,
        lockedAt: 1,
        lockRequestMessage: 1,
        lockRequestedAt: 1,
        pendingEmail: 1,
        pendingPasswordHash: 1,
        otpHash: 1,
        otpExpiresAt: 1,
        otpPurpose: 1,
        otpAttempts: 1,
        otpLastSentAt: 1, // so the owner can ask for a reset code straight away
        passwordResetTokenHash: 1,
        passwordResetExpiresAt: 1,
      },
    }
  );

  new ApiResponse(200, { email: restored }, 'Your account has been secured').send(res);
}

// POST /api/auth/forgot-password  (public)
// Step 1: emails a 6-digit code to the address — if an account uses it. The
// reply is the same either way, so this page can't be used to find out who
// has an account. Too-soon / too-many requests are answered the same way too
// (the earlier code is still good), and the usual limits apply: one code per
// 60 seconds, five per hour.
async function forgotPassword(req, res) {
  const { email } = req.body;

  const user = await User.findOne({ email }).select('_id isActive isEmailVerified');
  // A sign-up that was never verified has no password worth resetting —
  // signing up again restarts it.
  if (user && user.isActive && user.isEmailVerified !== false) {
    try {
      const code = await issueOtp(User, user._id, 'password_reset');
      try {
        await sendOtpEmail(email, code, 'your password reset');
      } catch (err) {
        console.error('Failed to send password-reset email:', err.message);
        await releaseCooldown(User, user._id);
      }
    } catch (err) {
      if (err.statusCode !== 429) throw err;
    }
  }

  new ApiResponse(200, null, 'If an account exists for that email, a verification code has been sent.').send(res);
}

// POST /api/auth/forgot-password/verify  (public)
// Step 2: the code from the email (5 wrong guesses and it is destroyed). A
// correct code is exchanged for a one-time "reset ticket" that is valid for
// 10 minutes and is what step 3 needs.
async function verifyForgotPassword(req, res) {
  const { email, code } = req.body;

  const user = await User.findOne({ email }).select('_id isActive isEmailVerified');
  if (!user || !user.isActive || user.isEmailVerified === false) {
    throw ApiError.badRequest('Invalid or expired code');
  }

  await checkAndConsumeOtp(User, user._id, 'password_reset', code);

  const resetToken = crypto.randomBytes(32).toString('hex');
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordResetTokenHash: hashToken(resetToken), passwordResetExpiresAt: new Date(Date.now() + RESET_TICKET_MS) } }
  );

  new ApiResponse(200, { resetToken }, 'Code verified').send(res);
}

// POST /api/auth/reset-password  (public)
// Step 3: sets the new password. Needs the reset ticket from step 2 (so the
// code alone is not enough, and it works once). Signs out every device and
// clears any login lockout — the person just proved they own the inbox.
async function resetPassword(req, res) {
  const { email, resetToken, newPassword } = req.body;
  const expired = ApiError.badRequest('This reset session has expired. Please start again.');

  const user = await User.findOne({ email }).select('+passwordHash +passwordResetTokenHash +passwordResetExpiresAt');
  if (!user || !user.isActive || !user.passwordResetTokenHash || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
    throw expired;
  }

  const sent = Buffer.from(hashToken(resetToken), 'hex');
  const stored = Buffer.from(user.passwordResetTokenHash, 'hex');
  if (sent.length !== stored.length || !crypto.timingSafeEqual(sent, stored)) throw expired;

  if (await user.comparePassword(newPassword)) {
    throw ApiError.badRequest('Your new password must be different from your current one.');
  }

  const used = await User.findOneAndUpdate(
    { _id: user._id, passwordResetTokenHash: user.passwordResetTokenHash },
    { $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 } }
  );
  if (!used) throw expired;

  // One explicit update: new password in, every session ended, lockout cleared.
  await User.updateOne(
    { _id: user._id },
    {
      $set: { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS), failedLoginAttempts: 0, lockLevel: 0 },
      $unset: { refreshTokenHash: 1, lockUntil: 1, lockedAt: 1, lockRequestMessage: 1, lockRequestedAt: 1, pendingPasswordHash: 1 },
    }
  );

  new ApiResponse(200, null, 'Password updated successfully').send(res);
}

module.exports = {
  register,
  login,
  refresh,
  recordActivity,
  lockStatus,
  contactAdminAboutLock,
  logout,
  getMe,
  updateProfile,
  requestPasswordChange,
  verifyPasswordChange,
  requestEmailChange,
  verifyEmailChange,
  undoEmailChange,
  forgotPassword,
  verifyForgotPassword,
  resetPassword,
  verifySignupOtp,
  resendSignupOtp,
};