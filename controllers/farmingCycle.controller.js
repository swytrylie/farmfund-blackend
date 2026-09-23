const FarmingCycle = require('../models/FarmingCycle');
const Field = require('../models/Field');
const Farm = require('../models/Farm');
const Crop = require('../models/Crop');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { assertOwnerOrAdmin } = require('../utils/ownership');

/**
 * FarmingCycle has no owner of its own — access flows through Field,
 * which itself has no owner — flows through Farm, which does. This
 * walks that whole chain in one call.
 */
async function getFieldAndAssertAccess(fieldId, user) {
  const field = await Field.findById(fieldId);
  if (!field) throw ApiError.notFound('Field not found');

  const farm = await Farm.findById(field.farm);
  if (!farm) throw ApiError.notFound('Parent farm not found'); // shouldn't happen, but fail safely

  assertOwnerOrAdmin(farm.owner, user);
  return field;
}

// POST /api/farming-cycles
async function createFarmingCycle(req, res) {
  const { field: fieldId, crop: cropId, startDate, endDate, status, expectedYieldKg, notes } = req.body;

  await getFieldAndAssertAccess(fieldId, req.user);

  // Crop is shared master data — just confirm it exists, no ownership involved
  const crop = await Crop.findOne({ _id: cropId, isActive: true });
  if (!crop) throw ApiError.badRequest('Crop not found or is inactive');

  const cycle = await FarmingCycle.create({
    field: fieldId,
    crop: cropId,
    startDate,
    endDate,
    status,
    expectedYieldKg,
    notes,
  });

  new ApiResponse(201, cycle, 'Farming cycle created successfully').send(res);
}

// GET /api/farming-cycles?field=<fieldId>
async function getFarmingCycles(req, res) {
  const page = req.query.page || 1;
  const limit = req.query.limit || 20;
  const { field: fieldId, status } = req.query;

  const filter = {};
  if (status) filter.status = status;

  if (fieldId) {
    await getFieldAndAssertAccess(fieldId, req.user);
    filter.field = fieldId;
  } else if (req.user.role !== 'admin') {
    // No field specified: scope to every field under every farm this user owns
    const ownedFarmIds = await Farm.find({ owner: req.user._id }).distinct('_id');
    const ownedFieldIds = await Field.find({ farm: { $in: ownedFarmIds } }).distinct('_id');
    filter.field = { $in: ownedFieldIds };
  }

  const [cycles, total] = await Promise.all([
    FarmingCycle.find(filter)
      .populate('crop', 'name category') // include basic crop info, not just the id
      .sort({ startDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    FarmingCycle.countDocuments(filter),
  ]);

  new ApiResponse(200, cycles, 'Farming cycles retrieved successfully', {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }).send(res);
}

// GET /api/farming-cycles/:id
async function getFarmingCycleById(req, res) {
  const cycle = await FarmingCycle.findById(req.params.id).populate('crop', 'name category');
  if (!cycle) throw ApiError.notFound('Farming cycle not found');

  await getFieldAndAssertAccess(cycle.field, req.user);

  new ApiResponse(200, cycle).send(res);
}

// PATCH /api/farming-cycles/:id
// Deliberately does NOT allow changing `field` or `crop` after creation —
// a cycle's identity (which field, which crop) shouldn't be rewritten;
// only its progress (status, dates, yield, notes) is meant to be updated.
async function updateFarmingCycle(req, res) {
  const cycle = await FarmingCycle.findById(req.params.id);
  if (!cycle) throw ApiError.notFound('Farming cycle not found');

  await getFieldAndAssertAccess(cycle.field, req.user);

  const allowedFields = ['endDate', 'status', 'expectedYieldKg', 'actualYieldKg', 'notes'];
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) cycle[key] = req.body[key];
  }

  await cycle.save();

  new ApiResponse(200, cycle, 'Farming cycle updated successfully').send(res);
}

module.exports = { createFarmingCycle, getFarmingCycles, getFarmingCycleById, updateFarmingCycle };