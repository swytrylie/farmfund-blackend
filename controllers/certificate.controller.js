const Certificate = require('../models/Certificate');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { recordAudit } = require('../utils/audit');
const storage = require('../utils/cloudinary');
const { sniff } = require('../utils/fileSniff');
const { accessFor } = require('../utils/certificateAccess');

const MAX_PER_FARMER = 20;

const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ') || 'Unknown';

function toRow(c) {
  return {
    id: String(c._id),
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

// POST /api/certificates  (multipart: file, title, issuer?, issuedOn?)
async function create(req, res) {
  if (req.user.role === 'admin') throw ApiError.forbidden('Admin accounts do not have certificates');
  if (!storage.isConfigured()) throw new ApiError(503, 'File storage is not set up yet. Please try again later.');
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) throw ApiError.badRequest('Choose a file to upload');

  const kind = sniff(req.file.buffer);
  if (!kind) throw ApiError.badRequest('Only PDF, JPG or PNG files can be uploaded');

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
      title: req.body.title,
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

  new ApiResponse(201, { certificate: toRow(doc) }, 'Certificate uploaded').send(res);
}

// DELETE /api/certificates/:id — a farmer removes their own
async function remove(req, res) {
  const doc = await Certificate.findOneAndDelete({ _id: req.params.id, farmer: req.user._id });
  if (!doc) throw ApiError.notFound('Certificate not found');
  await storage.destroy(doc.file.publicId);
  new ApiResponse(200, null, 'Certificate deleted').send(res);
}

// GET /api/certificates/farmer/:farmerId — for the admin and a cooperative's staff
async function listForFarmer(req, res) {
  const access = await accessFor(req.user, req.params.farmerId);
  if (!access) throw ApiError.forbidden('You do not have permission to view these certificates');
  const rows = await Certificate.find({ farmer: req.params.farmerId }).sort({ createdAt: -1, _id: -1 }).lean();
  new ApiResponse(200, { certificates: rows.map(toRow), canReview: access !== 'self' }, 'Certificates fetched').send(res);
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

  const status = req.body.status;
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  const set = {
    status,
    reviewedBy: req.user._id,
    reviewedByName: fullName(req.user),
    reviewedByRole: access === 'admin' ? 'admin' : 'cooperative',
    reviewedAt: new Date(),
  };
  const update = note ? { $set: { ...set, reviewNote: note } } : { $set: set, $unset: { reviewNote: '' } };
  const doc = await Certificate.findByIdAndUpdate(existing._id, update, { new: true }).lean();
  if (!doc) throw ApiError.notFound('Certificate not found');

  if (access === 'admin') {
    const farmer = await User.findById(doc.farmer).select('firstName lastName').lean();
    await recordAudit(req.user, status === 'verified' ? 'certificate.verify' : 'certificate.reject', {
      targetType: 'certificate',
      targetId: doc._id,
      targetLabel: `${fullName(farmer)} — ${doc.title}`,
      details: { title: doc.title, note: note || undefined },
    });
  }

  new ApiResponse(200, { certificate: toRow(doc) }, status === 'verified' ? 'Certificate verified' : 'Certificate rejected').send(res);
}

module.exports = { listMine, create, remove, listForFarmer, link, review, MAX_PER_FARMER };