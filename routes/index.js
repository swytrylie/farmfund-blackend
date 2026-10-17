const express = require('express');
const authRoutes = require('./auth.routes');
const cropRoutes = require('./crop.routes');
const farmRoutes = require('./farm.routes');
const fieldRoutes = require('./field.routes');
const farmingCycleRoutes = require('./farmingCycle.routes');
const financialRecordRoutes = require('./financialRecord.routes');
const financialCategoryRoutes = require('./financialCategory.routes');
const budgetRoutes = require('./budget.routes');
const loanRoutes = require('./loan.routes');
const loanPaymentRoutes = require('./loanPayment.routes');
const cooperativeRoutes = require('./cooperative.routes');
const dismissedAlertRoutes = require('./dismissedAlert.routes');
const cooperativeInviteRoutes = require('./cooperativeInvite.routes');
const cooperativeMemberRoutes = require('./cooperativeMember.routes');
const loanReminderRoutes = require('./loanReminder.routes');
const adminRoutes = require('./admin.routes');
const announcementRoutes = require('./announcement.routes');
const cronRoutes = require('./cron.routes');
const systemRoutes = require('./system.routes');
const certificateRoutes = require('./certificate.routes');
const notificationRoutes = require('./notification.routes');
const paymentProofRoutes = require('./paymentProof.routes');
const calamityClaimRoutes = require('./calamityClaim.routes');
const { maintenanceGuard } = require('../middleware/maintenanceGuard');

const router = express.Router();

// While maintenance is on, everything except sign-in, admin pages and the
// status check answers 503 (see middleware/maintenanceGuard.js). Must come first.
router.use(maintenanceGuard);

router.use('/loan-reminders', loanReminderRoutes);
router.use('/auth', authRoutes);
router.use('/crops', cropRoutes);
router.use('/farms', farmRoutes);
router.use('/fields', fieldRoutes);
router.use('/farming-cycles', farmingCycleRoutes);
router.use('/financial-records', financialRecordRoutes);
router.use('/financial-categories', financialCategoryRoutes);
router.use('/budgets', budgetRoutes);
router.use('/loans', loanRoutes);
router.use('/loan-payments', loanPaymentRoutes);
router.use('/cooperatives', cooperativeRoutes);
router.use('/dismissed-alerts', dismissedAlertRoutes);
router.use('/cooperative-invites', cooperativeInviteRoutes);
router.use('/cooperative-members', cooperativeMemberRoutes);
router.use('/admin', adminRoutes);
router.use('/announcements', announcementRoutes);
router.use('/cron', cronRoutes);
router.use('/system', systemRoutes);
router.use('/certificates', certificateRoutes);
router.use('/notifications', notificationRoutes);
router.use('/payment-proofs', paymentProofRoutes);
router.use('/calamity-claims', calamityClaimRoutes);

module.exports = router;