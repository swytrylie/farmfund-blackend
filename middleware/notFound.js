const ApiError = require('../utils/ApiError');

/**
 * notFound
 * --------
 * Catches any request that didn't match a defined route.
 * Must be registered after all routes, before errorHandler.
 */
function notFound(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

module.exports = notFound;