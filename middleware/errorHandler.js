const ApiError = require('../utils/ApiError');

/**
 * errorHandler
 * ------------
 * Single place where every error in the app ends up. This is what makes
 * error responses SAFE:
 * - Never leaks stack traces or internal details in production
 * - Translates known Mongoose/Mongo errors into clean 4xx responses
 * - Anything unrecognized becomes a generic 500 (no internal details exposed)
 *
 * Must be registered LAST in server.js, after all routes.
 */
function errorHandler(err, req, res, next) {
  let error = err;

  // Mongoose bad ObjectId (e.g. /crops/not-a-valid-id)
  if (err.name === 'CastError') {
    error = ApiError.badRequest(`Invalid ${err.path}: ${err.value}`);
  }

  // Mongoose validation error (schema rules failed)
  else if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    error = ApiError.badRequest('Validation failed', details);
  }

  // MongoDB duplicate key error (unique index violation)
  else if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    error = ApiError.conflict(`Duplicate value for '${field}': already exists`);
  }

  // Anything else that isn't one of our deliberate ApiErrors is unexpected —
  // log it fully server-side, but never leak it to the client.
  if (!error.isOperational) {
    console.error('[unexpected error]', err);
    error = ApiError.internal('Something went wrong on our end');
  }

  const statusCode = error.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    statusCode,
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

module.exports = errorHandler;