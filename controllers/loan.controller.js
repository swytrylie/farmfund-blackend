const Loan = require('../models/Loan');
const LoanPayment = require('../models/LoanPayment');
const Cooperative = require('../models/Cooperative');
const CooperativeMember = require('../models/CooperativeMember');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { assertCooperativeStaffOrAdmin } = require('../utils/cooperativeMembership');
const { round2, totalPayable, addMonths } = require('../utils/loanBalance');
const { creditFor } = require('../utils/creditLimit');
const storage = require('../utils/cloudinary');
const { sniff } = require('../utils/fileSniff');
const { CROPS, COLLATERAL, growingDaysFor, rateFor, termMonthsFor, dueDateFor, options } = require('../utils/loanTerms');

// Loan is owned DIRECTLY by farmer (unlike Budget/FinancialRecord, which
// are owned indirectly through Farm) — so this checks loan.farmer, not a
// parent Farm's owner. Two separate parties can legitimately VIEW one
// loan: the farmer who borrowed it, or any active member of the
// cooperative that lent it. This is deliberately broader than
// assertCooperativeStaffOrAdmin (which stays reserved for approving,
// rejecting, and recording payments — owner/finance_manager only) —
// viewing a loan your own cooperative made isn't a sensitive decision the
// way those are, so a plain member can see it too, consistent with
// getLoans using the same broader rule for the list.
async function assertCanViewLoan(loan, user) {
  if (user.role === 'admin') return;
  if (String(loan.farmer?._id || loan.farmer) === String(user._id)) return;

  const membership = await CooperativeMember.findOne({
    cooperative: loan.cooperative?._id || loan.cooperative,
    user: user._id,
    status: 'active',
  });
  if (!membership) throw ApiError.forbidden('You do not have access to this resource');
}

// What leaves the server about a loan's collateral: what it is and a note about
// the proof file, never the file's storage reference.
function publicCollateral(c) {
  if (!c || !c.kind) return null;
  const f = c.file || {};
  return {
    kind: c.kind,
    label: COLLATERAL[c.kind] ? COLLATERAL[c.kind].label : c.kind,
    description: c.description || null,
    hasFile: Boolean(f.format),
    fileName: f.originalName || null,
    fileType: f.format || null,
    bytes: typeof f.bytes === 'number' ? f.bytes : null,
  };
}

// Adds totalPayable / amountPaid / remainingBalance to plain loan objects,
// using ONE aggregate over the payments of every loan in the batch rather
// than a query per loan. Computed here, on the server, so every page that
// shows a loan (borrower, farmer, analytics, overdue…) agrees on the same
// numbers instead of each re-deriving them its own way.
async function attachBalances(loans) {
  if (loans.length === 0) return loans;

  const sums = await LoanPayment.aggregate([
    { $match: { loan: { $in: loans.map((l) => l._id) } } },
    { $group: { _id: '$loan', paid: { $sum: '$amount' } } },
  ]);
  const paidByLoan = new Map(sums.map((s) => [String(s._id), s.paid]));

  return loans.map((l) => {
    const payable = totalPayable(l);
    const paid = round2(paidByLoan.get(String(l._id)) || 0);
    return {
      ...l,
      rateBasis: l.rateBasis || 'annual',
      cropLabel: l.crop && CROPS[l.crop] ? CROPS[l.crop].label : null,
      collateral: publicCollateral(l.collateral),
      totalPayable: payable,
      amountPaid: paid,
      remainingBalance: round2(Math.max(0, payable - paid)),
    };
  });
}

// One loan, fully populated and with balances — used by every endpoint
// that returns a single loan so none of them can hand back a bare
// document (raw ids instead of names) the way updateLoanStatus used to.
async function loadSerializedLoan(id) {
  const loan = await Loan.findById(id)
    .populate('cooperative', 'name')
    .populate('farmer', 'firstName lastName email')
    .lean();
  if (!loan) return null;
  const [withBalances] = await attachBalances([loan]);
  return withBalances;
}

// POST /api/loans
// A farmer REQUESTS a loan — this does not create an active loan. status is
// ALWAYS forced to 'pending' here, ignoring anything sent in the request
// body, so a farmer can never grant themselves an approved/active loan by
// simply including "status": "active" in their request. Only a
// cooperative's staff or an admin (via updateLoanStatus below) can move a
// loan past pending.
const formatPeso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

