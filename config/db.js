const mongoose = require('mongoose');
const dns = require('node:dns/promises');

// Workaround for a known Node.js (v22+) bug on Windows where DNS SRV
// lookups (used by mongodb+srv:// connection strings) fail with
// "querySrv ECONNREFUSED". Only needed locally, so we skip it on Vercel.
if (!process.env.VERCEL) {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
}

/**
 * Connects to MongoDB Atlas using the MONGODB_URI env var.
 * Safe to call more than once: it reuses an existing connection.
 */
let listenerAttached = false;

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is not set in environment variables');
  }

  // 1 = connected, 2 = connecting. Reuse instead of reconnecting.
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    console.log('[db] Connected to MongoDB Atlas');
  } catch (err) {
    console.error('[db] Connection error:', err.message);
    // Throw instead of process.exit(1) so a failed connection returns
    // an error response on Vercel instead of killing the function.
    // Locally, the unhandled rejection handler in server.js still exits.
    throw err;
  }

  if (!listenerAttached) {
    mongoose.connection.on('disconnected', () => {
      console.warn('[db] MongoDB disconnected');
    });
    listenerAttached = true;
  }

  return mongoose.connection;
}

module.exports = connectDB;