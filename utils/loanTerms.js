// What a loan costs and when it is due is decided here, by the server, from
// two choices the farmer makes: which crop the money is for, and what they put
// up as collateral. The farmer never types a rate or a number of months, and
// anything of that kind sent by a browser is ignored.
//
// - The crop sets the repayment period: its growing time (the longest day count
//   in its range, so nobody is asked to pay before the crop is ready) plus a
//   short grace period after harvest.
// - The collateral sets the interest: one flat percentage of the amount
//   borrowed for the whole crop cycle (not per year, and it does not compound).
//   Safer collateral costs less.

const GRACE_DAYS = 2; // payment becomes due this many days after the growing period ends

const CROPS = {
  leafy_greens: { label: 'Leafy Greens', examples: 'Kangkong, Pechay', minDays: 20, maxDays: 30 },
  fast_vegetables: { label: 'Fast Vegetables', examples: 'Okra, Sweet Corn', minDays: 60, maxDays: 75 },
  fruit_vegetables: { label: 'Fruit Vegetables', examples: 'Ampalaya, Talong', minDays: 60, maxDays: 90 },
  rice: { label: 'Rice', examples: '', minDays: 115, maxDays: 120 },
  yellow_corn: { label: 'Yellow Corn', examples: '', minDays: 115, maxDays: 130 },
};

// Rates sit in the middle of the cooperative's ranges: 3-4% for machinery
// and land, 6-8% for livestock and other assets.
const COLLATERAL = {
  land_ownership: { label: 'Land ownership', ratePercent: 3.5, risk: 'low' },
  equipment_machinery: { label: 'Farm equipment / machinery', ratePercent: 3.5, risk: 'low' },
  livestock: { label: 'Livestock', ratePercent: 7, risk: 'medium' },
  other_asset: { label: 'Other agricultural asset', ratePercent: 7, risk: 'medium' },
};

const CROP_KEYS = Object.keys(CROPS);
const COLLATERAL_KEYS = Object.keys(COLLATERAL);

const growingDaysFor = (crop) => (CROPS[crop] ? CROPS[crop].maxDays : null);
const rateFor = (collateralKind) => (COLLATERAL[collateralKind] ? COLLATERAL[collateralKind].ratePercent : null);

// The loan model also keeps a whole number of months, for screens that predate crops.
const termMonthsFor = (days) => Math.max(1, Math.round(days / 30));

// From the day the loan is approved: the growing time, then the grace days.
function dueDateFor(from, growingDays) {
  return new Date(new Date(from).getTime() + (growingDays + GRACE_DAYS) * 86400000);
}

// What the Request a Loan form shows the farmer before they submit.
function options() {
  return {
    crops: CROP_KEYS.map((key) => ({ key, ...CROPS[key], growingDays: CROPS[key].maxDays })),
    collateral: COLLATERAL_KEYS.map((key) => ({ key, ...COLLATERAL[key] })),
    graceDays: GRACE_DAYS,
  };
}

module.exports = {
  GRACE_DAYS, CROPS, COLLATERAL, CROP_KEYS, COLLATERAL_KEYS,
  growingDaysFor, rateFor, termMonthsFor, dueDateFor, options,
};