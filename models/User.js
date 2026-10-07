const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * User
 * ----
 * Individual account. A user's link to a Cooperative is NOT stored here —
 * it goes through CooperativeMember (see table row: User → Cooperative Membership).
 *
 * `role` here is the PLATFORM-wide role (system access level), separate
 * from CooperativeMember.role (which is org-specific: owner/finance_manager/member).
 * A user can be a plain 'user' on the platform but 'owner' of their cooperative.
 *
 * isEmailVerified: deliberately has NO `default` value here. Every
 * account that existed before this field was added genuinely has no
 * value for it at all in the real database (Mongo doesn't retroactively
 * add fields to old documents just because the schema changed) — so it
 * reads as `undefined`, not `false`. login() treats that as "verified"
 * (grandfathered in), and ONLY blocks login when this is explicitly
 * `false` — which only ever happens for accounts created by the new
 * signup flow, which sets it to false on purpose and flips it to true
 * once the OTP is confirmed. Setting a `default: false` here would NOT
 * achieve the same effect — Mongoose defaults only apply to documents as
 * they're created, never to documents that already exist without the
 * field.
 */
const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 255,
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    phone: { type: String, trim: true, maxlength: 30 },
    address: { type: String, trim: true, maxlength: 255 },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },

    isEmailVerified: { type: Boolean },

    // One-time-code fields — shared by signup verification, password-change
    // verification and email-change verification, told apart by otpPurpose so
    // a code for one can never confirm another. All select: false: short-lived,
    // sensitive, and no normal query has a reason to return them.
    //
    // The code itself is NEVER stored — otpHash is a keyed hash (HMAC) of it,
    // so reading the database does not reveal anyone's code (see utils/otp.js).
    otpHash: { type: String, select: false },
    otpExpiresAt: { type: Date, select: false },
    otpPurpose: { type: String, enum: ['signup', 'password_change', 'email_change', 'password_reset'], select: false },
    // Wrong guesses made against the CURRENT code. At 5 the code is destroyed.
    otpAttempts: { type: Number, select: false },
    // When the last code was sent, and how many were sent in the current
    // hour — these drive the 60-second wait and the 5-per-hour cap.
    otpLastSentAt: { type: Date, select: false },
    otpSendWindowStart: { type: Date, select: false },
    otpSendCount: { type: Number, select: false },

    // Holds the NEW password's hash temporarily during a password change,
    // between requesting the OTP and confirming it — the real
    // passwordHash above is only overwritten once the code is verified.
    pendingPasswordHash: { type: String, select: false },

    // Same idea for an email change: the new address waits here, and
    // `email` above is only replaced once the code sent to the NEW address
    // is confirmed.
    pendingEmail: { type: String, lowercase: true, trim: true, maxlength: 255, select: false },

    // Forgot-password: after the emailed code is confirmed, the person gets a
    // one-time "reset ticket" good for 10 minutes. Only its hash is kept.
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },

    // After an email change, the OLD address is sent a "wasn't you?" link good
    // for 7 days. Only the hash of that link's token is kept, plus the address
    // to put back if it is used.
    emailUndoTokenHash: { type: String, select: false },
    emailUndoExpiresAt: { type: Date, select: false },
    previousEmail: { type: String, lowercase: true, trim: true, maxlength: 255, select: false },

    // Hash of the current valid refresh token (never store the raw token).
    // Comparing against this lets us detect reuse of an old/stolen token
    // and revoke access on logout, without keeping a separate sessions table.
    refreshTokenHash: { type: String, select: false },

    // Basic brute-force protection at the account level (in addition to
    // the IP-based rate limiter on the login route).
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

module.exports = mongoose.model('User', userSchema);