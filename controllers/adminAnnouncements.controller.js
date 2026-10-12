const User = require('../models/User');
const Farm = require('../models/Farm');
const Cooperative = require('../models/Cooperative');
const CooperativeMember = require('../models/CooperativeMember');
const Announcement = require('../models/Announcement');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { sendEmail } = require('../utils/mailer');
const { recordAudit } = require('../utils/audit');

// Real people only: not admins, and not someone who never entered the email
// code. Suspended accounts are left out too: they can't use the app anyway.
const REAL_ACTIVE_USER = { role: { $ne: 'admin' }, isEmailVerified: { $ne: false }, isActive: { $ne: false } };
const LIVE_FARM = { isActive: { $ne: false } };

const AUDIENCE_LABEL = { all: 'All Users', farm_owners: 'Farm Owners', cooperatives: 'Cooperatives' };

// One announcement can reach at most this many people, and sending stops
// after SEND_BUDGET_MS. Mail goes out through one Gmail account (it has a
// daily limit) and the server must answer before it runs out of time.
const MAX_RECIPIENTS = 100;
const SEND_BUDGET_MS = 7000;
const BATCH_SIZE = 5;

const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ');
const ids = (list) => list.map((x) => String(x));

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The people in an audience: [{_id, firstName, email}], each person once.
async function audienceUsers(audience) {
  let filter = REAL_ACTIVE_USER;
  if (audience === 'farm_owners') {
    const owners = await Farm.distinct('owner', LIVE_FARM);
    filter = { ...REAL_ACTIVE_USER, _id: { $in: owners } };
  } else if (audience === 'cooperatives') {
    // Members of cooperatives an admin has approved (owners, finance managers, members).
    const coopIds = await Cooperative.distinct('_id', { status: 'active' });
    const memberIds = coopIds.length
      ? await CooperativeMember.distinct('user', { cooperative: { $in: coopIds }, status: 'active' })
      : [];
    filter = { ...REAL_ACTIVE_USER, _id: { $in: memberIds } };
  }
  const users = await User.find(filter).select('firstName email').lean();
  const seen = new Set();
  return users.filter((u) => {
    const email = typeof u.email === 'string' ? u.email.trim().toLowerCase() : '';
    if (!email || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

function toRow(a) {
  return {
    id: String(a._id),
    title: a.title,
    message: a.message,
    audience: a.audience,
    audienceLabel: AUDIENCE_LABEL[a.audience] || a.audience,
    recipients: a.recipients || 0,
    sent: a.sent || 0,
    failed: a.failed || 0,
    status: a.status,
    sentBy: a.sentByName || 'Unknown admin',
    at: a.createdAt,
  };
}

// GET /api/admin/announcements?page=&limit=
// Newest first. Also says how many people each audience has right now, so the
// "New Announcement" form can show who it will reach.
async function listAnnouncements(req, res) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;

  const [total, rows, everyone, owners, coopMembers] = await Promise.all([
    Announcement.countDocuments({}),
    Announcement.find({}).select('-recipientIds -readBy').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    audienceUsers('all'),
    audienceUsers('farm_owners'),
    audienceUsers('cooperatives'),
  ]);

  new ApiResponse(200, {
    announcements: rows.map(toRow),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    audienceCounts: { all: everyone.length, farm_owners: owners.length, cooperatives: coopMembers.length },
  }, 'Announcements fetched').send(res);
}

function announcementHtml(firstName, title, message) {
  const hello = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hello,';
  return `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
        <h2 style="color: #2d4027;">${escapeHtml(title)}</h2>
        <p>${hello}</p>
        <p>${escapeHtml(message).replace(/\r?\n/g, '<br>')}</p>
        <p style="color: #666; font-size: 13px;">This is an announcement from the FarmFund team.</p>
      </div>
    `;
}

// POST /api/admin/announcements   { title, message, audience }
// Emails every person in the audience, records how it went, and writes it to
// the Audit Logs. Everything finishes BEFORE the answer is sent (the server
// may stop right after replying).
async function sendAnnouncement(req, res) {
  const { title, message, audience } = req.body;

  const people = await audienceUsers(audience);
  if (people.length === 0) throw ApiError.badRequest('No one is in that audience yet, so nothing was sent.');
  if (people.length > MAX_RECIPIENTS) {
    throw ApiError.badRequest(
      `That audience has ${people.length} people. One announcement can reach at most ${MAX_RECIPIENTS}; choose a smaller audience.`
    );
  }

  const doc = await Announcement.create({
    title,
    message,
    audience,
    sentBy: req.user._id,
    sentByName: fullName(req.user) || 'Admin',
    recipients: people.length,
    recipientIds: people.map((p) => p._id),
    status: 'sending',
  });

  const subject = `FarmFund: ${title}`.replace(/[\r\n]+/g, ' ');
  const startedAt = Date.now();
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < people.length; i += BATCH_SIZE) {
    if (Date.now() - startedAt > SEND_BUDGET_MS) {
      failed += people.length - i; // out of time: the rest were not sent
      break;
    }
    const batch = people.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((p) => sendEmail(p.email, subject, announcementHtml(p.firstName, title, message)))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') sent += 1;
      else failed += 1;
    }
  }

  const status = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial';
  const final = await Announcement.findByIdAndUpdate(doc._id, { $set: { sent, failed, status } }, { new: true })
    .select('-recipientIds -readBy')
    .lean();

  await recordAudit(req.user, 'announcement.send', {
    targetType: 'announcement',
    targetId: doc._id,
    targetLabel: title,
    details: { audience, recipients: people.length, sent, failed },
  });

  new ApiResponse(201, { announcement: toRow(final || { ...doc.toObject(), recipientIds: undefined, readBy: undefined, sent, failed, status }) }, 'Announcement sent').send(res);
}

module.exports = { listAnnouncements, sendAnnouncement, audienceUsers, AUDIENCE_LABEL, MAX_RECIPIENTS };