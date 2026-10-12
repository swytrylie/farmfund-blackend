const { getState } = require('../utils/maintenanceState');

// While maintenance is on, only these parts of the API keep working:
//   /auth/*   - so an admin can still sign in (and everyone can sign out)
//   /admin/*  - the admin pages (each route still checks the admin role itself)
//   /system/* - the public "is it down?" check the app makes on start
//   /cron/*   - the scheduled backup
// Everything else answers 503, which the app turns into the maintenance screen.
const ALWAYS_OPEN = ['/auth', '/admin', '/system', '/cron'];

const isOpen = (path) => ALWAYS_OPEN.some((p) => path === p || path.startsWith(p + '/'));

async function maintenanceGuard(req, res, next) {
  let state;
  try {
    state = await getState();
  } catch (err) {
    // If the check itself breaks, stay open: a bug here must never lock everyone out.
    console.error('Maintenance check failed:', err.message);
    return next();
  }
  if (!state.active || isOpen(req.path)) return next();

  if (state.until) res.set('Retry-After', String(Math.max(1, Math.ceil((state.until - new Date()) / 1000))));
  return res.status(503).json({
    success: false,
    code: 'MAINTENANCE',
    message: 'FarmFund is down for maintenance. Please try again later.',
    maintenance: { until: state.until ? state.until.toISOString() : null },
  });
}

module.exports = { maintenanceGuard, isOpen };