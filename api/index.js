const app = require('../server');
const connectDB = require('../config/db');

// Cache the connection promise so warm invocations reuse it
// instead of reconnecting on every request.
let dbPromise;

module.exports = async (req, res) => {
  try {
    dbPromise = dbPromise || connectDB();
    await dbPromise;
  } catch (err) {
    dbPromise = null; // allow a retry on the next request
    console.error('[db] connection failed', err);
    return res.status(500).json({ success: false, message: 'Database connection failed' });
  }
  return app(req, res);
};