const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect } = require('../middleware/auth');
const { uploadCertificateFile } = require('../middleware/uploadCertificate'); // same one-file, 2 MB, memory-only rules
const { submit, listMine, listForCooperative, link, verify, reject, withdraw } = require('../controllers/paymentProof.controller');
const { idRule, submitRules, listRules, mineRules, verifyRules, rejectRules } = require('../validators/paymentProof.validator');

const router = express.Router();

// Any signed-in account. Who may see or review each proof is decided in the
// controller: the farmer who sent it, or that cooperative's owner / finance manager.
router.use(protect);

router.get('/mine', mineRules, handleValidationErrors, asyncHandler(listMine)); // before '/:id/...'
router.get('/', listRules, handleValidationErrors, asyncHandler(listForCooperative));
router.post('/', uploadCertificateFile, submitRules, handleValidationErrors, asyncHandler(submit));
router.get('/:id/link', idRule, handleValidationErrors, asyncHandler(link));
router.patch('/:id/verify', verifyRules, handleValidationErrors, asyncHandler(verify));
router.patch('/:id/reject', rejectRules, handleValidationErrors, asyncHandler(reject));
router.delete('/:id', idRule, handleValidationErrors, asyncHandler(withdraw));

module.exports = router;