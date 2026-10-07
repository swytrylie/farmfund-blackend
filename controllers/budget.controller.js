const Budget = require('../models/Budget');
const Farm = require('../models/Farm');
const FinancialCategory = require('../models/FinancialCategory');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { assertOwnerOrAdmin } = require('../utils/ownership');

/**
 * A Budget has no owner of its own — access is inherited from its parent
 * Farm, the exact same pattern used for Field and FinancialRecord.
 * Duplicated here rather than imported from those files, since they're
 * already working and aren't being touched.
 */
async function getFarmAndAssertAccess(farmId, user) {
  const farm = await Farm.findById(farmId);
  if (!farm) throw ApiError.notFound('Farm not found');
  assertOwnerOrAdmin(farm.owner, user);
  return farm;
}

// Every category id in the embedded categories[] array must be a real,
// active FinancialCategory. Doesn't check category.type — a budget line
// item can reasonably be either, unlike a FinancialRecord which has its
// own single type.
async function validateCategoryIds(categories) {
  for (const item of categories || []) {
    const categoryDoc = await FinancialCategory.findById(item.category);
    if (!categoryDoc || !categoryDoc.isActive) {
      throw ApiError.badRequest(`Invalid or inactive category: ${item.category}`);
    }
  }
}

// POST /api/budgets
async function createBudget(req, res) {
  const { farm: farmId, name, periodStart, periodEnd, totalAmount, categories } = req.body;

  await getFarmAndAssertAccess(farmId, req.user);
  await validateCategoryIds(categories);

  const budget = await Budget.create({
    farm: farmId,
    name,
    periodStart,
    periodEnd,
    totalAmount,
    categories,
  });

  new ApiResponse(201, budget, 'Budget created successfully').send(res);
}

// GET /api/budgets?farm=<farmId>
async function getBudgets(req, res) {
  const page = req.query.page || 1;
  const limit = req.query.limit || 20;
  const { farm: farmId } = req.query;

  const filter = {};
  if (farmId) {
    await getFarmAndAssertAccess(farmId, req.user);
    filter.farm = farmId;
  } else if (req.user.role !== 'admin') {
    const ownedFarmIds = await Farm.find({ owner: req.user._id }).distinct('_id');
    filter.farm = { $in: ownedFarmIds };
  }

  const [budgets, total] = await Promise.all([
    Budget.find(filter)
      .populate('categories.category', 'name type')
      .sort({ periodStart: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Budget.countDocuments(filter),
  ]);

  new ApiResponse(200, budgets, 'Budgets retrieved successfully', {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }).send(res);
}

// GET /api/budgets/:id
async function getBudgetById(req, res) {
  const budget = await Budget.findById(req.params.id).populate('categories.category', 'name type');
  if (!budget) throw ApiError.notFound('Budget not found');

  await getFarmAndAssertAccess(budget.farm, req.user);

  new ApiResponse(200, budget).send(res);
}

// PATCH /api/budgets/:id
async function updateBudget(req, res) {
  const budget = await Budget.findById(req.params.id);
  if (!budget) throw ApiError.notFound('Budget not found');

  await getFarmAndAssertAccess(budget.farm, req.user);

  if (req.body.categories !== undefined) {
    await validateCategoryIds(req.body.categories);
  }

  const allowedFields = ['name', 'periodStart', 'periodEnd', 'totalAmount', 'categories'];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) budget[field] = req.body[field];
  }

  await budget.save();

  new ApiResponse(200, budget, 'Budget updated successfully').send(res);
}

// DELETE /api/budgets/:id  (hard delete — a budget plan has no isActive
// flag in its schema, same reasoning as FinancialRecord)
async function deleteBudget(req, res) {
  const budget = await Budget.findById(req.params.id);
  if (!budget) throw ApiError.notFound('Budget not found');

  await getFarmAndAssertAccess(budget.farm, req.user);

  await budget.deleteOne();

  new ApiResponse(200, null, 'Budget deleted successfully').send(res);
}

module.exports = { createBudget, getBudgets, getBudgetById, updateBudget, deleteBudget };