// One-time cleanup: before codes were hashed, a pending verification code was
// saved in the users collection as readable text (the field `otpCode`). New
// codes are never stored that way, but any account that had a code waiting at
// the moment of the upgrade still carries the old readable one. This removes
// it. (Those codes were at most 10 minutes old and are useless now — whoever
// is mid-signup just taps "Resend" to get a new one.)
//
// Safe by default: only COUNTS what it would remove. Nothing is changed
// unless you add --apply.
//
//   node scripts/removePlainOtpCodes.js            (preview only)
//   node scripts/removePlainOtpCodes.js --apply    (actually removes them)
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDB();
  const users = mongoose.connection.collection('users');

  // Raw collection on purpose: the field no longer exists in the User schema,
  // so the model would not even see it.
  const count = await users.countDocuments({ otpCode: { $exists: true } });

  if (count === 0) {
    console.log('Nothing to fix — no account has a readable code saved.');
    return;
  }

  console.log(`${count} account(s) still have a readable code saved.`);
  if (!APPLY) {
    console.log('\nPreview only — nothing was changed. Run again with --apply to remove them.');
    return;
  }

  const result = await users.updateMany({ otpCode: { $exists: true } }, { $unset: { otpCode: '' } });
  console.log(`\nRemoved the readable code from ${result.modifiedCount} account(s).`);
}

main()
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());