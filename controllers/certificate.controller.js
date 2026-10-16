const Certificate = require('../models/Certificate');
const User = require('../models/User');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { recordAudit } = require('../utils/audit');
const storage = require('../utils/cloudinary');
const { sniff } = require('../utils/fileSniff');
const { accessFor } = require('../utils/certificateAccess');
const { creditFor } = require('../utils/creditLimit');

const TYPE_SHORT = { barangay_certificate: 'Barangay Certificate', income_certificate: 'Income Certificate' };
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TYPE_TITLES = {
  barangay_certificate: 'Barangay Certificate of Agricultural Activity',
  income_certificate: 'Proof of Monthly Income',
};

const MAX_PER_FARMER = 20;

const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ') || 'Unknown';

function toRow(c) {
  return {
    id: String(c._id),
    type: c.type || 'other',
    title: c.title,
    issuer: c.issuer || null,
    issuedOn: c.issuedOn || null,
    status: c.status,
    reviewNote: c.reviewNote || null,
    reviewedByName: c.reviewedByName || null,
    reviewedByRole: c.reviewedByRole || null,
    reviewedAt: c.reviewedAt || null,
    fileName: c.file && c.file.originalName ? c.file.originalName : null,
    fileType: c.file ? c.file.format : null,
    bytes: c.file ? c.file.bytes : null,
    createdAt: c.createdAt,
  };
}

// GET /api/certificates — the signed-in farmer's own certificates
async function listMine(req, res) {
  const rows = await Certificate.find({ farmer: req.user._id }).sort({ createdAt: -1, _id: -1 }).lean();
  new ApiResponse(200, { certificates: rows.map(toRow), max: MAX_PER_FARMER }, 'Certificates fetched').send(res);
}

// Tells every active admin's bell that a farmer sent a certificate to verify.
// A failure here never undoes the upload.
async function notifyAdmins(doc, farmer) {
  try {
    const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
    if (!admins.length) return;
    const name = fullName(farmer);
    const label = TYPE_SHORT[doc.type] || doc.title;
    const message = (TYPE_SHORT[doc.type] ? `${name} submitted ${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label} for verification.` : `${name} submitted "${label}" for verification.`).slice(0, 200);
    await Notification.create(
      admins.map((a) => ({
        user: a._id,
        kind: 'certificate_submitted',
        title: 'Certificate to verify',
        message,
        details: { farmerName: name.slice(0, 200), typeLabel: String(label).slice(0, 100) },
        certificate: doc._id,
      }))
    );
  } catch (err) {
    console.error('Could not notify admins about a certificate:', err && err.message);
  }
}

// GET /api/certificates/queue?status=&type=&search=&page=&limit= — admin only.
// Every farmer's certificates in one list, so the admin can verify them
// without opening each account. Pending ones come oldest first (first in, first checked).
async function queue(req, res) {
  if (req.user.role !== 'admin') throw ApiError.forbidden('Only the FarmFund admin can review certificates');
  const status = req.query.status || 'pending';
  const type = req.query.type || 'all';
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const filter = {};
  if (status !== 'all') filter.status = status;
  if (type !== 'all') filter.type = type;

  const terms = search.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (terms.length) {
    const and = terms.map((t) => {
      const rx = new RegExp(escapeRegex(t), 'i');
      return { $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] };
    });
    const people = await User.find({ $and: and }).select('_id').lean();
    filter.farmer = { $in: people.map((p) => p._id) };
  }

  const order = status === 'pending' ? 1 : -1;
  const [total, pendingCount, rows] = await Promise.all([
    Certificate.countDocuments(filter),
    Certificate.countDocuments({ status: 'pending' }),
    Certificate.find(filter).sort({ createdAt: order, _id: order }).skip((page - 1) * limit).limit(limit).lean(),
  ]);

  const farmers = rows.length
    ? await User.find({ _id: { $in: rows.map((r) => r.farmer) } }).select('firstName lastName email').lean()
    : [];
  const byId = new Map(farmers.map((f) => [String(f._id), f]));

  const certificates = rows.map((c) => {
    const f = byId.get(String(c.farmer));
    return { ...toRow(c), farmer: { id: String(c.farmer), name: f ? fullName(f) : 'Deleted account', email: f ? f.email : null } };
  });

  new ApiResponse(200, { certificates, total, pendingCount, page, pages: Math.max(1, Math.ceil(total / limit)) }, 'Certificates fetched').send(res);
}

// GET /api/certificates/credit — the signed-in farmer's credit limit, how much is used, and what is left
async function credit(req, res) {
  new ApiResponse(200, { credit: await creditFor(req.user._id) }, 'Credit limit fetched').send(res);
}

