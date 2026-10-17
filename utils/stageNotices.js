const User = require('../models/User');
const CooperativeMember = require('../models/CooperativeMember');
const Notification = require('../models/Notification');
const { CROPS, CALAMITIES, GRACE_DAYS, FREEZE_DAYS } = require('./loanTerms');
const mailer = require('./mailer');

/**
 * Stage notices
 * -------------
 * Every message about a loan's grace period and about disaster relief goes
 * through here: a bell item saved for the person and, where it makes sense, an
 * email. Each part is separate and none of them can throw: the thing they report
 * is already saved by the time these run, and a down email service must never
 * undo it.
 */
const STAFF_ROLES = ['owner', 'finance_manager'];
const fullName = (u) => [u && u.firstName, u && u.lastName].filter(Boolean).join(' ') || 'Unknown';
const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const day = (d) => new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
const appUrl = () => (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/+$/, '') : '');
const cropLabelOf = (loan) => (loan.crop && CROPS[loan.crop] ? CROPS[loan.crop].label : null);
const calamityLabelOf = (claim) => CALAMITIES[claim.calamity] || 'Calamity';

async function save(doc) {
  try {
    await Notification.create(doc);
  } catch (err) {
    console.error('Could not save a notification:', err && err.message);
  }
}

async function send(name, args) {
  try {
    await mailer[name](args);
  } catch (err) {
    console.error(`Could not send the ${name} email:`, err && err.message);
  }
}

// The cooperative's owner and finance managers (active), with their name and email.
async function staffOf(cooperativeId) {
  try {
    const members = await CooperativeMember.find({ cooperative: cooperativeId, role: { $in: STAFF_ROLES }, status: 'active' }).select('user role').lean();
    if (!members.length) return [];
    const users = await User.find({ _id: { $in: members.map((m) => m.user) } }).select('firstName lastName email').lean();
    const roleOf = new Map(members.map((m) => [String(m.user), m.role]));
    return users.map((u) => ({ ...u, memberRole: roleOf.get(String(u._id)) }));
  } catch (err) {
    console.error('Could not look up who to tell:', err && err.message);
    return [];
  }
}

// ---- grace period ----

// To the farmer: the crop is ready to harvest; the grace period has started.
async function tellFarmerGrace(loan, farmer, coop, { remaining, dueDate }) {
  const coopName = (coop && coop.name) || 'your cooperative';
  const crop = cropLabelOf(loan);
  await save({
    user: loan.farmer,
    kind: 'loan_update',
    title: 'Grace period started',
    message: `${crop ? `Your ${crop} is` : 'Your crop is'} ready to harvest. You have until ${day(dueDate)} to pay, with no extra interest.`.slice(0, 200),
    details: { coopName: coopName.slice(0, 200), typeLabel: 'Grace period', amount: remaining, dueDate, dueNote: `${GRACE_DAYS}-day grace period` },
    loan: loan._id,
    cooperative: loan.cooperative,
  });
  if (!farmer || !farmer.email) return;
  await send('sendGraceStartedEmail', { to: farmer.email, firstName: farmer.firstName, coopName, cropLabel: crop, remaining, dueDate, graceDays: GRACE_DAYS, appUrl: appUrl() });
}

// ---- disaster relief ----

// To every active admin: a farmer asked for disaster relief.
async function tellAdminsClaim(claim, loan, farmer) {
  try {
    const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
    const name = fullName(farmer);
    await Promise.all(
      admins.map((a) =>
        save({
          user: a._id,
          kind: 'claim_submitted',
          title: 'Disaster relief claim to verify',
          message: `${name} reported a ${calamityLabelOf(claim).toLowerCase()} and sent proof to verify.`.slice(0, 200),
          details: { farmerName: name.slice(0, 200), typeLabel: calamityLabelOf(claim), amount: loan.principalAmount },
          loan: loan._id,
          cooperative: loan.cooperative,
          claim: claim._id,
        })
      )
    );
  } catch (err) {
    console.error('Could not tell the admins about a disaster claim:', err && err.message);
  }
}

// To the farmer: the admin verified the proof.
async function tellFarmerClaimVerified(claim, loan, farmer, coop) {
  const coopName = (coop && coop.name) || 'your cooperative';
  await save({
    user: claim.farmer,
    kind: 'loan_update',
    title: 'Disaster relief claim verified',
    message: `Your ${calamityLabelOf(claim).toLowerCase()} claim was verified. ${coopName} can now activate a calamity freeze.`.slice(0, 200),
    details: { coopName: coopName.slice(0, 200), typeLabel: 'Claim verified', amount: loan.principalAmount },
    loan: loan._id,
    cooperative: loan.cooperative,
    claim: claim._id,
  });
  if (!farmer || !farmer.email) return;
  await send('sendClaimVerifiedEmail', { to: farmer.email, firstName: farmer.firstName, calamityLabel: calamityLabelOf(claim), coopName, appUrl: appUrl() });
}