async function createLoan(req, res) {
  const { cooperative, principalAmount, crop, collateralType, collateralDescription } = req.body;

  // The proof of the collateral is required, and must really be a PDF, JPG or PNG.
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    throw ApiError.badRequest('Upload a photo or PDF as proof of your collateral');
  }
  const kind = sniff(req.file.buffer);
  if (!kind) throw ApiError.badRequest('Only PDF, JPG or PNG files can be uploaded');

  const coopDoc = await Cooperative.findById(cooperative);
  if (!coopDoc || coopDoc.status !== 'active') {
    throw ApiError.badRequest('Invalid or inactive cooperative');
  }

  // A farmer can only borrow up to their credit limit, which comes from a
  // verified Barangay Certificate (PHP 0 until one is verified).
  const before = await creditFor(req.user._id);
  if (before.limit <= 0) {
    throw ApiError.forbidden(
      before.barangayStatus === 'pending'
        ? 'Your Barangay Certificate is still waiting to be verified. You can request a loan once it is verified.'
        : 'You can request a loan after your Barangay Certificate is verified. Upload it in your farm profile under Certificates.'
    );
  }
  if (principalAmount > before.available + 0.001) {
    throw ApiError.badRequest(
      before.available > 0
        ? `That is more than your available credit. You can borrow up to ${formatPeso(before.available)} right now.`
        : `You have no credit left. Your limit of ${formatPeso(before.limit)} is fully used by your other loans.`
    );
  }

  if (!storage.isConfigured()) throw new ApiError(503, 'File storage is not set up yet. Please try again later.');
  let stored;
  try {
    stored = await storage.uploadBuffer(req.file.buffer, storage.COLLATERAL_FOLDER);
  } catch (err) {
    console.error('Collateral upload to Cloudinary failed:', err && err.message);
    throw new ApiError(502, 'The file could not be stored. Please try again.');
  }

  // The rate and the repayment period come from the crop and the collateral
  // chosen above, never from anything else the browser sent.
  const growingDays = growingDaysFor(crop);
  const rawName = typeof req.file.originalname === 'string' ? req.file.originalname : '';
  let loan;
  try {
    loan = await Loan.create({
      farmer: req.user._id, // always the logged-in user — never trust a client-supplied farmer id
      cooperative,
      principalAmount,
      interestRatePercent: rateFor(collateralType),
      rateBasis: 'cycle',
      termMonths: termMonthsFor(growingDays),
      crop,
      growingDays,
      collateral: {
        kind: collateralType,
        description: collateralDescription,
        file: {
          publicId: stored.publicId,
          format: kind.ext, // what the file really is
          bytes: req.file.buffer.length,
          originalName: rawName.replace(/[<>\r\n]/g, '').slice(0, 200) || undefined,
        },
      },
      status: 'pending', // forced, regardless of what the client sent
    });
  } catch (err) {
    await storage.destroy(stored.publicId); // do not leave a file nobody points to
    throw err;
  }

  // Two requests sent at the same moment could both pass the check above.
  // Look again now that this one exists, and take it back if the farmer went over.
  const after = await creditFor(req.user._id);
  if (after.used > after.limit + 0.001) {
    await Loan.deleteOne({ _id: loan._id });
    await storage.destroy(stored.publicId);
    throw ApiError.badRequest('You have another loan request in progress. Please check your available credit and try again.');
  }

  new ApiResponse(201, await loadSerializedLoan(loan._id), 'Loan request submitted successfully').send(res);
}

// GET /api/loans/options — the crops (with growing times) and collateral types
// (with their rates) the Request a Loan form offers.
async function loanOptions(req, res) {
  new ApiResponse(200, options(), 'Loan options fetched').send(res);
}

// GET /api/loans/:id/collateral/link — a link that opens the collateral proof
// for a few minutes. Only the farmer who borrowed, the lending cooperative's
// owner or finance manager, or an admin. Anyone else gets the same answer as
// for a loan that does not exist.
async function collateralLink(req, res) {
  const loan = await Loan.findById(req.params.id).select('+collateral.file.publicId').lean();
  let allowed = false;
  if (loan && loan.collateral && loan.collateral.file && loan.collateral.file.publicId) {
    if (req.user.role === 'admin' || String(loan.farmer) === String(req.user._id)) allowed = true;
    else {
      const staff = await CooperativeMember.findOne({
        cooperative: loan.cooperative,
        user: req.user._id,
        role: { $in: ['owner', 'finance_manager'] },
        status: 'active',
      });
      allowed = Boolean(staff);
    }
  }
  if (!allowed) throw ApiError.notFound('Collateral proof not found');
  if (!storage.isConfigured()) throw new ApiError(503, 'File storage is not set up yet. Please try again later.');

  let url;
  try {
    url = storage.signedLink(loan.collateral.file.publicId, loan.collateral.file.format);
  } catch (err) {
    console.error('Could not build collateral link:', err && err.message);
    throw new ApiError(502, 'The file could not be opened. Please try again.');
  }
  new ApiResponse(200, { url, expiresInSeconds: storage.LINK_SECONDS, fileType: loan.collateral.file.format }, 'Link ready').send(res);
}

