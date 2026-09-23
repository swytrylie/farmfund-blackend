const mongoose = require('mongoose');
const dns = require('node:dns/promises');

// Workaround for a known Node.js (v22+) bug on Windows where DNS SRV
// lookups (used by mongodb+srv:// connection strings) fail with
// "querySrv ECONNREFUSED" because Node doesn't reliably use the Windows
// system DNS resolver. Forcing public DNS resolvers fixes it.
dns.setServers(['1.1.1.1', '8.8.8.8']);

/**
 * Connects to MongoDB Atlas using the MONGODB_URI env var.
 * Example URI format:
 * mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<dbName>?retryWrites=true&w=majority
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is not set in environment variables');
  }

  try {
    await mongoose.connect(uri);
    console.log('[db] Connected to MongoDB Atlas');
  } catch (err) {
    console.error('[db] Connection error:', err.message);
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('[db] MongoDB disconnected');
  });

  return mongoose.connection;
}

module.exports = connectDB;