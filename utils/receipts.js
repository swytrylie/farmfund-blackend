const Counter = require('../models/Counter');

/**
 * Receipt numbers look like RCPT-202610-0012: the month the receipt was
 * issued (Philippine time) and a running number for that month, counted across
 * the whole platform.
 */
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

function monthKey(date = new Date()) {
  const ph = new Date(new Date(date).getTime() + PH_OFFSET_MS);
  return `${ph.getUTCFullYear()}${String(ph.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Makes sure this month's counter exists. Done BEFORE the payment transaction
// starts, so two payments racing to create it cannot break that transaction.
async function ensureCounter(date) {
  const key = `receipt-${monthKey(date)}`;
  try {
    await Counter.findOneAndUpdate({ _id: key }, { $setOnInsert: { seq: 0 } }, { upsert: true });
  } catch (err) {
    if (!(err && err.code === 11000)) throw err; // someone else created it a moment ago: fine
  }
  return key;
}

// Takes the next number. Run inside the payment's transaction, so a payment
// that fails afterwards gives its number back (no gaps from rolled-back work).
async function nextReceiptNo(date, session) {
  const key = `receipt-${monthKey(date)}`;
  const counter = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true, session });
  return `RCPT-${monthKey(date)}-${String(counter.seq).padStart(4, '0')}`;
}

// What leaves the server.
function toReceiptRow(r) {
  return {
    id: String(r._id),
    receiptNo: r.receiptNo,
    category: r.category || 'loan_payment',
    cooperativeName: r.cooperativeName || null,
    farmerName: r.farmerName || null,
    loanId: String(r.loan),
    loanRef: r.loanRef || null,
    method: r.method,
    referenceNumber: r.referenceNumber || null,
    amount: r.amount,
    remainingBalance: r.remainingBalance,
    paymentDate: r.paymentDate || null,
    status: r.status || 'verified',
    verifiedByName: r.verifiedByName || null,
    issuedAt: r.issuedAt,
  };
}

module.exports = { monthKey, ensureCounter, nextReceiptNo, toReceiptRow };