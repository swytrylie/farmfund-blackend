const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const handleValidationErrors = require('../middleware/handleValidationErrors');
const { protect, authorize } = require('../middleware/auth');
const { getDashboard } = require('../controllers/admin.controller');
const {
  listUsers,
  suspendUser,
  reactivateUser,
  updateUser,
  requestPasswordReset,
  deleteUser,
} = require('../controllers/adminUsers.controller');
const { listAuditLogs } = require('../controllers/adminAudit.controller');
const { listFarms } = require('../controllers/adminFarms.controller');
const { listFarmsRules } = require('../validators/adminFarms.validator');
const { listActivity } = require('../controllers/adminActivity.controller');
const { listActivityRules } = require('../validators/adminActivity.validator');
const { getOverview, listFarmers, grantAccess, getFarmerRecords } = require('../controllers/adminFinancial.controller');
const { farmerIdRule, listFarmersRules, grantAccessRules } = require('../validators/adminFinancial.validator');
const { listAuditLogsRules } = require('../validators/adminAudit.validator');
const { userIdRule, listUsersRules, suspendRules, updateUserRules } = require('../validators/adminUsers.validator');

const router = express.Router();

// Everything under /api/admin is admin-only.
router.use(protect, authorize('admin'));

router.get('/dashboard', asyncHandler(getDashboard));

router.get('/users', listUsersRules, handleValidationErrors, asyncHandler(listUsers));
router.patch('/users/:id/suspend', suspendRules, handleValidationErrors, asyncHandler(suspendUser));
router.patch('/users/:id/reactivate', userIdRule, handleValidationErrors, asyncHandler(reactivateUser));
router.post('/users/:id/password-reset', userIdRule, handleValidationErrors, asyncHandler(requestPasswordReset));
router.patch('/users/:id', updateUserRules, handleValidationErrors, asyncHandler(updateUser));
router.delete('/users/:id', userIdRule, handleValidationErrors, asyncHandler(deleteUser));

router.get('/audit-logs', listAuditLogsRules, handleValidationErrors, asyncHandler(listAuditLogs));
router.get('/farms', listFarmsRules, handleValidationErrors, asyncHandler(listFarms));
router.get('/activity', listActivityRules, handleValidationErrors, asyncHandler(listActivity));
router.get('/financial/overview', asyncHandler(getOverview));
router.get('/financial/farmers', listFarmersRules, handleValidationErrors, asyncHandler(listFarmers));
router.post('/financial/farmers/:id/access', grantAccessRules, handleValidationErrors, asyncHandler(grantAccess));
router.get('/financial/farmers/:id/records', farmerIdRule, handleValidationErrors, asyncHandler(getFarmerRecords));

module.exports = router;