// To the farmer: the admin could not verify the proof.
async function tellFarmerClaimRejected(claim, loan, farmer, reason) {
  await save({
    user: claim.farmer,
    kind: 'loan_update',
    title: 'Disaster relief claim not verified',
    message: `Your ${calamityLabelOf(claim).toLowerCase()} claim was not verified: ${reason || 'no reason given'}`.slice(0, 200),
    details: { typeLabel: 'Claim not verified', amount: loan.principalAmount, reason: reason ? String(reason).slice(0, 300) : undefined },
    loan: loan._id,
    cooperative: loan.cooperative,
    claim: claim._id,
  });
  if (!farmer || !farmer.email) return;
  await send('sendClaimRejectedEmail', { to: farmer.email, firstName: farmer.firstName, calamityLabel: calamityLabelOf(claim), reason, appUrl: appUrl() });
}

// To the cooperative's owner and finance managers: a borrower's claim was verified.
async function tellCoopStaffClaim(claim, loan, farmer, coop) {
  const staff = await staffOf(loan.cooperative);
  const farmerName = fullName(farmer);
  const coopName = (coop && coop.name) || 'your cooperative';
  await Promise.all(
    staff.map(async (person) => {
      const canFreeze = person.memberRole === 'owner';
      await save({
        user: person._id,
        kind: 'loan_alert',
        title: 'Disaster relief claim verified',
        message: `${farmerName}'s ${calamityLabelOf(claim).toLowerCase()} claim was verified by an admin.${canFreeze ? ' You can activate a calamity freeze.' : ''}`.slice(0, 200),
        details: { coopName: coopName.slice(0, 200), typeLabel: 'Disaster relief', farmerName: farmerName.slice(0, 200), amount: loan.principalAmount },
        loan: loan._id,
        cooperative: loan.cooperative,
        claim: claim._id,
      });
      if (!person.email) return;
      await send('sendClaimCoopEmail', { to: person.email, firstName: person.firstName, coopName, farmerName, calamityLabel: calamityLabelOf(claim), canFreeze, appUrl: appUrl() });
    })
  );
}

// To the farmer: the owner activated the calamity freeze.
async function tellFarmerFreezeStarted(claim, loan, farmer, coop, { endsAt, newDueDate }) {
  const coopName = (coop && coop.name) || 'your cooperative';
  await save({
    user: claim.farmer,
    kind: 'loan_update',
    title: 'Calamity freeze activated',
    message: `No new interest for ${FREEZE_DAYS} days. Your new due date is ${day(newDueDate)}.`.slice(0, 200),
    details: { coopName: coopName.slice(0, 200), typeLabel: 'Calamity freeze', amount: loan.principalAmount, dueDate: newDueDate, dueNote: `Freeze ends ${day(endsAt)}` },
    loan: loan._id,
    cooperative: loan.cooperative,
    claim: claim._id,
  });
  if (!farmer || !farmer.email) return;
  await send('sendFreezeStartedEmail', { to: farmer.email, firstName: farmer.firstName, coopName, endsAt, newDueDate, freezeDays: FREEZE_DAYS, appUrl: appUrl() });
}

// To the farmer: the freeze period is over.
async function tellFarmerFreezeEnded(claim, loan, farmer, coop) {
  const coopName = (coop && coop.name) || 'your cooperative';
  await save({
    user: claim.farmer,
    kind: 'loan_update',
    title: 'Calamity freeze ended',
    message: `Your calamity freeze has ended. Your loan is due on ${day(loan.dueDate)}.`.slice(0, 200),
    details: { coopName: coopName.slice(0, 200), typeLabel: 'Freeze ended', amount: loan.principalAmount, dueDate: loan.dueDate },
    loan: loan._id,
    cooperative: loan.cooperative,
    claim: claim._id,
  });
  if (!farmer || !farmer.email) return;
  await send('sendFreezeEndedEmail', { to: farmer.email, firstName: farmer.firstName, coopName, newDueDate: loan.dueDate, appUrl: appUrl() });
}

module.exports = {
  tellFarmerGrace, tellAdminsClaim, tellFarmerClaimVerified, tellFarmerClaimRejected,
  tellCoopStaffClaim, tellFarmerFreezeStarted, tellFarmerFreezeEnded, fullName, peso,
};
