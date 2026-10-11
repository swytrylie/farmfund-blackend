// Creates the platform ADMIN account (the person who runs FarmFund itself).
// There is no sign-up page for admins on purpose — anyone could use it. This
// script is the only way one is made, and only someone with access to your
// backend folder and .env can run it.
//
//   node scripts/createAdmin.js --email=you@example.com --password="YourStrong#Pass1" --first=Ricky --last=Lyndizon
//
// --first and --last are optional (default: "FarmFund" "Admin").
//
// It refuses to touch an email that already has an account (it never turns an
// existing user into an admin, and never overwrites a password).

const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12; // same as sign-up, so login treats it identically

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[a-z]/.test(pw)) return 'Password needs a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password needs an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password needs a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password needs a special character.';
  return null;
}

// Takes the User model so it can be tested without a real database.
async function createAdmin(User, { email, password, first = 'FarmFund', last = 'Admin' }) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Give a real email with --email=...');
  const pwProblem = checkPassword(password);
  if (pwProblem) throw new Error(pwProblem);

  const existing = await User.findOne({ email }).select('role');
  if (existing) {
    throw new Error(
      `An account with ${email} already exists (role: ${existing.role}). ` +
      'Use a different email — this script never changes an existing account.'
    );
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const admin = await User.create({
    firstName: String(first).trim() || 'FarmFund',
    lastName: String(last).trim() || 'Admin',
    email,
    passwordHash,
    role: 'admin',
    isEmailVerified: true,
    isActive: true,
  });
  return admin;
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const args = parseArgs(process.argv.slice(2));
  if (!args.email || !args.password) {
    console.log('Usage: node scripts/createAdmin.js --email=you@example.com --password="Strong#Pass123" [--first=Name] [--last=Name]');
    process.exitCode = 1;
    return;
  }
  const connectDB = require('../config/db');
  await connectDB();
  const User = require('../models/User');
  const admin = await createAdmin(User, args);
  console.log(`\nAdmin created: ${admin.email}`);
  console.log(`Database: ${mongoose.connection.name}`);
  console.log('You can now log in at the admin login page.\n');
}

module.exports = { createAdmin, checkPassword, parseArgs };

if (require.main === module) {
  main()
    .catch((err) => { console.error('\nFailed:', err.message, '\n'); process.exitCode = 1; })
    .finally(async () => { try { await require('mongoose').disconnect(); } catch { /* ignore */ } process.exit(); });
}