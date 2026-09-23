const Farm = require('../models/Farm');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { assertOwnerOrAdmin } = require('../utils/ownership');

/**
 * Ownership check
 * ----------------
 * Unlike Crop (shared master data, gated by ROLE), a Farm belongs to one
 * specific user. Access here is gated by OWNERSHIP: you can only touch a
 * farm if you own it — UNLESS you're an admin, who can manage any farm
 * (e.g. for support/moderation purposes).
 */
function assertCanAccessFarm(farm, user) {
  assertOwnerOrAdmin(farm.owner, user);
}

// POST /api/farms
async function createFarm(req, res) {
  const { name, location, totalAreaHectares } = req.body;

  // owner is ALWAYS the logged-in user — never trust a client-supplied
  // owner id, or anyone could create farms "owned by" someone else.
  const farm = await Farm.create({ owner: req.user._id, name, location, totalAreaHectares });

  new ApiResponse(201, farm, 'Farm created successfully').send(res);
}

// GET /api/farms  (regular users see only their own; admins see everyone's)
async function getFarms(req, res) {
  const page = req.query.page || 1;
  const limit = req.query.limit || 20;

  const filter = { isActive: true };
  if (req.user.role !== 'admin') {
    filter.owner = req.user._id;
  }

  const [farms, total] = await Promise.all([
    Farm.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Farm.countDocuments(filter),
  ]);

  new ApiResponse(200, farms, 'Farms retrieved successfully', {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }).send(res);
}

// GET /api/farms/:id
async function getFarmById(req, res) {
  const farm = await Farm.findById(req.params.id);
  if (!farm) throw ApiError.notFound('Farm not found');

  assertCanAccessFarm(farm, req.user);

  new ApiResponse(200, farm).send(res);
}

// PATCH /api/farms/:id
async function updateFarm(req, res) {
  const farm = await Farm.findById(req.params.id);
  if (!farm) throw ApiError.notFound('Farm not found');

  assertCanAccessFarm(farm, req.user);

  const allowedFields = ['name', 'location', 'totalAreaHectares', 'isActive'];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) farm[field] = req.body[field];
  }

  await farm.save();

  new ApiResponse(200, farm, 'Farm updated successfully').send(res);
}

// DELETE /api/farms/:id  (soft delete)
async function deleteFarm(req, res) {
  const farm = await Farm.findById(req.params.id);
  if (!farm) throw ApiError.notFound('Farm not found');

  assertCanAccessFarm(farm, req.user);

  farm.isActive = false;
  await farm.save();

  new ApiResponse(200, farm, 'Farm deactivated successfully').send(res);
}

module.exports = { createFarm, getFarms, getFarmById, updateFarm, deleteFarm };