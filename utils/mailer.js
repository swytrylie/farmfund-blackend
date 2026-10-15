const nodemailer = require('nodemailer');

// One real Gmail account sends every email the app ever sends — this is
// the "one post office" setup, not something configured per-user. The
// App Password (not the regular Gmail password) is what Google requires
// for a third-party app like this to authenticate via SMTP.
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// The app is built for the Philippines, so dates in emails are always
// shown as the calendar day it is THERE — not whatever timezone the
// server happens to be running in, which could put a due date a day off.
const APP_TIMEZONE = 'Asia/Manila';

// Anything a person typed (a staff member's message, a cooperative's name)
// is escaped at the moment it's put into an email's HTML — not earlier,
// when it's saved — so the stored text stays exactly as typed while the
// email can never be turned into something else by what's in it.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const formatPeso = (n) => `₱${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-US', { timeZone: APP_TIMEZONE, month: 'long', day: 'numeric', year: 'numeric' });

async function sendEmail(to, subject, html) {
  await transporter.sendMail({
    from: `"FarmFund" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
  });
}

// Shared by both signup verification and password-change verification —
// same 6-digit code format either way, just different wording depending
// on which action triggered it.
async function sendOtpEmail(to, code, purposeLabel) {
  await sendEmail(
    to,
    'Your FarmFund verification code',
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #2d4027;">Verify ${purposeLabel}</h2>
        <p>Use this code to confirm it's really you:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #2d4027;">${code}</p>
        <p style="color: #666; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `
  );
}

async function sendInviteEmail(to, inviteLink, cooperativeName) {
  await sendEmail(
    to,
    `You've been invited to join ${cooperativeName} on FarmFund`.replace(/[\r\n]+/g, ' '),
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #2d4027;">You're invited!</h2>
        <p><strong>${escapeHtml(cooperativeName)}</strong> has invited you to join their team on FarmFund.</p>
        <p><a href="${inviteLink}" style="display: inline-block; background: #4f7331; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold;">Accept Invite</a></p>
        <p style="color: #666; font-size: 13px;">This link expires in 7 days. If the button doesn't work, copy and paste this link: ${inviteLink}</p>
      </div>
    `
  );
}

// The personal message comes from the staff member, but every FACT in the
// email (what's owed, when it was due, how late it is) is passed in by the
// server from the loan itself — never from what the browser sent.
async function sendReminderEmail({
  to,
  firstName,
  coopName,
  coopContactEmail,
  coopContactPhone,
  typeLabel,
  message,
  loanRef,
  remaining,
  dueDate,
  daysPastDue,
}) {
  // A loan with no due date on record shouldn't produce "Invalid Date" in
  // front of a borrower — say it plainly instead.
  let dueLine;
  if (!dueDate) dueLine = 'Not set';
  else if (daysPastDue > 0) dueLine = `${formatDate(dueDate)} (${daysPastDue} day${daysPastDue === 1 ? '' : 's'} overdue)`;
  else if (daysPastDue === 0) dueLine = `${formatDate(dueDate)} (due today)`;
  else dueLine = `${formatDate(dueDate)} (due in ${-daysPastDue} day${daysPastDue === -1 ? '' : 's'})`;

  const contactBits = [coopContactEmail, coopContactPhone].filter(Boolean).map(escapeHtml);
  const contactLine = contactBits.length
    ? `<p style="color: #666; font-size: 13px;">Questions? Contact ${escapeHtml(coopName)}: ${contactBits.join(' · ')}</p>`
    : '';

  // Header values can't carry line breaks, whatever a cooperative's name contains.
  const subject = `${typeLabel} — ${coopName}`.replace(/[\r\n]+/g, ' ');

  await sendEmail(
    to,
    subject,
    `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
        <h2 style="color: #2d4027;">${escapeHtml(typeLabel)}</h2>
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>${escapeHtml(message).replace(/\r?\n/g, '<br>')}</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          <tr><td style="padding: 6px 0; color: #666;">Loan</td><td style="padding: 6px 0; text-align: right;"><strong>${escapeHtml(loanRef)}</strong></td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Amount remaining</td><td style="padding: 6px 0; text-align: right;"><strong>${formatPeso(remaining)}</strong></td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Due date</td><td style="padding: 6px 0; text-align: right;"><strong>${dueLine}</strong></td></tr>
          <tr><td style="padding: 6px 0; color: #666;">From</td><td style="padding: 6px 0; text-align: right;"><strong>${escapeHtml(coopName)}</strong></td></tr>
        </table>
        ${contactLine}
      </div>
    `
  );
}

// Sent to a cooperative's finance staff when a farmer uploads a proof of
// payment. Every fact comes from the saved proof and loan on the server; the
// farmer's name, reference number and note are typed by people, so they are
// escaped here. The email never contains the receipt itself — staff open it
// inside FarmFund, where only they can see it.
async function sendPaymentProofEmail({ to, firstName, coopName, farmerName, loanRef, amount, methodLabel, paymentDate, referenceNumber, note, appUrl }) {
  const row = (label, value) =>
    `<tr><td style="padding: 6px 0; color: #666;">${label}</td><td style="padding: 6px 0; text-align: right;"><strong>${value}</strong></td></tr>`;
  const rows = [
    row('Farmer', escapeHtml(farmerName)),
    row('Loan', escapeHtml(loanRef)),
    row('Amount paid', formatPeso(amount)),
    row('Payment method', escapeHtml(methodLabel)),
    row('Payment date', formatDate(paymentDate)),
    referenceNumber ? row('Reference no.', escapeHtml(referenceNumber)) : '',
  ].join('');
  const noteLine = note ? `<p style="color: #444; font-size: 14px;">Their note: ${escapeHtml(note).replace(/\r?\n/g, '<br>')}</p>` : '';
  const link = appUrl
    ? `<p><a href="${escapeHtml(appUrl)}" style="color: #2d4027;">Open FarmFund</a> and go to <strong>Repayment Tracking</strong> to view the proof.</p>`
    : '<p>Open FarmFund and go to <strong>Repayment Tracking</strong> to view the proof.</p>';

  const subject = `Payment proof from ${farmerName} — ${coopName}`.replace(/[\r\n]+/g, ' ');
  await sendEmail(
    to,
    subject,
    wrapEmail(`
        <h2 style="color: #2d4027;">A payment proof needs your review</h2>
        <p>${helloLine(firstName)}</p>
        <p>${escapeHtml(farmerName)} says they paid ${escapeHtml(coopName)} and uploaded a receipt. The loan balance does not change until you verify it.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">${rows}</table>
        ${noteLine}
        ${link}`)
  );
}

// Sent to the OLD address right after the account's email is changed, so a
// change the owner didn't make cannot go unnoticed. Both addresses are typed
// by people, so both are escaped. The link goes to a page with a button — it
// never changes anything just by being opened (email scanners open links).
async function sendEmailChangedNotice(to, newEmail, secureLink) {
  await sendEmail(
    to,
    'Your FarmFund email address was changed',
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #2d4027;">Did you change your email?</h2>
        <p>The email address on your FarmFund account was just changed to <strong>${escapeHtml(newEmail)}</strong>.</p>
        <p>If you did this, you don't need to do anything.</p>
        <p>If you didn't:</p>
        <p><a href="${secureLink}" style="display: inline-block; background: #b42318; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold;">No, secure my account</a></p>
        <p style="color: #666; font-size: 13px;">This puts your old address back, signs out every device, and locks the current password so you can set a new one with "Forgot password". The link works once and expires in 7 days.</p>
        <p style="color: #666; font-size: 12px;">If the button doesn't work, copy and paste this link: ${secureLink}<br>If this isn't you and you can't use the link, contact your FarmFund administrator.</p>
      </div>
    `
  );
}

// Sent to someone the cooperative's owner removed. Their account is deleted
// as part of the removal, so this email is the only notice they get — it says
// plainly what happened and that they can sign up again with the same email.
async function sendAccountRemovedEmail(to, firstName, cooperativeName) {
  const coop = escapeHtml(cooperativeName || 'your cooperative');
  const hello = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hello,';
  await sendEmail(
    to,
    'Your FarmFund account has been deleted',
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #2d4027;">Your account was removed</h2>
        <p>${hello}</p>
        <p>The owner of <strong>${coop}</strong> removed you from the cooperative on FarmFund. Because of that, your FarmFund account has been <strong>deleted</strong> and you can no longer sign in with it.</p>
        <p>If you believe this was a mistake, please contact the cooperative's owner directly. You are always welcome to create a new FarmFund account with this email address.</p>
        <p style="color: #666; font-size: 13px;">This is an automatic message from FarmFund.</p>
      </div>
    `
  );
}

// Sent to a cooperative's owner when an admin approves or declines the
// application. The approved email links to the login page; the declined one
// says plainly that the account can't be used.
async function sendCooperativeDecisionEmail(to, firstName, cooperativeName, approved) {
  const coop = escapeHtml(cooperativeName || 'your cooperative');
  const hello = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hello,';
  const loginUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/+$/, '') : '';
  const button = loginUrl
    ? `<p style="margin: 24px 0;"><a href="${escapeHtml(loginUrl)}" style="background: #2d4027; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Log in to FarmFund</a></p>`
    : '';
  const subject = approved
    ? 'Your organization was approved on FarmFund'
    : 'Update on your FarmFund organization application';
  const body = approved
    ? `<h2 style="color: #2d4027;">You're approved</h2>
        <p>${hello}</p>
        <p><strong>${coop}</strong> has been approved. You can now log in as the owner and start using FarmFund.</p>
        ${button}`
    : `<h2 style="color: #2d4027;">Application not approved</h2>
        <p>${hello}</p>
        <p>Your application for <strong>${coop}</strong> was not approved, so the account can't be used to log in.</p>
        <p>If you think this was a mistake, please contact FarmFund support.</p>`;
  await sendEmail(
    to,
    subject,
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        ${body}
        <p style="color: #666; font-size: 13px;">This is an automatic message from FarmFund.</p>
      </div>
    `
  );
}

// ---- Emails sent when an ADMIN acts on someone's account ----

function helloLine(firstName) {
  return firstName ? `Hi ${escapeHtml(firstName)},` : 'Hello,';
}

function wrapEmail(body) {
  return `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        ${body}
        <p style="color: #666; font-size: 13px;">This is an automatic message from FarmFund.</p>
      </div>
    `;
}

async function sendAccountSuspendedEmail(to, firstName, reason) {
  const why = reason
    ? `<p><strong>Reason given:</strong> ${escapeHtml(reason)}</p>`
    : '';
  await sendEmail(
    to,
    'Your FarmFund account has been suspended',
    wrapEmail(`
        <h2 style="color: #2d4027;">Account suspended</h2>
        <p>${helloLine(firstName)}</p>
        <p>A FarmFund administrator has suspended your account, so you can't sign in for now.</p>
        ${why}
        <p>If you think this was a mistake, please contact FarmFund support.</p>`)
  );
}

async function sendAccountReactivatedEmail(to, firstName) {
  const loginUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/+$/, '') : '';
  const button = loginUrl
    ? `<p style="margin: 24px 0;"><a href="${escapeHtml(loginUrl)}" style="background: #2d4027; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Log in to FarmFund</a></p>`
    : '';
  await sendEmail(
    to,
    'Your FarmFund account is active again',
    wrapEmail(`
        <h2 style="color: #2d4027;">Welcome back</h2>
        <p>${helloLine(firstName)}</p>
        <p>A FarmFund administrator has reactivated your account. You can sign in again with your usual email and password.</p>
        ${button}`)
  );
}

async function sendAccountDeletedByAdminEmail(to, firstName) {
  await sendEmail(
    to,
    'Your FarmFund account has been deleted',
    wrapEmail(`
        <h2 style="color: #2d4027;">Account deleted</h2>
        <p>${helloLine(firstName)}</p>
        <p>A FarmFund administrator has deleted your account and its data. You can no longer sign in with it.</p>
        <p>If you believe this was a mistake, please contact FarmFund support. You are welcome to create a new account with this email address.</p>`)
  );
}

// Goes to the OLD address (the one that just stopped working) and, separately,
// to the new one so the person knows what to sign in with from now on.
async function sendAdminEmailChangeNotice(to, firstName, oldEmail, newEmail, isNewAddress) {
  const body = isNewAddress
    ? `<p>${helloLine(firstName)}</p>
        <p>A FarmFund administrator changed the email on your account. From now on, sign in with <strong>${escapeHtml(newEmail)}</strong> and your usual password.</p>`
    : `<p>${helloLine(firstName)}</p>
        <p>A FarmFund administrator changed the email on your account from <strong>${escapeHtml(oldEmail)}</strong> to <strong>${escapeHtml(newEmail)}</strong>. You were signed out everywhere.</p>
        <p>If you weren't expecting this, please contact FarmFund support.</p>`;
  await sendEmail(to, 'The email on your FarmFund account was changed', wrapEmail(`<h2 style="color: #2d4027;">Email changed</h2>${body}`));
}

// The admin can't set someone's password — they can only ask the person to
// reset it themselves, through the normal Forgot Password steps.
async function sendAdminPasswordResetRequest(to, firstName) {
  const loginUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/+$/, '') : '';
  const button = loginUrl
    ? `<p style="margin: 24px 0;"><a href="${escapeHtml(loginUrl)}" style="background: #2d4027; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Open FarmFund</a></p>`
    : '';
  await sendEmail(
    to,
    'Please reset your FarmFund password',
    wrapEmail(`
        <h2 style="color: #2d4027;">Reset your password</h2>
        <p>${helloLine(firstName)}</p>
        <p>A FarmFund administrator asked that you reset your password.</p>
        <ol>
          <li>Open FarmFund and choose <strong>Log in</strong>.</li>
          <li>Click <strong>Forgot Password?</strong> and enter this email address.</li>
          <li>Enter the 6-digit code we email you, then choose a new password.</li>
        </ol>
        ${button}
        <p style="color: #666; font-size: 13px;">If you weren't expecting this, you can ignore this email — your password hasn't changed.</p>`)
  );
}

module.exports = {
  sendEmail, sendOtpEmail, sendInviteEmail, sendReminderEmail, sendPaymentProofEmail, sendEmailChangedNotice,
  sendAccountRemovedEmail, sendCooperativeDecisionEmail,
  sendAccountSuspendedEmail, sendAccountReactivatedEmail, sendAccountDeletedByAdminEmail,
  sendAdminEmailChangeNotice, sendAdminPasswordResetRequest,
};