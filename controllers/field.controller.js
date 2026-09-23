const Field = require('../models/Field');
const Farm = require('../models/Farm');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { assertOwnerOrAdmin } = require('../utils/ownership');

/**
 * A Field has no owner of its own — access is inherited from its parent
 * Farm. This helper fetches the farm and checks access in one step, so
 * every Field endpoint enforces the SAME rule a Farm endpoint would.
 */
async function getFarmAndAssertAccess(farmId, user) {
  const farm = await Farm.findById(farmId);
  if (!farm) throw ApiError.notFound('Farm not found');
  assertOwnerOrAdmin(farm.owner, user);
  return farm;
}

// POST /api/fields
async function createField(req, res) {
  const { farm: farmId, name, areaHectares, soilType } = req.body;

  await getFarmAndAssertAccess(farmId, req.user); // throws if not allowed

  const field = await Field.create({ farm: farmId, name, areaHectares, soilType });

  new ApiResponse(201, field, 'Field created successfully').send(res);
}

// GET /api/fields?farm=<farmId>   (farm filter is required for regular users)
async function getFields(req, res) {
  const page = req.query.page || 1;
  const limit = req.query.limit || 20;
  const { farm: farmId } = req.query;

  const filter = { isActive: true };

  if (farmId) {
    // Scoped to one farm — verify access to that specific farm
    await getFarmAndAssertAccess(farmId, req.user);
    filter.farm = farmId;
  } else if (req.user.role !== 'admin') {
    // No farm specified: regular users only ever see fields from farms
    // they own. Admins with no filter see everything.
    const ownedFarmIds = await Farm.find({ owner: req.user._id }).distinct('_id');
    filter.farm = { $in: ownedFarmIds };
  }

  const [fields, total] = await Promise.all([
    Field.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Field.countDocuments(filter),
  ]);

  new ApiResponse(200, fields, 'Fields retrieved successfully', {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }).send(res);
}

// GET /api/fields/:id
async function getFieldById(req, res) {
  const field = await Field.findById(req.params.id);
  if (!field) throw ApiError.notFound('Field not found');

  await getFarmAndAssertAccess(field.farm, req.user);

  new ApiResponse(200, field).send(res);
}

// PATCH /api/fields/:id
async function updateField(req, res) {
  const field = await Field.findById(req.params.id);
  if (!field) throw ApiError.notFound('Field not found');

  await getFarmAndAssertAccess(field.farm, req.user);

  const allowedFields = ['name', 'areaHectares', 'soilType', 'isActive'];
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) field[key] = req.body[key];
  }

  await field.save();

  new ApiResponse(200, field, 'Field updated successfully').send(res);
}

// DELETE /api/fields/:id  (soft delete)
async function deleteField(req, res) {
  const field = await Field.findById(req.params.id);
  if (!field) throw ApiError.notFound('Field not found');

  await getFarmAndAssertAccess(field.farm, req.user);

  field.isActive = false;
  await field.save();

  new ApiResponse(200, field, 'Field deactivated successfully').send(res);
}

module.exports = { createField, getFields, getFieldById, updateField, deleteField };