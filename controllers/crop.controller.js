const Crop = require('../models/Crop');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');

/**
 * Escapes regex special characters so user search input can never be
 * interpreted as a regex pattern (prevents ReDoS and unexpected matches).
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// POST /api/crops
async function createCrop(req, res) {
  const { name, variety, category, typicalGrowingDays } = req.body;

  const crop = await Crop.create({ name, variety, category, typicalGrowingDays });

  new ApiResponse(201, crop, 'Crop created successfully').send(res);
}

// GET /api/crops?page=1&limit=20&search=rice&category=grain
async function getCrops(req, res) {
  const page = req.query.page || 1;
  const limit = req.query.limit || 20;
  const { search, category } = req.query;

  const filter = { isActive: true };
  if (category) filter.category = category;
  if (search) {
    filter.name = { $regex: escapeRegex(search), $options: 'i' };
  }

  const [crops, total] = await Promise.all([
    Crop.find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(), // .lean() = plain JS objects, faster for read-only responses
    Crop.countDocuments(filter),
  ]);

  new ApiResponse(200, crops, 'Crops retrieved successfully', {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }).send(res);
}

// GET /api/crops/:id
async function getCropById(req, res) {
  const crop = await Crop.findById(req.params.id).lean();
  if (!crop) throw ApiError.notFound('Crop not found');

  new ApiResponse(200, crop).send(res);
}

// PATCH /api/crops/:id
async function updateCrop(req, res) {
  const allowedFields = ['name', 'variety', 'category', 'typicalGrowingDays', 'isActive'];
  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  const crop = await Crop.findByIdAndUpdate(req.params.id, updates, {
    new: true, // return the updated document, not the old one
    runValidators: true, // re-run schema validation on update
  });

  if (!crop) throw ApiError.notFound('Crop not found');

  new ApiResponse(200, crop, 'Crop updated successfully').send(res);
}

// DELETE /api/crops/:id  (soft delete — deactivates, never destroys data)
async function deleteCrop(req, res) {
  const crop = await Crop.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  );

  if (!crop) throw ApiError.notFound('Crop not found');

  new ApiResponse(200, crop, 'Crop deactivated successfully').send(res);
}

module.exports = { createCrop, getCrops, getCropById, updateCrop, deleteCrop };