// GET /api/loans  (regular users see only their own; admins see everyone's)
async function getLoans(req, res) {
  const page = req.query.page || 1;
  const limit = req.query.limit || 20;
  const { status } = req.query;

  const filter = {};
  if (req.user.role !== 'admin') {
    // A cooperative's own staff (owner/finance_manager/member) aren't
    // farmers borrowing money — they're the lender's side, reviewing
    // loans made TO their cooperative. Scoping by `farmer` here would
    // always return zero results for them, since they never borrow from
    // themselves. Any active membership routes to the cooperative's full
    // loan book instead; someone with no membership at all is scoped to
    // only their own loans.
    const membership = await CooperativeMember.findOne({ user: req.user._id, status: 'active' });
    if (membership) {
      filter.cooperative = membership.cooperative;
    } else {
      filter.farmer = req.user._id;
    }
  }
  if (status) filter.status = status;

  const [loans, total] = await Promise.all([
    Loan.find(filter)
      .populate('cooperative', 'name')
      .populate('farmer', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Loan.countDocuments(filter),
  ]);

  new ApiResponse(200, await attachBalances(loans), 'Loans retrieved successfully', {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }).send(res);
}

// GET /api/loans/:id  (includes this loan's payments, newest first)
async function getLoanById(req, res) {
  const loan = await loadSerializedLoan(req.params.id);
  if (!loan) throw ApiError.notFound('Loan not found');

  await assertCanViewLoan(loan, req.user);

  const payments = await LoanPayment.find({ loan: loan._id }).sort({ paymentDate: -1 }).lean();

  new ApiResponse(200, { ...loan, payments }).send(res);
}

// PATCH /api/loans/:id/status
// Only that SPECIFIC loan's cooperative staff (owner or finance_manager)
// can approve/reject it — checked against loan.cooperative, not just "is
// this person staff somewhere." A platform admin can still act on any loan,
// for support/oversight. The farmer who requested it has no update
// endpoint for their own loan at all, regardless of role.
async function updateLoanStatus(req, res) {
  const loan = await Loan.findById(req.params.id);
  if (!loan) throw ApiError.notFound('Loan not found');

  await assertCooperativeStaffOrAdmin(loan.cooperative, req.user);

  // paid_off now means "the balance genuinely reached zero", which only
  // recorded payments can establish — not something to set by hand, or a
  // loan could be marked repaid with money still owed and every total
  // built on it would be wrong. A paid-off loan is also final: reopening
  // it would break the payment history it was closed on.
  if (req.body.status === 'paid_off') {
    throw ApiError.badRequest('A loan is marked paid off automatically when its balance reaches zero — record the payment instead');
  }
  if (loan.status === 'paid_off') {
    throw ApiError.badRequest('This loan is already fully paid off and can no longer be changed');
  }

  loan.status = req.body.status;
  if (req.body.status === 'approved' || req.body.status === 'active') {
    if (!loan.issuedDate) loan.issuedDate = new Date();
    if (req.body.dueDate) loan.dueDate = req.body.dueDate;
    // A loan for a crop falls due when the crop has grown (plus the grace
    // days), counted from the day it is approved, so the date is set then.
    if (!loan.dueDate && loan.growingDays) loan.dueDate = dueDateFor(loan.issuedDate, loan.growingDays);
  }
  // The loan matures one term after it's actually disbursed. Without this,
  // a loan activated from the UI (which only sends a status) would never
  // get a due date at all, and nothing that depends on one — overdue
  // tracking, reminders, alerts — could ever work for it.
  if (req.body.status === 'active' && !loan.dueDate) {
    loan.dueDate = addMonths(new Date(), loan.termMonths);
  }

  await loan.save();

  new ApiResponse(200, await loadSerializedLoan(loan._id), 'Loan status updated successfully').send(res);
}

module.exports = { createLoan, getLoans, getLoanById, updateLoanStatus, loanOptions, collateralLink };