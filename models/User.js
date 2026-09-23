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