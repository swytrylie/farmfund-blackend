// Shared money/date math for loans, so every controller (and the one-off
// backfill script) agrees on exactly what a loan owes and when it's due.

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// The model has no installment schedule. Loans requested with a crop carry one
// flat rate for the whole crop cycle (rateBasis 'cycle'), so they owe
// principal × (1 + rate). Older loans carry an annual rate and a term, so
// the amount owed is simple interest over the whole term:
// principal × (1 + annual rate × months / 12).
function totalPayable(loan) {
  if (loan.rateBasis === 'cycle') {
    return round2(loan.principalAmount + loan.principalAmount * (loan.interestRatePercent / 100));
  }
  const interest = loan.principalAmount * (loan.interestRatePercent / 100) * (loan.termMonths / 12);
  return round2(loan.principalAmount + interest);
}

// Adds whole months, clamping to the last day of the target month rather
// than overflowing — plain setMonth() turns Jan 31 + 1 month into March 3.
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDayOfTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDayOfTargetMonth));
  return d;
}

module.exports = { round2, totalPayable, addMonths };