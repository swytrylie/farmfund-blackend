const FinancialRecord = require('../models/FinancialRecord');
const FinancialCategory = require('../models/FinancialCategory');
const FarmingCycle = require('../models/FarmingCycle');
const Field = require('../models/Field');
const Farm = require('../models/Farm');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { assertOwnerOrAdmin } = require('../utils/ownership');

/**
 * A FinancialRecord has no owner of its own — access is inherited from its
 * parent Farm, exactly the same pattern field.controller.js uses for Field.
 * Duplicated here rather than imported from field.controller.js, since that
 * file is already working and isn't being touched.
 */
async function getFarmAndAssertAccess(farmId, user) {
  const farm = await Farm.findById(farmId);
  if (!farm) throw ApiError.notFound('Farm not found');
  assertOwnerOrAdmin(farm.owner, user);
  return farm;
}

// Confirms a farmingCycle genuinely belongs to the SAME farm as the
// financial record being created/updated — not just that the cycle id is
// valid and exists somewhere. Without this check, someone could link a
// transaction to a crop cycle that belongs to an entirely different farm.
async function assertFarmingCycleBelongsToFarm(farmingCycleId, farmId) {
  const cycle = await FarmingCycle.findById(farmingCycleId);
  if (!cycle) throw ApiError.badRequest('Farming cycle not found');

  const field = await Field.findById(cycle.field);
  if (!field || String(field.farm) !== String(farmId)) {
    throw ApiError.badRequest('That farming cycle does not belong to this farm');
  }
}

// POST /api/financial-records
async function createFinancialRecord(req, res) {
  const { farm: farmId, category, type, amount, date, description, paymentMethod, farmingCycle } = req.body;

  await getFarmAndAssertAccess(farmId, req.user); // throws if not allowed

  const categoryDoc = await FinancialCategory.findById(category);
  if (!categoryDoc || !categoryDoc.isActive) {
    throw ApiError.badRequest('Invalid or inactive category');
  }
  if (categoryDoc.type !== type) {
    throw ApiError.badRequest(
      `Category "${categoryDoc.name}" is an ${categoryDoc.type} category and cannot be used for an ${type} record`
    );
  }

  if (farmingCycle) {
    await assertFarmingCycleBelongsToFarm(farmingCycle, farmId);
  }

  const record = await FinancialRecord.create({
    farm: farmId,
    category,
    type,
    amount,
    date,
    description,
    paymentMethod,
    farmingCycle,
  });

  // Populated here before responding — without this, the response sent
  // back right after creating would only have the raw category id, not
  // its name, showing as "Uncategorized" on the frontend until the page
  // was refreshed and the (already-populated) list endpoint ran instead.
  await record.populate('category', 'name type');

  new ApiResponse(201, record, 'Financial record created successfully').send(res);
}

// GET /api/financial-records?farm=<farmId>&type=&category=&startDate=&endDate=
// (farm filter is required for regular users, same as Field's list endpoint)
async function getFinancialRecords(req, res) {
  const page = req.query.page || 1;
  const limit = req.query.limit || 20;
  const { farm: farmId, type, category, startDate, endDate, farmingCycle } = req.query;

  const filter = {};
  // Filtering by farmingCycle is how real crop profitability gets computed
  // elsewhere — "every transaction linked to THIS specific cycle" — so this
  // needs its own ownership check, since a farmingCycle id alone doesn't
  // tell us which farm it belongs to the way a farm id does.
  if (farmingCycle) {
    const cycle = await FarmingCycle.findById(farmingCycle);
    if (!cycle) throw ApiError.notFound('Farming cycle not found');
    const field = await Field.findById(cycle.field);
    if (!field) throw ApiError.notFound('Field not found');
    await getFarmAndAssertAccess(field.farm, req.user);
    filter.farmingCycle = farmingCycle;
  }

  if (farmId) {
    // Scoped to one farm — verify access to that specific farm
    await getFarmAndAssertAccess(farmId, req.user);
    filter.farm = farmId;
  } else if (req.user.role !== 'admin') {
    // No farm specified: regular users only ever see records from farms
    // they own. Admins with no filter see everything.
    const ownedFarmIds = await Farm.find({ owner: req.user._id }).distinct('_id');
    filter.farm = { $in: ownedFarmIds };
  }

  if (type) filter.type = type;
  if (category) filter.category = category;
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate) filter.date.$lte = new Date(endDate);
  }

  const [records, total] = await Promise.all([
    FinancialRecord.find(filter)
      .populate('category', 'name type')
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    FinancialRecord.countDocuments(filter),
  ]);

  new ApiResponse(200, records, 'Financial records retrieved successfully', {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }).send(res);
}

// GET /api/financial-records/:id
async function getFinancialRecordById(req, res) {
  const record = await FinancialRecord.findById(req.params.id).populate('category', 'name type');
  if (!record) throw ApiError.notFound('Financial record not found');

  await getFarmAndAssertAccess(record.farm, req.user);

  new ApiResponse(200, record).send(res);
}

// PATCH /api/financial-records/:id
async function updateFinancialRecord(req, res) {
  const record = await FinancialRecord.findById(req.params.id);
  if (!record) throw ApiError.notFound('Financial record not found');

  await getFarmAndAssertAccess(record.farm, req.user);

  const allowedFields = ['category', 'type', 'amount', 'date', 'description', 'paymentMethod', 'receiptMetadata', 'farmingCycle'];
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) record[key] = req.body[key];
  }

  // Re-validated the same way as on create — a farmingCycle id alone isn't
  // enough, it has to genuinely belong to THIS record's own farm.
  if (req.body.farmingCycle) {
    await assertFarmingCycleBelongsToFarm(req.body.farmingCycle, record.farm);
  }

  // If either category or type changed, re-validate they still match —
  // same rule enforced on create, so a record can't drift into an
  // inconsistent (income record filed under an expense category) state.
  if (req.body.category !== undefined || req.body.type !== undefined) {
    const categoryDoc = await FinancialCategory.findById(record.category);
    if (!categoryDoc || !categoryDoc.isActive) {
      throw ApiError.badRequest('Invalid or inactive category');
    }
    if (categoryDoc.type !== record.type) {
      throw ApiError.badRequest(
        `Category "${categoryDoc.name}" is an ${categoryDoc.type} category and cannot be used for an ${record.type} record`
      );
    }
  }

  await record.save();

  // Same reasoning as createFinancialRecord — populated here so an edited
  // record's response always has the real category name immediately,
  // not just its raw id.
  await record.populate('category', 'name type');

  new ApiResponse(200, record, 'Financial record updated successfully').send(res);
}

// DELETE /api/financial-records/:id
// Hard delete, unlike Field's soft delete — a financial record has no
// isActive flag in its schema (it's a transaction log entry, not an
// ongoing resource), so there's nothing to flip instead of removing it.
async function deleteFinancialRecord(req, res) {
  const record = await FinancialRecord.findById(req.params.id);
  if (!record) throw ApiError.notFound('Financial record not found');

  await getFarmAndAssertAccess(record.farm, req.user);

  await record.deleteOne();

  new ApiResponse(200, null, 'Financial record deleted successfully').send(res);
}

module.exports = {
  createFinancialRecord,
  getFinancialRecords,
  getFinancialRecordById,
  updateFinancialRecord,
  deleteFinancialRecord,
};