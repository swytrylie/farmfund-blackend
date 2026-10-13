const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { uploadCertificateFile } = require('../middleware/uploadCertificate');
const { listMine, create, remove, listForFarmer, link, review } = require('../controllers/certificate.controller');
const { idRule, farmerIdRule, createRules, reviewRules } = require('../validators/certificate.validator');

const router = express.Router();

// Any signed-in account. What each person may see is decided per certificate
// in the controller (the farmer, the admin, or a cooperative the farmer borrowed from).
router.use(protect);

router.get('/', asyncHandler(listMine));
router.post('/', uploadCertificateFile, createRules, handleValidationErrors, asyncHandler(create));
router.get('/farmer/:farmerId', farmerIdRule, handleValidationErrors, asyncHandler(listForFarmer));
router.get('/:id/link', idRule, handleValidationErrors, asyncHandler(link));
router.patch('/:id/review', reviewRules, handleValidationErrors, asyncHandler(review));
router.delete('/:id', idRule, handleValidationErrors, asyncHandler(remove));

module.exports = router;