const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');

/**
 * Two-token strategy:
 * - Access token: short-lived (15 min), sent in the Authorization header,
 *   holds the user id + role. This is what protects every API request.
 * - Refresh token: long-lived (7 days), sent ONLY as an httpOnly cookie
 *   (never accessible to JS, so an XSS bug can't steal it). Used only to
 *   get a new access token when the old one expires.
 *
 * We never store raw tokens in the database — only a SHA-256 hash of the
 * refresh token, so a database leak alone can't be used to forge sessions.
 */

function generateAccessToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
  });
}

function generateRefreshToken(user) {
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
};