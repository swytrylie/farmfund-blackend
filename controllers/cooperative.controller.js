const Cooperative = require('../models/Cooperative');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { assertCooperativeOwnerOrAdmin } = require('../utils/cooperativeOwner');
const CooperativeMember = require('../models/CooperativeMember');
const { sendCooperativeDecisionEmail } = require('../utils/mailer');
const { recordAudit } = require('../utils/audit');

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
// address, contact info) is restricted to THAT cooperative's OWNER (or a
// platform admin). Finance managers and members can view these details but
// not change them. status is deliberately NOT editable here — that stays
// admin-only via updateCooperativeStatus below, unchanged.
async function updateCooperative(req, res) {
  const cooperative = await Cooperative.findById(req.params.id);
  if (!cooperative) throw ApiError.notFound('Cooperative not found');

  await assertCooperativeOwnerOrAdmin(cooperative._id, req.user, 'Only the cooperative owner can edit the cooperative profile');

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

  const previousStatus = cooperative.status;
  cooperative.status = req.body.status;
  await cooperative.save();

  // Tell the owner the decision — only when an application actually moves to
  // approved or declined (not when the same status is sent twice). A failed
  // email never undoes the decision; the response says whether it went out.
  let emailSent = null;
  const decided = cooperative.status !== previousStatus && ['active', 'rejected'].includes(cooperative.status);
  if (decided) {
    emailSent = false;
    try {
      const ownerMembership = await CooperativeMember.findOne({
        cooperative: cooperative._id,
        role: 'owner',
        status: 'active',
      }).populate('user', 'firstName email');
      const owner = ownerMembership && ownerMembership.user;
      if (owner && owner.email) {
        await sendCooperativeDecisionEmail(owner.email, owner.firstName, cooperative.name, cooperative.status === 'active');
        emailSent = true;
      }
    } catch (err) {
      console.error('Failed to send cooperative decision email:', err.message);
    }
  }

  if (decided) {
    await recordAudit(req.user, cooperative.status === 'active' ? 'cooperative.approve' : 'cooperative.reject', {
      targetType: 'cooperative',
      targetId: cooperative._id,
      targetLabel: cooperative.name,
      details: { from: previousStatus, to: cooperative.status, ownerEmailSent: emailSent },
    });
  }

  new ApiResponse(200, { ...cooperative.toObject(), emailSent }, 'Cooperative status updated successfully').send(res);
}

module.exports = { getCooperatives, getCooperativeById, updateCooperative, updateCooperativeStatus };