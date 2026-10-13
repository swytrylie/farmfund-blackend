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
const { getReports } = require('../controllers/adminReports.controller');
const { listAnnouncements, sendAnnouncement } = require('../controllers/adminAnnouncements.controller');
const { listAnnouncementsRules, sendAnnouncementRules } = require('../validators/adminAnnouncements.validator');
const { listBackups, runBackup, downloadBackup, restore } = require('../controllers/adminBackup.controller');
const { listBackupsRules, backupIdRule, restoreRules } = require('../validators/adminBackup.validator');
const { getSystem, setMaintenance, updateWindow } = require('../controllers/adminSystem.controller');
const { maintenanceRules, windowRules } = require('../validators/adminSystem.validator');
const { listAuditLogsRules } = require('../validators/adminAudit.validator');
const {
  getCooperativeImpact,
  deleteCooperative,
  listArchive,
  getArchived,
  restoreArchived,
  purgeArchived,
} = require('../controllers/adminArchive.controller');
const { cooperativeIdRule, archiveIdRule, deleteCooperativeRules, listArchiveRules } = require('../validators/adminArchive.validator');
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

router.get('/cooperatives/:id/impact', cooperativeIdRule, handleValidationErrors, asyncHandler(getCooperativeImpact));
router.delete('/cooperatives/:id', deleteCooperativeRules, handleValidationErrors, asyncHandler(deleteCooperative));
router.get('/archive', listArchiveRules, handleValidationErrors, asyncHandler(listArchive));
router.get('/archive/:id', archiveIdRule, handleValidationErrors, asyncHandler(getArchived));
router.post('/archive/:id/restore', archiveIdRule, handleValidationErrors, asyncHandler(restoreArchived));
router.delete('/archive/:id', archiveIdRule, handleValidationErrors, asyncHandler(purgeArchived));

router.get('/audit-logs', listAuditLogsRules, handleValidationErrors, asyncHandler(listAuditLogs));
router.get('/farms', listFarmsRules, handleValidationErrors, asyncHandler(listFarms));
router.get('/activity', listActivityRules, handleValidationErrors, asyncHandler(listActivity));
router.get('/financial/overview', asyncHandler(getOverview));
router.get('/financial/farmers', listFarmersRules, handleValidationErrors, asyncHandler(listFarmers));
router.post('/financial/farmers/:id/access', grantAccessRules, handleValidationErrors, asyncHandler(grantAccess));
router.get('/financial/farmers/:id/records', farmerIdRule, handleValidationErrors, asyncHandler(getFarmerRecords));
router.get('/reports', asyncHandler(getReports));
router.get('/announcements', listAnnouncementsRules, handleValidationErrors, asyncHandler(listAnnouncements));
router.post('/announcements', sendAnnouncementRules, handleValidationErrors, asyncHandler(sendAnnouncement));
router.get('/backups', listBackupsRules, handleValidationErrors, asyncHandler(listBackups));
router.post('/backups', asyncHandler(runBackup));
router.get('/backups/:id/download', backupIdRule, handleValidationErrors, asyncHandler(downloadBackup));
router.post('/backups/:id/restore', restoreRules, handleValidationErrors, asyncHandler(restore));
router.get('/system', asyncHandler(getSystem));
router.patch('/system/maintenance', maintenanceRules, handleValidationErrors, asyncHandler(setMaintenance));
router.put('/system/maintenance-window', windowRules, handleValidationErrors, asyncHandler(updateWindow));

module.exports = router;