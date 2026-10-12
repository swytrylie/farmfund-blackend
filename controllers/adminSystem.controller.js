const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { recordAudit } = require('../utils/audit');
const { getState, setEnabled, setWindow } = require('../utils/maintenanceState');
const { probeDatabase, memoryUsageMb, systemInfo } = require('../utils/systemStatus');

function maintenanceRow(state) {
  return {
    enabled: state.enabled,
    active: state.active,
    reason: state.reason,
    until: state.until ? state.until.toISOString() : null,
    windowStart: state.windowStart ? state.windowStart.toISOString() : null,
    windowEnd: state.windowEnd ? state.windowEnd.toISOString() : null,
    updatedAt: state.updatedAt,
    updatedBy: state.updatedByName,
  };
}

// GET /api/admin/system — live status of the server and database, the
// maintenance setting, and what version is running.
async function getSystem(req, res) {
  const [db, state] = await Promise.all([probeDatabase(), getState({ fresh: true })]);
  new ApiResponse(200, {
    // If this answer arrives at all, the server is up.
    server: { status: 'Operational', memoryMb: memoryUsageMb() },
    database: db,
    maintenance: maintenanceRow(state),
    info: systemInfo(),
    checkedAt: new Date().toISOString(),
  }, 'System status fetched').send(res);
}

// PATCH /api/admin/system/maintenance   { enabled: true|false }
async function setMaintenance(req, res) {
  const enabled = req.body.enabled === true;
  const before = await getState({ fresh: true });
  const state = before.enabled === enabled ? before : await setEnabled(enabled, req.user);

  if (before.enabled !== enabled) {
    await recordAudit(req.user, enabled ? 'system.maintenance_on' : 'system.maintenance_off', {
      targetType: 'system',
      targetLabel: 'Maintenance mode',
    });
  }
  new ApiResponse(200, { maintenance: maintenanceRow(state) }, enabled ? 'Maintenance mode turned on' : 'Maintenance mode turned off').send(res);
}

// PUT /api/admin/system/maintenance-window   { start, end }  (both ISO times, or both null to remove)
async function updateWindow(req, res) {
  const { start, end } = req.body;
  const removing = (start === null || start === undefined) && (end === null || end === undefined);
  const state = removing ? await setWindow(null, null, req.user) : await setWindow(new Date(start), new Date(end), req.user);

  await recordAudit(req.user, 'system.maintenance_window', {
    targetType: 'system',
    targetLabel: 'Maintenance window',
    details: removing ? { removed: true } : { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
  });
  new ApiResponse(200, { maintenance: maintenanceRow(state) }, removing ? 'Maintenance window removed' : 'Maintenance window saved').send(res);
}

module.exports = { getSystem, setMaintenance, updateWindow, maintenanceRow };