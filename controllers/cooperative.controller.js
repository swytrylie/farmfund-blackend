const Cooperative = require('../models/Cooperative');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { assertCooperativeStaffOrAdmin } = require('../utils/cooperativeMembership');
const CooperativeMember = require('../models/CooperativeMember');

// GET /api/cooperatives
// Defaults to 'active' — any farmer needs to see this list to pick a
// cooperative when requesting a loan. Querying any OTHER status (pending,
// rejected) is restricted to admins: that's moderation-queue information,
// not something regular farmers need visibility into, even though it's
// nothing more sensitive than a name and a status.
async function getCooperatives(req, res) {
  const { status = 'active' } = req.query;

  if (status !== 'active' && req.user.role !== 'admin') {
    throw ApiError.forbidden('You do not have permission to view this');
  }

  const cooperatives = await Cooperative.find({ status }).select('name status createdAt').sort({ name: 1 }).lean();

  new ApiResponse(200, cooperatives, 'Cooperatives retrieved successfully').send(res);
}

// GET /api/cooperatives/:id
// Full details (registrationNumber, address, contact info) — unlike the
// list above, which deliberately only exposes name/status/createdAt.
// Open to any ACTIVE member of that specific cooperative (any role), same
// broader "viewing" rule used for loans — not everyone needs to be
// owner/finance_manager just to see their own organization's details.
async function getCooperativeById(req, res) {
  const cooperative = await Cooperative.findById(req.params.id);
  if (!cooperative) throw ApiError.notFound('Cooperative not found');

  if (req.user.role !== 'admin') {
    const membership = await CooperativeMember.findOne({
      cooperative: cooperative._id,
      user: req.user._id,
      status: 'active',
    });
    if (!membership) throw ApiError.forbidden('You do not have access to this resource');
  }

  new ApiResponse(200, cooperative).send(res);
}

// PATCH /api/cooperatives/:id
// Editing the cooperative's own details (name, registration number,
// address, contact info) is restricted to THAT cooperative's owner or
// finance_manager — the same bar as approving a loan, since this is
// organization-level information, not something any plain member should
// be able to change. status is deliberately NOT editable here — that
// stays admin-only via updateCooperativeStatus below, unchanged.
async function updateCooperative(req, res) {
  const cooperative = await Cooperative.findById(req.params.id);
  if (!cooperative) throw ApiError.notFound('Cooperative not found');

  await assertCooperativeStaffOrAdmin(cooperative._id, req.user);

  const allowedFields = ['name', 'registrationNumber', 'address', 'contactEmail', 'contactPhone'];
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) cooperative[key] = req.body[key];
  }

  await cooperative.save();

  new ApiResponse(200, cooperative, 'Cooperative profile updated successfully').send(res);
}

// PATCH /api/cooperatives/:id/status  — ADMIN ONLY (route-level authorize)
// This is the ONLY way a cooperative moves out of "pending" — there is no
// self-approval, and no cooperative owner can change their own status.
// Same shape as updateLoanStatus: a real approval action, not a formality.
async function updateCooperativeStatus(req, res) {
  const cooperative = await Cooperative.findById(req.params.id);
  if (!cooperative) throw ApiError.notFound('Cooperative not found');

  cooperative.status = req.body.status;
  await cooperative.save();

  new ApiResponse(200, cooperative, 'Cooperative status updated successfully').send(res);
}

module.exports = { getCooperatives, getCooperativeById, updateCooperative, updateCooperativeStatus };