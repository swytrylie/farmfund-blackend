// One-time fix for loans that were activated BEFORE disbursing a loan
// started setting its due date automatically — those have status "active"
// but no dueDate, so nothing that depends on one (overdue tracking,
// reminders, alerts) can see them.
//
// Safe by default: this only PRINTS what it would change. Nothing is
// written unless you add --apply.
//
//   node scripts/backfillDueDates.js            (preview only)
//   node scripts/backfillDueDates.js --apply    (actually saves)
//
// The original disbursement moment wasn't recorded, so the due date is
// worked out from the loan's issue date (set at approval) — or its
// creation date if even that is missing — plus its term.
require('dotenv').config();
const mongoose = require('mongoose');
// Connects through the server's own module rather than calling
// mongoose.connect directly — config/db.js carries the DNS workaround for
// the Windows/Node 22 "querySrv ECONNREFUSED" bug, which a bare connection
// in a standalone script wouldn't have.
const connectDB = require('../config/db');
const Loan = require('../models/Loan');
const { addMonths } = require('../utils/loanBalance');

const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDB();

  const loans = await Loan.find({
    status: { $in: ['active', 'defaulted'] },
    $or: [{ dueDate: { $exists: false } }, { dueDate: null }],
  });

  if (loans.length === 0) {
    console.log('Nothing to fix — every active loan already has a due date.');
    return;
  }

  console.log(`${loans.length} loan(s) missing a due date:\n`);
  for (const loan of loans) {
    const base = loan.issuedDate || loan.createdAt;
    const due = addMonths(base, loan.termMonths);
    console.log(
      `  ${loan._id}  ₱${loan.principalAmount}  ${loan.termMonths} mo  from ${base.toISOString().slice(0, 10)}  ->  due ${due.toISOString().slice(0, 10)}`
    );
    if (APPLY) {
      loan.dueDate = due;
      await loan.save();
    }
  }

  console.log(APPLY ? '\nDone — saved.' : '\nPreview only. Run again with --apply to save these.');
}

main()
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());