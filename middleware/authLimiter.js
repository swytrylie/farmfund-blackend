const rateLimit = require('express-rate-limit');

/**
 * Auth routes get a much tighter limit than the general API (see
 * server.js's globalLimiter) because login/register are the prime
 * target for brute-force and credential-stuffing attacks.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many auth attempts, please try again later',
  },
});

module.exports = authLimiter;