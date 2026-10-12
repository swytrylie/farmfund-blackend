const SystemSetting = require('../models/SystemSetting');
const ApiError = require('./ApiError');

// The longest scheduled window allowed: a typo ("2026" instead of "2025")
// must not lock every farmer out for a year.
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// How long one server remembers the setting before asking the database again.
// Every request passes through the maintenance check, so this keeps it cheap.
// A change made on another server instance shows up within this time.
const CACHE_MS = 5000;

let cache = null; // { at, setting }

// Works out what the stored setting means RIGHT NOW.
//   active  - maintenance is on (manual switch, or inside the scheduled window)
//   reason  - 'manual' | 'scheduled' | null
//   until   - when it ends, if known (only for a scheduled window with the manual switch off)
function evaluate(setting, now = new Date()) {
  const s = setting || {};
  const enabled = Boolean(s.maintenanceEnabled);
  const start = s.windowStart ? new Date(s.windowStart) : null;
  const end = s.windowEnd ? new Date(s.windowEnd) : null;
  const inWindow = Boolean(start && end && now >= start && now < end);
  return {
    enabled,
    inWindow,
    active: enabled || inWindow,
    reason: enabled ? 'manual' : inWindow ? 'scheduled' : null,
    until: !enabled && inWindow ? end : null,
    windowStart: start,
    windowEnd: end,
    updatedAt: s.updatedAt || null,
    updatedByName: s.updatedByName || null,
  };
}

async function loadSetting({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.setting;
  const setting = (await SystemSetting.findOne({ key: 'main' }).lean()) || {};
  cache = { at: Date.now(), setting };
  return setting;
}

async function getState({ fresh = false } = {}) {
  return evaluate(await loadSetting({ fresh }));
}

async function save(update, actor) {
  const $set = { ...update };
  if (actor) {
    $set.updatedBy = actor._id;
    $set.updatedByName = [actor.firstName, actor.lastName].filter(Boolean).join(' ') || 'Admin';
  }
  const saved = await SystemSetting.findOneAndUpdate(
    { key: 'main' },
    { $set, $setOnInsert: { key: 'main' } },
    { upsert: true, new: true }
  );
  cache = { at: Date.now(), setting: saved || {} };
  return evaluate(cache.setting);
}

async function setEnabled(enabled, actor) {
  return save({ maintenanceEnabled: Boolean(enabled) }, actor);
}

// start/end are Dates, or both null to remove the window.
async function setWindow(start, end, actor) {
  if (start === null && end === null) return save({ windowStart: null, windowEnd: null }, actor);
  const okDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
  if (!okDate(start) || !okDate(end)) throw ApiError.badRequest('Both a start and an end time are required.');
  if (end <= start) throw ApiError.badRequest('The end time must be after the start time.');
  if (end <= new Date()) throw ApiError.badRequest('The end time must be in the future.');
  if (end - start > MAX_WINDOW_MS) throw ApiError.badRequest('A maintenance window can be at most 7 days long.');
  return save({ windowStart: start, windowEnd: end }, actor);
}

function resetCache() {
  cache = null;
}

module.exports = { evaluate, getState, setEnabled, setWindow, resetCache, MAX_WINDOW_MS, CACHE_MS };