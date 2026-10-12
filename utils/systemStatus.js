const mongoose = require('mongoose');
const pkg = require('../package.json');

// A database answer slower than this is reported as "Slow".
const SLOW_MS = 1000;

// Build time of the running version, written by scripts/writeBuildInfo.js when
// Vercel builds the project. Missing (e.g. on your own computer) -> unknown.
let buildInfo = {};
try {
  buildInfo = require('../buildInfo.json') || {};
} catch {
  buildInfo = {};
}

// Asks the database a few real questions. Each extra detail is optional: some
// database plans do not allow every command, and that must not hide the rest.
async function probeDatabase(conn = mongoose.connection) {
  const out = { status: 'Unreachable', pingMs: null, dataBytes: null, storageBytes: null, collections: null, connections: null };
  try {
    const db = conn.db;
    if (!db) return out;
    const startedAt = Date.now();
    await db.admin().ping();
    out.pingMs = Date.now() - startedAt;
    out.status = out.pingMs >= SLOW_MS ? 'Slow' : 'Healthy';
  } catch {
    return out;
  }
  try {
    const s = await conn.db.stats();
    out.dataBytes = typeof s.dataSize === 'number' ? s.dataSize : null;
    out.storageBytes = typeof s.storageSize === 'number' ? s.storageSize : null;
    out.collections = typeof s.collections === 'number' ? s.collections : null;
  } catch {
    // not available on this plan
  }
  try {
    const s = await conn.db.admin().serverStatus();
    if (s && s.connections && typeof s.connections.current === 'number') {
      const available = typeof s.connections.available === 'number' ? s.connections.available : null;
      out.connections = { current: s.connections.current, max: available === null ? null : s.connections.current + available };
    }
  } catch {
    // not available on this plan
  }
  return out;
}

function memoryUsageMb() {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}

// What is running: version, commit, where, since when.
function systemInfo(env = process.env) {
  const firstLine = (env.VERCEL_GIT_COMMIT_MESSAGE || '').split('\n')[0].trim();
  return {
    version: pkg.version || null,
    commit: env.VERCEL_GIT_COMMIT_SHA ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
    commitMessage: firstLine || null,
    environment: env.VERCEL_ENV || env.NODE_ENV || 'development',
    region: env.VERCEL_REGION || null,
    deployedAt: buildInfo.builtAt || null,
    node: process.version,
  };
}

module.exports = { probeDatabase, memoryUsageMb, systemInfo, SLOW_MS };