// POST /api/certificates  (multipart: file, type?, title?, issuer?, issuedOn?)
async function create(req, res) {
  if (req.user.role === 'admin') throw ApiError.forbidden('Admin accounts do not have certificates');
  if (!storage.isConfigured()) throw new ApiError(503, 'File storage is not set up yet. Please try again later.');
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) throw ApiError.badRequest('Choose a file to upload');

  const kind = sniff(req.file.buffer);
  if (!kind) throw ApiError.badRequest('Only PDF, JPG or PNG files can be uploaded');

  const type = req.body.type || 'other';

  const count = await Certificate.countDocuments({ farmer: req.user._id });
  if (count >= MAX_PER_FARMER) {
    throw ApiError.conflict(`You can keep up to ${MAX_PER_FARMER} certificates. Delete one before adding another.`);
  }

  let stored;
  try {
    stored = await storage.uploadBuffer(req.file.buffer);
  } catch (err) {
    console.error('Certificate upload to Cloudinary failed:', err && err.message);
    throw new ApiError(502, 'The file could not be stored. Please try again.');
  }

  const rawName = typeof req.file.originalname === 'string' ? req.file.originalname : '';
  let doc;
  try {
    doc = await Certificate.create({
      farmer: req.user._id,
      type,
      title: TYPE_TITLES[type] || req.body.title,
      issuer: req.body.issuer || undefined,
      issuedOn: req.body.issuedOn ? new Date(req.body.issuedOn) : undefined,
      file: {
        publicId: stored.publicId,
        format: kind.ext, // what the file really is
        bytes: req.file.buffer.length,
        originalName: rawName.replace(/[<>\r\n]/g, '').slice(0, 200) || undefined,
      },
    });
  } catch (err) {
    await storage.destroy(stored.publicId); // do not leave a file nobody points to
    throw err;
  }

  await notifyAdmins(doc, req.user);

  new ApiResponse(201, { certificate: toRow(doc) }, 'Certificate uploaded').send(res);
}

// DELETE /api/certificates/:id — a farmer removes their own
async function remove(req, res) {
  const doc = await Certificate.findOneAndDelete({ _id: req.params.id, farmer: req.user._id });
  if (!doc) throw ApiError.notFound('Certificate not found');
  await storage.destroy(doc.file.publicId);
  // Nothing left to verify: take its alert out of the admins' bells.
  await Notification.deleteMany({ certificate: doc._id }).catch(() => {});
  new ApiResponse(200, null, 'Certificate deleted').send(res);
}

// GET /api/certificates/farmer/:farmerId — the admin (can review) and a cooperative's staff (view only)
async function listForFarmer(req, res) {
  const access = await accessFor(req.user, req.params.farmerId);
  if (!access) throw ApiError.forbidden('You do not have permission to view these certificates');
  const rows = await Certificate.find({ farmer: req.params.farmerId }).sort({ createdAt: -1, _id: -1 }).lean();
  const credit = await creditFor(req.params.farmerId);
  new ApiResponse(200, { certificates: rows.map(toRow), canReview: access === 'admin', credit }, 'Certificates fetched').send(res);
}

// GET /api/certificates/:id/link — a link that opens the file for 5 minutes
async function link(req, res) {
  const doc = await Certificate.findById(req.params.id).lean();
  // Same answer for "does not exist" and "not yours", so ids cannot be probed.
  if (!doc || !(await accessFor(req.user, doc.farmer))) throw ApiError.notFound('Certificate not found');
  if (!storage.isConfigured()) throw new ApiError(503, 'File storage is not set up yet. Please try again later.');

  let url;
  try {
    url = storage.signedLink(doc.file.publicId, doc.file.format);
  } catch (err) {
    console.error('Could not build certificate link:', err && err.message);
    throw new ApiError(502, 'The file could not be opened. Please try again.');
  }
  new ApiResponse(200, { url, expiresInSeconds: storage.LINK_SECONDS, fileType: doc.file.format }, 'Link ready').send(res);
}

// PATCH /api/certificates/:id/review  { status: 'verified'|'rejected', note }
async function review(req, res) {
  const existing = await Certificate.findById(req.params.id).lean();
  const access = existing ? await accessFor(req.user, existing.farmer) : null;
  if (!existing || !access) throw ApiError.notFound('Certificate not found');
  if (access === 'self') throw ApiError.forbidden('You cannot review your own certificate');
  // Cooperatives can see a borrower's certificates, but only the admin decides.
  if (access !== 'admin') throw ApiError.forbidden('Only the FarmFund admin can verify or reject certificates');

  const status = req.body.status;
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  const set = {
    status,
    reviewedBy: req.user._id,
    reviewedByName: fullName(req.user),
    reviewedByRole: 'admin',
    reviewedAt: new Date(),
  };
  const update = note ? { $set: { ...set, reviewNote: note } } : { $set: set, $unset: { reviewNote: '' } };
  const doc = await Certificate.findByIdAndUpdate(existing._id, update, { new: true }).lean();
  if (!doc) throw ApiError.notFound('Certificate not found');

  // It has been checked, so the "to verify" alert is done with, for every admin.
  await Notification.updateMany({ certificate: doc._id, readAt: { $exists: false } }, { $set: { readAt: new Date() } }).catch(() => {});

  const farmer = await User.findById(doc.farmer).select('firstName lastName').lean();
  await recordAudit(req.user, status === 'verified' ? 'certificate.verify' : 'certificate.reject', {
    targetType: 'certificate',
    targetId: doc._id,
    targetLabel: `${fullName(farmer)} — ${doc.title}`,
    details: { title: doc.title, type: doc.type || 'other', note: note || undefined },
  });

  const credit = await creditFor(doc.farmer);
  new ApiResponse(200, { certificate: toRow(doc), credit }, status === 'verified' ? 'Certificate verified' : 'Certificate rejected').send(res);
}

module.exports = { queue, credit, listMine, create, remove, listForFarmer, link, review, MAX_PER_FARMER };