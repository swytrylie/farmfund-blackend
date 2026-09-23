const rateLimit = require('express-rate-limit');

const isProd = process.env.NODE_ENV === 'production';

/**
 * Auth routes get tighter limits than the general API because login and
 * register are prime targets for brute-force and credential stuffing.
 * In development the limits are very high so testing doesn't lock you out.
 */
function makeLimiter({ max, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProd ? max : 1000,
    skipSuccessfulRequests, // when true, only failed requests (4xx/5xx) count
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });
}

// Guessing passwords: only failed logins count, so real users aren't punished.
const loginLimiter = makeLimiter({
  max: 10,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again later',
});

// Mass account creation: every attempt counts.
const registerLimiter = makeLimiter({
  max: 10,
  message: 'Too many sign-up attempts, please try again later',
});

// The frontend calls this on every page load, so it gets more room.
const refreshLimiter = makeLimiter({
  max: 60,
  message: 'Too many session checks, please try again later',
});

module.exports = { loginLimiter, registerLimiter, refreshLimiter };