const ApiResponse = require('../utils/ApiResponse');
const { getState } = require('../utils/maintenanceState');

// GET /api/system/status — PUBLIC. The app asks this when it opens, to decide
// whether to show the "Down for maintenance" screen. Says nothing else.
async function getPublicStatus(req, res) {
  const state = await getState();
  new ApiResponse(200, {
    maintenance: { active: state.active, until: state.until ? state.until.toISOString() : null },
  }, 'System status').send(res);
}

module.exports = { getPublicStatus };