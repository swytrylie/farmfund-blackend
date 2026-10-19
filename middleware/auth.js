const { verifyAccessToken } = require('../utils/jwt');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');
const { isIdle, idleError } = require('../utils/idle');

/**
 * protect
 * -------
 * Verifies the access token from the Authorization header
 * ("Bearer <token>"). If valid, attaches the real user document to
 * req.user so downstream controllers know who's making the request.
 */
async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw ApiError.unauthorized('No access token provided');
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyAccessToken(token); // throws if invalid/expired

    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) {
      throw ApiError.unauthorized('User no longer exists or is deactivated');
    }

    // Nothing done for 10 minutes: the session is over. Deliberately NOT
    // refreshed here — only the activity ping extends it (see utils/idle.js).
    if (isIdle(user)) throw idleError();

    req.user = user; // available to every controller after this point
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(ApiError.unauthorized('Access token expired'));
    }
    if (err.name === 'JsonWebTokenError') {
      return next(ApiError.unauthorized('Invalid access token'));
    }
    next(err);
  }
}

/**
 * authorize(...roles)
 * --------------------
 * Use AFTER `protect`. Restricts a route to specific platform roles.
 * Example: router.delete('/:id', protect, authorize('admin'), deleteCrop)
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Not authenticated'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    next();
  };
}

module.exports = { protect, authorize };