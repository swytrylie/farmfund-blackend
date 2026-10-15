// The kinds of record a backup covers. This is a written-out list on purpose
// (not "every file in models/"): the hosting platform only packs the files the
// code visibly requires, so a folder scan would break after deploying.
//
// NOT backed up, on purpose:
//   AuditLog, LoginEvent  - history of what happened; a restore must never erase it
//   RecordAccess          - admin access grants, not user data
//   Backup, BackupChunk   - the backups themselves
//   SystemSetting         - maintenance mode / window; a restore must not switch the site on or off
//
// Notification rows (what borrowers see in their bell) are backed up too.
// Certificate rows are backed up (the record of each upload and its review). The
// files themselves live in Cloudinary, which is not part of a backup. The same
// goes for PaymentProof rows (farmers' receipts for loan payments).
// Admin accounts are never touched either (see utils/backup.js).
//
// If you add a new model later, add it here too — otherwise it is not backed up.
const MODELS = [
  require('../models/Announcement'),
  require('../models/Budget'),
  require('../models/Certificate'),
  require('../models/Cooperative'),
  require('../models/CooperativeInvite'),
  require('../models/CooperativeMember'),
  require('../models/Crop'),
  require('../models/DismissedAlert'),
  require('../models/Farm'),
  require('../models/FarmingCycle'),
  require('../models/Field'),
  require('../models/FinancialCategory'),
  require('../models/FinancialRecord'),
  require('../models/Loan'),
  require('../models/LoanPayment'),
  require('../models/LoanReminder'),
  require('../models/Notification'),
  require('../models/PaymentProof'),
  require('../models/PaymentTransaction'),
  require('../models/User'),
];

function loadBackupModels() {
  return MODELS;
}

module.exports = { loadBackupModels };