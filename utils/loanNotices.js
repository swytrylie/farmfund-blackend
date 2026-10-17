const User = require('../models/User');
const CooperativeMember = require('../models/CooperativeMember');
const Notification = require('../models/Notification');
const { CROPS, COLLATERAL } = require('./loanTerms');
const { sendLoanVerifiedEmail, sendLoanRejectedEmail, sendLoanRequestEmail } = require('./mailer');

/**
 * Loan notices
 * ------------
 * Every message about a loan request goes through here: a bell item saved for
 * the person and, where it makes sense, an email. Each part is separate and
 * none of them can throw — the review or the request is already saved by the
 * time these run, and a down email service must never undo it.
 */
const STAFF_ROLES = ['owner', 'finance_manager'];
const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ') || 'Unknown';
const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const appUrl = () => (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/+$/, '') : '');

async function save(doc) {
  try {
    await Notification.create(doc);
  } catch (err) {
    console.error('Could not save a loan notification:', err && err.message);
  }
}

// To every active admin: a farmer's request needs its collateral checked.
async function tellAdminsNewRequest(loan, farmer) {
  try {
    const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
    const name = fullName(farmer);
    await Promise.all(
      admins.map((a) =>
        save({
          user: a._id,
          kind: 'loan_submitted',
          title: 'Loan collateral to verify',
          message: `${name} requested ${peso(loan.principalAmount)} and sent collateral proof to verify.`.slice(0, 200),
          details: { farmerName: name.slice(0, 200), amount: loan.principalAmount },
          loan: loan._id,
          cooperative: loan.cooperative,
        })
      )
    );
  } catch (err) {
    console.error('Could not tell the admins about a loan request:', err && err.message);
  }
}

// To the farmer: the admin verified the collateral and it went to the cooperative.
async function tellFarmerVerified(loan, farmer, coop) {
  const coopName = (coop && coop.name) || 'your cooperative';
  await save({
    user: loan.farmer,
    kind: 'loan_update',
    title: 'Collateral verified',
    message: `Your ${peso(loan.principalAmount)} loan request was verified and sent to ${coopName}.`.slice(0, 200),
    details: { coopName: coopName.slice(0, 200), typeLabel: 'Collateral verified', amount: loan.principalAmount },
    loan: loan._id,
    cooperative: loan.cooperative,
  });
  if (!farmer || !farmer.email) return;
  try {
    await sendLoanVerifiedEmail({ to: farmer.email, firstName: farmer.firstName, coopName, amount: loan.principalAmount, appUrl: appUrl() });
  } catch (err) {
    console.error('Could not send the loan verified email:', err && err.message);
  }
}

// To the farmer: the admin could not verify the collateral; it never reached the cooperative.
async function tellFarmerRejected(loan, farmer, reason) {
  await save({
    user: loan.farmer,
    kind: 'loan_update',
    title: 'Loan request not verified',
    message: `Your ${peso(loan.principalAmount)} loan request was not verified: ${reason || 'no reason given'}`.slice(0, 200),
    details: { typeLabel: 'Not verified', amount: loan.principalAmount, reason: reason ? String(reason).slice(0, 300) : undefined },
    loan: loan._id,
    cooperative: loan.cooperative,
  });
  if (!farmer || !farmer.email) return;
  try {
    await sendLoanRejectedEmail({ to: farmer.email, firstName: farmer.firstName, amount: loan.principalAmount, reason, appUrl: appUrl() });
  } catch (err) {
    console.error('Could not send the loan rejected email:', err && err.message);
  }
}

// To the cooperative's owner and finance managers: a verified request arrived.
async function tellCoopStaffRequest(loan, farmer, coop) {
  let staff = [];
  try {
    const members = await CooperativeMember.find({ cooperative: loan.cooperative, role: { $in: STAFF_ROLES }, status: 'active' }).select('user').lean();
    if (members.length) staff = await User.find({ _id: { $in: members.map((m) => m.user) } }).select('firstName lastName email').lean();
  } catch (err) {
    console.error('Could not look up who to tell about a loan request:', err && err.message);
    return;
  }
  const farmerName = fullName(farmer);
  const coopName = (coop && coop.name) || 'your cooperative';
  const cropLabel = loan.crop && CROPS[loan.crop] ? CROPS[loan.crop].label : null;
  const collateralLabel = loan.collateral && loan.collateral.kind && COLLATERAL[loan.collateral.kind] ? COLLATERAL[loan.collateral.kind].label : null;
  await Promise.all(
    staff.map(async (person) => {
      await save({
        user: person._id,
        kind: 'loan_alert',
        title: 'New loan request',
        message: `${farmerName} asked for ${peso(loan.principalAmount)}${cropLabel ? ` for ${cropLabel}` : ''}. The collateral is verified.`.slice(0, 200),
        details: { coopName: coopName.slice(0, 200), typeLabel: 'Loan request', farmerName: farmerName.slice(0, 200), amount: loan.principalAmount },
        loan: loan._id,
        cooperative: loan.cooperative,
      });
      if (!person.email) return;
      try {
        await sendLoanRequestEmail({ to: person.email, firstName: person.firstName, coopName, farmerName, amount: loan.principalAmount, cropLabel, collateralLabel, appUrl: appUrl() });
      } catch (err) {
        console.error('Could not send the loan request email:', err && err.message);
      }
    })
  );
}

module.exports = { tellAdminsNewRequest, tellFarmerVerified, tellFarmerRejected, tellCoopStaffRequest, fullName, peso };