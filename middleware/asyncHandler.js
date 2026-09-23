/**
 * asyncHandler
 * ------------
 * Without this, an error thrown inside an `async` controller function
 * would become an unhandled promise rejection instead of reaching
 * Express's error handler. Wrap every async controller with this.
 *
 * Usage: router.get('/', asyncHandler(getCrops));
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;