const LoginEvent = require('../models/LoginEvent');

// "Chrome on Windows", "Safari on iPhone", ... from the User-Agent header.
// Only the two words people care about; the raw header is never stored.
function describeDevice(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iPhone/iPad'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Linux|X11/.test(ua)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown device';
}

// Behind a host like Vercel the real client address is in x-forwarded-for
// (first entry); locally it is the socket address.
function clientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  const raw = first || (req.socket && req.socket.remoteAddress) || req.ip || '';
  return String(raw).replace(/^::ffff:/, '').slice(0, 64) || undefined;
}

// Only keep what was typed if it looks like an email: people sometimes type
// their password into the email box, and that must never be stored.
function emailForLog(value) {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  return v.length <= 120 && /^[^\s@]+@[^\s@]+$/.test(v) ? v : undefined;
}

// Writes one row. NEVER throws: a logging hiccup must not break a login.
async function recordLoginEvent(req, { user, email, success, reason } = {}) {
  try {
    await LoginEvent.create({
      user: user || undefined,
      email: emailForLog(email),
      success: Boolean(success),
      reason: success ? undefined : reason,
      ip: clientIp(req),
      device: describeDevice(req.headers && req.headers['user-agent']),
    });
  } catch (err) {
    console.error('Failed to write login event:', err.message);
  }
}

module.exports = { recordLoginEvent, describeDevice, clientIp, emailForLog };