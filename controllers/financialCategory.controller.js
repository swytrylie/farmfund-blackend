const FinancialCategory = require('../models/FinancialCategory');
const ApiResponse = require('../utils/ApiResponse');

// GET /api/financial-categories?type=income|expense
// Shared reference data (e.g. "Seeds", "Fertilizer", "Sales Income") — not
// owned by any user, so any authenticated user can read the full list.
// Read-only on purpose: creating/editing categories isn't exposed here,
// since that's an admin/seed-data concern, not something regular users do.
async function getFinancialCategories(req, res) {
  const { type } = req.query;
  const filter = { isActive: true };
  if (type) filter.type = type;

  const categories = await FinancialCategory.find(filter).sort({ name: 1 }).lean();

  new ApiResponse(200, categories, 'Financial categories retrieved successfully').send(res);
}

module.exports = { getFinancialCategories };