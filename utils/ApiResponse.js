/**
 * ApiResponse
 * -----------
 * Every successful response follows the same shape, so frontend code
 * can rely on it consistently: { success, message, data, meta }.
 */
class ApiResponse {
  constructor(statusCode, data = null, message = 'Success', meta = null) {
    this.success = statusCode < 400;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
    if (meta) this.meta = meta; // e.g. pagination info
  }

  send(res) {
    return res.status(this.statusCode).json(this);
  }
}

module.exports = ApiResponse;