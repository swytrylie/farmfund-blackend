const mongoose = require('mongoose');

/**
 * CoopCreditLimit
 * ---------------
 * A credit limit the OWNER of one cooperative set for one farmer. It replaces
 * the standard PHP 25,000 limit, but only for loans with that cooperative; every
 * other cooperative the farmer borrows from still uses the standard limit.
 *
 * The farmer still needs a verified Barangay Certificate: without one the
 * limit is PHP 0 whatever is stored here (see utils/creditLimit.js).
 */
const MAX_LIMIT = 100000; // the most an owner can set

const coopCreditLimitSchema = new mongoose.Schema(
  {
    cooperative: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true },
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    limit: { type: Number, required: true, min: 0, max: MAX_LIMIT },
    previousLimit: { type: Number, min: 0 }, // what it was before the last change (for the history line)
    note: { type: String, trim: true, maxlength: 300 }, // why the owner set it
    setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    setByName: { type: String, trim: true, maxlength: 120 },
  },
  { timestamps: true }
);

// One limit per farmer per cooperative.
coopCreditLimitSchema.index({ cooperative: 1, farmer: 1 }, { unique: true });
coopCreditLimitSchema.index({ farmer: 1 });

const CoopCreditLimit = mongoose.model('CoopCreditLimit', coopCreditLimitSchema);
CoopCreditLimit.MAX_LIMIT = MAX_LIMIT;
module.exports = CoopCreditLimit;