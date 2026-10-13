const CooperativeMember = require('../models/CooperativeMember');
const Cooperative = require('../models/Cooperative');
const Loan = require('../models/Loan');

/**
 * Who may see a farmer's certificates?
 *   'self'        - the farmer
 *   'admin'       - any platform admin
 *   'cooperative' - the owner or a finance manager of an active cooperative
 *                   that has a loan (even a pending application) with this farmer
 *   null          - nobody else
 */
async function accessFor(user, farmerId) {
  if (!user) return null;
  if (String(user._id) === String(farmerId)) return 'self';
  if (user.role === 'admin') return 'admin';

  const staff = await CooperativeMember.find({
    user: user._id,
    role: { $in: ['owner', 'finance_manager'] },
    status: 'active',
  })
    .select('cooperative')
    .lean();
  if (!staff.length) return null;

  const coops = await Cooperative.find({ _id: { $in: staff.map((s) => s.cooperative) }, status: 'active' })
    .select('_id')
    .lean();
  if (!coops.length) return null;

  const loan = await Loan.exists({ farmer: farmerId, cooperative: { $in: coops.map((c) => c._id) } });
  return loan ? 'cooperative' : null;
}

module.exports = { accessFor };