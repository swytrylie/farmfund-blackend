const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

/**
 * handleValidationErrors
 * -----------------------
 * Runs after express-validator's chain of checks (body(), param(), etc).
 * If any of them failed, this collects them into one clean 400 response
 * instead of letting bad data reach the controller/model at all.
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map((e) => ({
      field: e.path,
      message: e.msg,
    }));
    return next(ApiError.badRequest('Validation failed', details));
  }
  next();
}

module.exports = handleValidationErrors;