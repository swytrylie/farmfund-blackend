const mongoose = require('mongoose');
const { CALAMITY_KEYS } = require('../utils/loanTerms');

/**
 * CalamityClaim
 * -------------
 * A farmer's request for disaster relief on one running crop loan: "a flood
 * (typhoon, drought...) hit my farm, here is the proof". It goes to a FarmFund
 * admin first. Once the admin verifies it, the lending cooperative's owner and
 * finance managers can see it, and only the OWNER can activate the calamity
 * freeze, which pushes that loan's due date 90 days later with no new interest.
 *
 * The proof (photo or PDF) is private on Cloudinary. publicId is left out of
 * every normal query and is asked for by name only where a signed link is made.
 */
const calamityClaimSchema = new mongoose.Schema(
  {
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
    // Copied from the loan when submitted, so lists are one simple query.
    cooperative: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true },
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    calamity: { type: String, enum: CALAMITY_KEYS, required: true },
    description: { type: String, trim: true, maxlength: 500, required: true },
    file: {
      publicId: { type: String, required: true, select: false },
      format: { type: String, required: true }, // pdf | jpg | png
      bytes: { type: Number, required: true },
      originalName: { type: String, trim: true, maxlength: 200 },
    },

    // The admin's check.
    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    reviewNote: { type: String, trim: true, maxlength: 300 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedByName: { type: String, trim: true, maxlength: 200 },
    reviewedAt: { type: Date },

    // The cooperative owner's freeze, once activated.
    freeze: {
      activatedAt: { type: Date },
      activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      activatedByName: { type: String, trim: true, maxlength: 200 },
      endsAt: { type: Date },
      previousDueDate: { type: Date },
      newDueDate: { type: Date },
      // Set once the farmer was told the freeze ended, so it is only said once.
      endNotifiedAt: { type: Date },
    },
  },
  { timestamps: true }
);

calamityClaimSchema.index({ status: 1, createdAt: 1 });
calamityClaimSchema.index({ loan: 1, createdAt: -1 });
calamityClaimSchema.index({ farmer: 1, createdAt: -1 });
calamityClaimSchema.index({ 'freeze.endsAt': 1 });

module.exports = mongoose.model('CalamityClaim', calamityClaimSchema);
