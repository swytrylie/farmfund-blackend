const PaymentProof = require('../models/PaymentProof');
const Loan = require('../models/Loan');
const LoanPayment = require('../models/LoanPayment');
const CooperativeMember = require('../models/CooperativeMember');
const Cooperative = require('../models/Cooperative');
const Notification = require('../models/Notification');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const storage = require('../utils/cloudinary');
const { sniff } = require('../utils/fileSniff');
const { round2, totalPayable } = require('../utils/loanBalance');
const { recordLoanPayment, ACTIVE_LIKE } = require('../utils/recordLoanPayment');
const { sendPaymentProofEmail } = require('../utils/mailer');
const LoanReceipt = require('../models/LoanReceipt');
const { ensureCounter, nextReceiptNo } = require('../utils/receipts');

const STAFF_ROLES = ['owner', 'finance_manager'];
const MAX_PENDING_PER_LOAN = 5;

const METHOD_LABEL = { gcash: 'GCash', maya: 'Maya', cash: 'Cash', bank_transfer: 'Bank transfer' };
const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ') || 'A farmer';
const loanRefOf = (id) => `#${String(id).slice(-6).toUpperCase()}`;
const idOf = (v) => String(v && v._id ? v._id : v);

// Admin, or an active owner / finance manager of that cooperative.
async function isStaffOf(cooperativeId, user) {
  if (user.role === 'admin') return true;
  const m = await CooperativeMember.findOne({ cooperative: cooperativeId, user: user._id, role: { $in: STAFF_ROLES }, status: 'active' });
  return Boolean(m);
}

// What leaves the server. Never the file's storage reference.
function toRow(p) {
  const loan = p.loan && p.loan._id ? p.loan : null;
  const farmer = p.farmer && p.farmer._id ? p.farmer : null;
  const coop = p.cooperative && p.cooperative._id ? p.cooperative : null;
  return {
    id: String(p._id),
    loanId: idOf(p.loan),
    loanRef: loanRefOf(idOf(p.loan)),
    farmerId: idOf(p.farmer),
    farmerName: farmer ? fullName(farmer) : null,
    cooperativeId: idOf(p.cooperative),
    cooperativeName: coop ? coop.name : null,
    principalAmount: loan ? loan.principalAmount : null,
    amount: p.amount,
    method: p.method,
    paymentDate: p.paymentDate,
    referenceNumber: p.referenceNumber || null,
    note: p.note || null,
    status: p.status,
    reviewNote: p.reviewNote || null,
    reviewedByName: p.reviewedByName || null,
    reviewedAt: p.reviewedAt || null,
    fileName: p.file && p.file.originalName ? p.file.originalName : null,
    fileType: p.file ? p.file.format : null,
    bytes: p.file ? p.file.bytes : null,
    createdAt: p.createdAt,
  };
}

