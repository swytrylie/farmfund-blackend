const bcrypt = require('bcryptjs');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require('../utils/jwt');

const SALT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const REFRESH_COOKIE_NAME = 'refreshToken';
const refreshCookieOptions = {
  httpOnly: true, // JavaScript can never read this cookie — blocks XSS token theft
  secure: process.env.NODE_ENV === 'production', // HTTPS only in production
  sameSite: 'strict', // blocks the cookie being sent from other sites (CSRF protection)
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days, matches JWT_REFRESH_EXPIRES default
  path: '/api/auth', // only sent to auth endpoints, not the whole API
};

// POST /api/auth/register
async function register(req, res) {
  const { firstName, lastName, email, password, phone } = req.body;

  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await User.create({ firstName, lastName, email, passwordHash, phone });

  new ApiResponse(201, {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
  }, 'Account created successfully').send(res);
}

// POST /api/auth/login
async function login(req, res) {
  const { email, password } = req.body;

  // Explicitly select passwordHash + lockout fields since the schema hides them by default
  const user = await User.findOne({ email }).select(
    '+passwordHash +failedLoginAttempts +lockUntil'
  );

  // Same generic error whether the email doesn't exist or the password is
  // wrong — never reveal which one, or attackers can enumerate real emails.
  const invalidCredentialsError = ApiError.unauthorized('Invalid email or password');

  if (!user || !user.isActive) throw invalidCredentialsError;

  if (user.isLocked()) {
    throw ApiError.forbidden('Account temporarily locked due to too many failed attempts. Try again later.');
  }

  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    throw invalidCredentialsError;
  }

  // Successful login: reset lockout counters, issue fresh tokens
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  user.refreshTokenHash = hashToken(refreshToken);
  await user.save();

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);

  new ApiResponse(200, {
    accessToken,
    user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role },
  }, 'Login successful').send(res);
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

  // Rotation: every refresh issues a brand new refresh token and
  // invalidates the old one, limiting how long a leaked token is useful.
  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);
  user.refreshTokenHash = hashToken(newRefreshToken);
  await user.save();

  res.cookie(REFRESH_COOKIE_NAME, newRefreshToken, refreshCookieOptions);

  new ApiResponse(200, { accessToken: newAccessToken }, 'Token refreshed').send(res);
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
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
  new ApiResponse(200, null, 'Logged out successfully').send(res);
}

// GET /api/auth/me  (requires `protect` middleware)
async function getMe(req, res) {
  new ApiResponse(200, {
    id: req.user._id,
    firstName: req.user.firstName,
    lastName: req.user.lastName,
    email: req.user.email,
    role: req.user.role,
  }).send(res);
}

module.exports = { register, login, refresh, logout, getMe };