const Notification = require('../models/Notification');
const mailer = require('./mailer');

/**
 * Payment notices
 * ---------------
 * What the farmer is told once their cooperative verifies a proof of payment:
 * a bell item (kind loan_update) and an email, both naming the receipt that was
 * issued. By the time this runs the payment and its receipt are already saved
 * (in one transaction), so neither part may throw: a down email service must
 * never undo, or fail, a payment that has been recorded.
 *
 * The notice never says WHO at the cooperative verified it, only the
 * cooperative, the same way payment reminders work.
 */
const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const appUrl = () => (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/+$/, '') : '');
const shorten = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

async function tellFarmerPaymentVerified({ farmer, proof, coopName, methodLabel, loanRef, receiptNo, remainingBalance, paidOff }) {
  const coop = coopName || 'Your cooperative';
  const message = `${shorten(coop, 60)} verified your ${peso(proof.amount)} ${methodLabel} payment. Receipt ${receiptNo} is ready.${paidOff ? ' Your loan is now fully paid.' : ''}`;

  try {
    await Notification.create({
      user: proof.farmer,
      kind: 'loan_update',
      title: paidOff ? 'Payment verified — loan fully paid' : 'Payment verified',
      message: message.slice(0, 200),
      details: {
        coopName: coop.slice(0, 200),
        typeLabel: 'Payment verified',
        loanRef,
        amount: proof.amount,
        remaining: remainingBalance,
        methodLabel,
        receiptNo,
      },
      loan: proof.loan,
      cooperative: proof.cooperative,
    });
  } catch (err) {
    console.error('Could not save the payment-verified notification:', err && err.message);
  }

  if (!farmer || !farmer.email) return;
  try {
    await mailer.sendPaymentVerifiedEmail({
      to: farmer.email,
      firstName: farmer.firstName,
      coopName: coop,
      loanRef,
      amount: proof.amount,
      methodLabel,
      referenceNumber: proof.referenceNumber || '',
      receiptNo,
      remaining: remainingBalance,
      paidOff: Boolean(paidOff),
      appUrl: appUrl(),
    });
  } catch (err) {
    console.error('Could not send the payment-verified email:', err && err.message);
  }
}

module.exports = { tellFarmerPaymentVerified };