// Tells the cooperative's finance staff, in their alerts and by email. Neither
// part may break the farmer's upload: it is already saved by now.
async function notifyStaff({ proof, loan, farmer, coop }) {
  let staff = [];
  try {
    const members = await CooperativeMember.find({ cooperative: coop._id, role: { $in: STAFF_ROLES }, status: 'active' }).select('user').lean();
    if (members.length) staff = await User.find({ _id: { $in: members.map((m) => m.user) } }).select('firstName lastName email').lean();
  } catch (err) {
    console.error('Could not look up who to tell about a payment proof:', err.message);
    return;
  }

  const farmerName = fullName(farmer);
  const loanRef = loanRefOf(loan._id);
  const methodLabel = METHOD_LABEL[proof.method];
  const appUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/+$/, '') : '';
  const amountText = `₱${proof.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  await Promise.all(
    staff.map(async (person) => {
      try {
        await Notification.create({
          user: person._id,
          kind: 'payment_proof_submitted',
          title: 'Payment proof to review',
          message: `${farmerName} sent a ${amountText} ${methodLabel} payment proof for loan ${loanRef}.`.slice(0, 200),
          details: { coopName: coop.name, typeLabel: 'Payment proof', loanRef, farmerName, amount: proof.amount, methodLabel },
          loan: loan._id,
          cooperative: coop._id,
          paymentProof: proof._id,
        });
      } catch (err) {
        console.error('Failed to save the payment proof notification:', err.message);
      }
      if (!person.email) return;
      try {
        await sendPaymentProofEmail({
          to: person.email,
          firstName: person.firstName,
          coopName: coop.name,
          farmerName,
          loanRef,
          amount: proof.amount,
          methodLabel,
          paymentDate: proof.paymentDate,
          referenceNumber: proof.referenceNumber,
          note: proof.note,
          appUrl,
        });
      } catch (err) {
        console.error('Failed to send the payment proof email:', err.message);
      }
    })
  );
}

// POST /api/payment-proofs  (multipart: file, loan, amount, method, paymentDate?, referenceNumber?, note?)
// A farmer says "I paid" and attaches the receipt. Nothing about the loan changes yet.
async function submit(req, res) {
  if (req.user.role === 'admin') throw ApiError.forbidden('Admin accounts do not have loans');
  if (!storage.isConfigured()) throw new ApiError(503, 'File storage is not set up yet. Please try again later.');
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) throw ApiError.badRequest('Upload a photo or PDF of your receipt');

  const kind = sniff(req.file.buffer);
  if (!kind) throw ApiError.badRequest('Only PDF, JPG or PNG files can be uploaded');

  const { loan: loanId, amount, method, paymentDate, referenceNumber, note } = req.body;

  // Somebody else's loan looks exactly like one that does not exist.
  const loan = await Loan.findById(loanId);
  if (!loan || String(loan.farmer) !== String(req.user._id)) throw ApiError.notFound('Loan not found');
  if (!ACTIVE_LIKE.includes(loan.status)) {
    throw ApiError.badRequest(`You can only pay an active loan (this loan is ${loan.status})`);
  }

  const sums = await LoanPayment.aggregate([{ $match: { loan: loan._id } }, { $group: { _id: null, paid: { $sum: '$amount' } } }]);
  const remaining = round2(totalPayable(loan) - round2(sums[0]?.paid || 0));
  if (remaining <= 0.001) throw ApiError.badRequest('This loan has nothing left to pay');
  if (amount > remaining + 0.001) throw ApiError.badRequest(`That is more than the remaining balance of ₱${remaining.toFixed(2)}`);

  const pending = await PaymentProof.countDocuments({ loan: loan._id, status: 'pending' });
  if (pending >= MAX_PENDING_PER_LOAN) {
    throw ApiError.conflict(`You already have ${MAX_PENDING_PER_LOAN} proofs waiting for this loan. Wait for the cooperative to check them first.`);
  }

  const coop = await Cooperative.findById(loan.cooperative).select('name').lean();
  if (!coop) throw ApiError.notFound("This loan's cooperative could not be found");

  let stored;
  try {
    stored = await storage.uploadBuffer(req.file.buffer, storage.PROOF_FOLDER);
  } catch (err) {
    console.error('Payment proof upload to Cloudinary failed:', err && err.message);
    throw new ApiError(502, 'The file could not be stored. Please try again.');
  }

  const rawName = typeof req.file.originalname === 'string' ? req.file.originalname : '';
  let proof;
  try {
    proof = await PaymentProof.create({
      loan: loan._id,
      cooperative: loan.cooperative,
      farmer: req.user._id,
      amount,
      method,
      paymentDate: paymentDate || new Date(),
      referenceNumber: referenceNumber || undefined,
      note: note || undefined,
      file: {
        publicId: stored.publicId,
        format: kind.ext, // what the file really is
        bytes: req.file.buffer.length,
        originalName: rawName.replace(/[<>\r\n]/g, '').slice(0, 200) || undefined,
      },
    });
  } catch (err) {
    await storage.destroy(stored.publicId); // do not leave a file nobody points to
    throw err;
  }

  await notifyStaff({ proof, loan, farmer: req.user, coop });

  new ApiResponse(201, { proof: toRow(proof) }, 'Payment proof sent to your cooperative').send(res);
}

// GET /api/payment-proofs/mine?loan=<id> — the signed-in farmer's own proofs
async function listMine(req, res) {
  const filter = { farmer: req.user._id };
  if (req.query.loan) filter.loan = req.query.loan;
  const rows = await PaymentProof.find(filter).populate('cooperative', 'name').sort({ createdAt: -1, _id: -1 }).limit(100).lean();
  new ApiResponse(200, { proofs: rows.map(toRow) }, 'Payment proofs fetched').send(res);
}

// GET /api/payment-proofs?cooperative=<id>&status=  — for that cooperative's finance staff
async function listForCooperative(req, res) {
  const { cooperative: coopId, status } = req.query;
  if (!(await isStaffOf(coopId, req.user))) throw ApiError.forbidden('You do not have permission to view these payment proofs');

  const page = req.query.page || 1;
  const limit = req.query.limit || 50;
  const filter = { cooperative: coopId, ...(status ? { status } : {}) };

  const [rows, total, pendingCount] = await Promise.all([
    PaymentProof.find(filter)
      .populate('farmer', 'firstName lastName')
      .populate('loan', 'principalAmount')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PaymentProof.countDocuments(filter),
    PaymentProof.countDocuments({ cooperative: coopId, status: 'pending' }),
  ]);

  new ApiResponse(200, { proofs: rows.map(toRow), total, pendingCount, page, pages: Math.max(1, Math.ceil(total / limit)) }, 'Payment proofs fetched').send(res);
}

// GET /api/payment-proofs/:id/link — a link that opens the receipt for 5 minutes
async function link(req, res) {
  const doc = await PaymentProof.findById(req.params.id).lean();
  // Same answer for "does not exist" and "not yours", so ids cannot be probed.
  const allowed = doc && (String(doc.farmer) === String(req.user._id) || (await isStaffOf(doc.cooperative, req.user)));
  if (!allowed) throw ApiError.notFound('Payment proof not found');
  if (!storage.isConfigured()) throw new ApiError(503, 'File storage is not set up yet. Please try again later.');

  let url;
  try {
    url = storage.signedLink(doc.file.publicId, doc.file.format);
  } catch (err) {
    console.error('Could not build payment proof link:', err && err.message);
    throw new ApiError(502, 'The file could not be opened. Please try again.');
  }
  new ApiResponse(200, { url, expiresInSeconds: storage.LINK_SECONDS, fileType: doc.file.format }, 'Link ready').send(res);
}

async function loadForReview(req) {
  const doc = await PaymentProof.findById(req.params.id);
  if (!doc || !(await isStaffOf(doc.cooperative, req.user))) throw ApiError.notFound('Payment proof not found');
  if (doc.status !== 'pending') throw ApiError.conflict(`This proof was already ${doc.status}.`);
  return doc;
}

function reviewSet(req, status, note, at = new Date()) {
  return {
    status,
    reviewedBy: req.user._id,
    reviewedByName: fullName(req.user),
    reviewedAt: at,
    ...(note ? { reviewNote: note } : {}),
  };
}

// PATCH /api/payment-proofs/:id/verify  { note? }
// Records the payment on the loan and marks the proof verified — both or neither.
async function verify(req, res) {
  const doc = await loadForReview(req);
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';

  // The farmer's official receipt is issued in the same transaction as the
  // payment, so a verified payment always has exactly one receipt. What goes on
  // it is read first, so the transaction itself stays short.
  const issuedAt = new Date();
  const [coop, farmer] = await Promise.all([
    Cooperative.findById(doc.cooperative).select('name').lean(),
    User.findById(doc.farmer).select('firstName lastName').lean(),
  ]);
  await ensureCounter(issuedAt);

  let updated;
  const result = await recordLoanPayment({
    loanId: doc.loan,
    amount: doc.amount,
    method: doc.method,
    paymentDate: doc.paymentDate,
    recordedBy: req.user._id,
    inside: async (session, payment, totals) => {
      // Only a still-pending proof can be flipped, so two people verifying at
      // once cannot both record the payment.
      updated = await PaymentProof.findOneAndUpdate(
        { _id: doc._id, status: 'pending' },
        { $set: { ...reviewSet(req, 'verified', note, issuedAt), loanPayment: payment._id } },
        { new: true, session }
      );
      if (!updated) throw ApiError.conflict('This proof was already reviewed.');

      const receiptNo = await nextReceiptNo(issuedAt, session);
      await LoanReceipt.create(
        [
          {
            receiptNo,
            category: 'loan_payment',
            farmer: doc.farmer,
            farmerName: fullName(farmer),
            cooperative: doc.cooperative,
            cooperativeName: coop ? coop.name : undefined,
            loan: doc.loan,
            loanRef: loanRefOf(doc.loan),
            loanPayment: payment._id,
            paymentProof: doc._id,
            method: doc.method,
            referenceNumber: doc.referenceNumber || undefined,
            amount: doc.amount,
            remainingBalance: totals.remainingBalance,
            paymentDate: doc.paymentDate,
            status: 'verified',
            verifiedByName: fullName(req.user),
            issuedAt,
          },
        ],
        { session }
      );
    },
  });

  new ApiResponse(
    200,
    { proof: toRow(updated), loanStatus: result.loanStatus, amountPaid: result.amountPaid, remainingBalance: result.remainingBalance },
    'Payment verified and recorded'
  ).send(res);
}

// PATCH /api/payment-proofs/:id/reject  { note }
async function reject(req, res) {
  const doc = await loadForReview(req);
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  const updated = await PaymentProof.findOneAndUpdate({ _id: doc._id, status: 'pending' }, { $set: reviewSet(req, 'rejected', note) }, { new: true });
  if (!updated) throw ApiError.conflict('This proof was already reviewed.');
  new ApiResponse(200, { proof: toRow(updated) }, 'Payment proof rejected').send(res);
}

// DELETE /api/payment-proofs/:id — a farmer takes back a proof that is still waiting
async function withdraw(req, res) {
  const doc = await PaymentProof.findOneAndDelete({ _id: req.params.id, farmer: req.user._id, status: 'pending' });
  if (!doc) {
    const existing = await PaymentProof.findOne({ _id: req.params.id, farmer: req.user._id });
    if (existing) throw ApiError.conflict(`This proof was already ${existing.status}, so it can't be taken back.`);
    throw ApiError.notFound('Payment proof not found');
  }
  await storage.destroy(doc.file.publicId);
  try {
    await Notification.deleteMany({ paymentProof: doc._id }); // the staff alert for it is no longer true
  } catch (err) {
    console.error('Could not remove the alerts for a withdrawn proof:', err.message);
  }
  new ApiResponse(200, null, 'Payment proof withdrawn').send(res);
}

module.exports = { submit, listMine, listForCooperative, link, verify, reject, withdraw, MAX_PENDING_PER_LOAN };