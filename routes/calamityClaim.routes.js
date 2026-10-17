const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { uploadCertificateFile } = require('../middleware/uploadCertificate');
const { createClaimRules, claimReviewRules, claimQueueRules, claimIdRule } = require('../validators/calamityClaim.validator');
const { createClaim, adminQueue, adminReview, proofLink, activateFreeze } = require('../controllers/calamityClaim.controller');

const router = express.Router();

// A farmer asks for disaster relief: a form with a file (the proof), so the
// upload is read before the rest of the form is checked.
router.post('/', protect, uploadCertificateFile, createClaimRules, handleValidationErrors, asyncHandler(createClaim));
// The admin's check (the controller refuses anyone who is not an admin).
router.get('/admin/queue', protect, claimQueueRules, handleValidationErrors, asyncHandler(adminQueue)); // before '/:id'
router.patch('/:id/admin-review', protect, claimReviewRules, handleValidationErrors, asyncHandler(adminReview));
router.get('/:id/proof/link', protect, claimIdRule, handleValidationErrors, asyncHandler(proofLink));
// The lending cooperative's owner activates the freeze (the controller checks that).
router.post('/:id/freeze', protect, claimIdRule, handleValidationErrors, asyncHandler(activateFreeze));

module.exports = router;
