const LoanReceipt = require('../models/LoanReceipt');
const ApiResponse = require('../utils/ApiResponse');
const { toReceiptRow } = require('../utils/receipts');

// GET /api/loan-receipts — the signed-in farmer's own loan payment receipts, newest first.
async function listMine(req, res) {
  const rows = await LoanReceipt.find({ farmer: req.user._id }).sort({ issuedAt: -1, _id: -1 }).limit(200).lean();
  new ApiResponse(200, { receipts: rows.map(toReceiptRow) }, 'Receipts fetched').send(res);
}

module.exports = { listMine };