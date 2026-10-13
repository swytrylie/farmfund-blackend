const AuditLog = require('../models/AuditLog');
const ApiResponse = require('../utils/ApiResponse');

// What each recorded action is called on the page. Anything not listed here
// (an action added later) is shown as-is rather than hidden.
const ACTION_TEXT = {
  'user.suspend': 'Suspended account',
  'user.reactivate': 'Restored account',
  'user.update': 'Updated account details',
  'user.password_reset_request': 'Sent password reset email',
  'user.delete': 'Deleted account',
  'cooperative.approve': 'Approved cooperative',
  'cooperative.reject': 'Declined cooperative',
  'financial.access_granted': 'Opened a farmer\'s financial records',
  'financial.view_records': 'Viewed a farmer\'s financial records',
  'announcement.send': 'Sent announcement',
  'backup.create': 'Ran a backup',
  'backup.download': 'Downloaded a backup',
  'backup.restore': 'Restored a backup',
  'backup.restore_failed': 'A restore failed',
  'system.maintenance_on': 'Turned maintenance mode on',
  'system.maintenance_off': 'Turned maintenance mode off',
  'system.maintenance_window': 'Changed the maintenance window',
  'certificate.verify': 'Verified a certificate',
  'certificate.reject': 'Rejected a certificate',
};

function manilaRange(startIso, endIso) {
  const fmt = (v) =>
    new Date(v).toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${fmt(startIso)} to ${fmt(endIso)}`;
}

function bytesText(n) {
  if (typeof n !== 'number' || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const FIELD_TEXT = { firstName: 'first name', lastName: 'last name', email: 'email' };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const categoryOf = (action) =>
  typeof action === 'string' && action.startsWith('cooperative.') ? 'cooperatives' : 'accounts';

// One short sentence of extra context for a row, or null.
function detailText(action, details) {
  const d = details && typeof details === 'object' ? details : {};
  const parts = [];

  if (action === 'user.suspend' && d.reason) parts.push(`Reason: ${d.reason}`);

  if (action === 'user.update' && d.before && d.after) {
    const changes = Object.keys(d.after)
      .filter((k) => FIELD_TEXT[k])
      .map((k) => `${FIELD_TEXT[k]}: ${d.before[k] === undefined ? '—' : d.before[k]} → ${d.after[k]}`);
    if (changes.length) parts.push(`Changed ${changes.join('; ')}`);
  }

  if (action === 'financial.access_granted') {
    if (d.reason) parts.push(`Reason: ${d.reason}`);
    if (d.caseRef) parts.push(`Case: ${d.caseRef}`);
  }
  if (action === 'financial.view_records' && d.caseRef) parts.push(`Case: ${d.caseRef}`);

  if (action === 'announcement.send') {
    const who = { all: 'All Users', farm_owners: 'Farm Owners', cooperatives: 'Cooperatives' }[d.audience] || d.audience;
    if (who) parts.push(`To: ${who}`);
    if (typeof d.sent === 'number' && typeof d.recipients === 'number') parts.push(`Delivered to ${d.sent} of ${d.recipients}`);
  }

  if (action === 'backup.create') {
    if (typeof d.totalRecords === 'number') parts.push(`${d.totalRecords} records`);
    if (typeof d.sizeBytes === 'number') parts.push(bytesText(d.sizeBytes));
  }
  if (action === 'backup.restore') {
    if (typeof d.totalRecords === 'number') parts.push(`${d.totalRecords} records restored`);
    parts.push('A safety backup of the earlier data was saved first');
  }
  if (action === 'backup.restore_failed') {
    parts.push(d.rolledBack ? 'Data was put back as it was before' : 'The automatic undo also failed — a safety backup is available');
  }

  if (action === 'certificate.reject' && d.note) parts.push(`Reason: ${d.note}`);
  if (action === 'certificate.verify' && d.note) parts.push(`Note: ${d.note}`);

  if (action === 'system.maintenance_on') parts.push('Farmers and cooperatives are blocked until it is turned off');
  if (action === 'system.maintenance_window') {
    if (d.removed) parts.push('The scheduled window was removed');
    else if (d.start && d.end) parts.push(`Window: ${manilaRange(d.start, d.end)} (Philippine time)`);
  }

  if (action === 'cooperative.approve' || action === 'cooperative.reject') {
    if (d.ownerEmailSent === false) parts.push("Email to the owner couldn't be sent");
  } else if (d.emailSent === false) {
    parts.push("Email to the person couldn't be sent");
  }

  return parts.length ? parts.join('. ') : null;
}

function toRow(log) {
  return {
    id: String(log._id),
    actor: log.actorName || 'Unknown admin',
    action: log.action,
    actionText: ACTION_TEXT[log.action] || log.action,
    target: log.targetLabel || '—',
    targetType: log.targetType || null,
    category: categoryOf(log.action),
    detail: detailText(log.action, log.details),
    at: log.createdAt,
  };
}

// GET /api/admin/audit-logs?search=&category=all|accounts|cooperatives&page=&limit=
// Newest first. Search looks at who did it, what it was done to, and the
// action name as the page shows it ("suspend" finds "Suspended account").
async function listAuditLogs(req, res) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const search = (req.query.search || '').trim();
  const category = req.query.category || 'all';

  const and = [];
  if (category === 'accounts') and.push({ action: { $not: /^cooperative\./ } });
  if (category === 'cooperatives') and.push({ action: /^cooperative\./ });

  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    const needle = search.toLowerCase();
    const actions = Object.keys(ACTION_TEXT).filter((k) => ACTION_TEXT[k].toLowerCase().includes(needle));
    const or = [{ actorName: rx }, { targetLabel: rx }, { action: rx }];
    if (actions.length) or.push({ action: { $in: actions } });
    and.push({ $or: or });
  }

  const filter = and.length ? { $and: and } : {};

  const total = await AuditLog.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / limit));
  const logs = await AuditLog.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  new ApiResponse(200, { logs: logs.map(toRow), total, page, pages }, 'Audit logs fetched').send(res);
}

module.exports = { listAuditLogs, ACTION_TEXT, detailText };