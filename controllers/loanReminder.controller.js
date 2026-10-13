const Loan = require('../models/Loan');
const LoanPayment = require('../models/LoanPayment');
const LoanReminder = require('../models/LoanReminder');
const Notification = require('../models/Notification');
const CooperativeMember = require('../models/CooperativeMember');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { assertCooperativeStaffOrAdmin } = require('../utils/cooperativeMembership');
const { round2, totalPayable } = require('../utils/loanBalance');
const { sendReminderEmail } = require('../utils/mailer');

// Two reminders about the same loan can't go out within this window —
// protects a borrower from a double-click, and the shared Gmail account
// from a daily sending limit being burned through by repeats.
const COOLDOWN_MS = 5 * 60 * 1000;

const TYPE_LABEL = {
  overdue_notice: 'Overdue notice',
  upcoming_payment: 'Upcoming payment reminder',
  payment_followup: 'Payment follow-up',
  final_overdue_notice: 'Final overdue notice',
};

const APP_TIMEZONE = 'Asia/Manila';
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE }).format(new Date(d)); // YYYY-MM-DD

// Whole calendar days past the due date, as the calendar reads in the
// Philippines: positive = overdue, 0 = due today, negative = still ahead.
function daysPastDue(dueDate, now = new Date()) {
  return Math.round((Date.parse(dayKey(now)) - Date.parse(dayKey(dueDate))) / 86400000);
}

// POST /api/loan-reminders
// Only the LENDING cooperative's owner or finance_manager (or an admin) can
// send one. Everything factual in the email — who it goes to, what's owed,
// when it was due — is read from the loan on the server. The request only
// chooses WHICH loan, WHAT kind of reminder, and the personal message; a
// client can't point the email at a different address or change the
// numbers by adding extra fields.
async function createLoanReminder(req, res) {
  const { loan: loanId, type, message } = req.body;

  const loan = await Loan.findById(loanId)
    .populate('farmer', 'firstName lastName email')
    .populate('cooperative', 'name contactEmail contactPhone');
  if (!loan) throw ApiError.notFound('Loan not found');
  if (!loan.cooperative) throw ApiError.notFound('This loan\'s cooperative could not be found');

  await assertCooperativeStaffOrAdmin(loan.cooperative._id, req.user);

  if (!['active', 'defaulted'].includes(loan.status)) {
    throw ApiError.badRequest(`Reminders can only be sent for active loans (this loan is ${loan.status})`);
  }
  if (!loan.farmer?.email) throw ApiError.badRequest('This borrower has no email address on file');

  const sums = await LoanPayment.aggregate([
    { $match: { loan: loan._id } },
    { $group: { _id: null, paid: { $sum: '$amount' } } },
  ]);
  const remaining = round2(Math.max(0, totalPayable(loan) - round2(sums[0]?.paid || 0)));
  if (remaining <= 0) throw ApiError.badRequest('This loan has nothing left to pay');

  // A reminder counts as "just sent" if the email went out OR the borrower
  // already got the in-app notification (so a retry after a failed email does
  // not drop a second notification into their bell).
  const recent = await LoanReminder.findOne({
    loan: loan._id,
    $or: [{ status: 'sent' }, { inApp: true }],
    createdAt: { $gt: new Date(Date.now() - COOLDOWN_MS) },
  });
  if (recent) {
    throw ApiError.conflict('A reminder for this loan was just sent — please wait a few minutes before sending another');
  }

  const loanRef = `#${String(loan._id).slice(-6).toUpperCase()}`;
  const pastDue = loan.dueDate ? daysPastDue(loan.dueDate) : 0;
  const dueNote = !loan.dueDate
    ? ''
    : pastDue > 0
      ? `${pastDue} day${pastDue === 1 ? '' : 's'} overdue`
      : pastDue === 0
        ? 'due today'
        : `due in ${-pastDue} day${pastDue === -1 ? '' : 's'}`;

  // The borrower's bell and Alerts page. Only the borrower on this loan gets
  // it. If saving it fails the email still goes out (and the list shows that
  // the in-app notification did not happen).
  let inApp = false;
  try {
    await Notification.create({
      user: loan.farmer._id,
      kind: 'payment_reminder',
      title: `${TYPE_LABEL[type]} from ${loan.cooperative.name}`,
      message,
      details: {
        coopName: loan.cooperative.name,
        typeLabel: TYPE_LABEL[type],
        loanRef,
        remaining,
        dueDate: loan.dueDate || undefined,
        dueNote: dueNote || undefined,
        contactEmail: loan.cooperative.contactEmail || undefined,
        contactPhone: loan.cooperative.contactPhone || undefined,
      },
      loan: loan._id,
      cooperative: loan.cooperative._id,
    });
    inApp = true;
  } catch (err) {
    console.error('Failed to save the in-app reminder notification:', err.message);
  }

  let status = 'sent';
  let failureReason;
  try {
    await sendReminderEmail({
      to: loan.farmer.email,
      firstName: loan.farmer.firstName,
      coopName: loan.cooperative.name,
      coopContactEmail: loan.cooperative.contactEmail,
      coopContactPhone: loan.cooperative.contactPhone,
      typeLabel: TYPE_LABEL[type],
      message,
      loanRef,
      remaining,
      dueDate: loan.dueDate,
      daysPastDue: pastDue,
    });
  } catch (err) {
    // The real reason stays in the server log; staff get a plain statement
    // that it didn't go out, and the attempt is still recorded as failed.
    console.error('Failed to send reminder email:', err.message);
    status = 'failed';
    failureReason = inApp
      ? 'The email could not be sent, but the borrower can see this reminder in their notifications'
      : 'The email could not be sent';
  }

  const reminder = await LoanReminder.create({
    loan: loan._id,
    cooperative: loan.cooperative._id,
    sentBy: req.user._id,
    type,
    channel: 'email',
    inApp,
    message,
    recipientEmail: loan.farmer.email,
    status,
    failureReason,
  });

  new ApiResponse(201, reminder, status === 'sent' ? 'Reminder sent' : 'Reminder email could not be sent').send(res);
}

// GET /api/loan-reminders?cooperative=<id>
// Every reminder that cooperative has sent, newest first. Same viewing rule
// as everywhere else on the cooperative side: any active member, or an admin.
async function getLoanReminders(req, res) {
  const { cooperative: cooperativeId } = req.query;
  const page = req.query.page || 1;
  const limit = req.query.limit || 20;

  if (req.user.role !== 'admin') {
    const membership = await CooperativeMember.findOne({
      cooperative: cooperativeId,
      user: req.user._id,
      status: 'active',
    });
    if (!membership) throw ApiError.forbidden('You do not have access to this resource');
  }

  const filter = { cooperative: cooperativeId };
  const [reminders, total] = await Promise.all([
    LoanReminder.find(filter)
      .populate({ path: 'loan', select: 'farmer', populate: { path: 'farmer', select: 'firstName lastName' } })
      .populate('sentBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    LoanReminder.countDocuments(filter),
  ]);

  new ApiResponse(200, reminders, 'Reminders retrieved successfully', {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }).send(res);
}

module.exports = { createLoanReminder, getLoanReminders, daysPastDue };