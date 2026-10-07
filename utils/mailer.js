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

module.exports = { sendEmail, sendOtpEmail, sendInviteEmail, sendReminderEmail, sendEmailChangedNotice };