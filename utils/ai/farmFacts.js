// Everything the AI advisor knows about one farmer, computed from their real
// records (Farm, Field, FarmingCycle, FinancialRecord, Budget, Loan,
// LoanPayment). Plain math only: every peso the farmer sees comes from here,
// never from the AI, which only explains these numbers.
//
// Nothing that identifies the farmer (name, email, phone, exact address,
// coordinates) goes into `facts`, because `facts` is what is sent to Gemini.

const Farm = require('../../models/Farm');
const Field = require('../../models/Field');
const FarmingCycle = require('../../models/FarmingCycle');
const FinancialRecord = require('../../models/FinancialRecord');
const Budget = require('../../models/Budget');
const Loan = require('../../models/Loan');
const LoanPayment = require('../../models/LoanPayment');
const { totalPayable, round2 } = require('../loanBalance');
const { scheduleFor, CROPS: LOAN_CROPS } = require('../loanTerms');
const { findLgu, seasonFor } = require('./pangasinan');
const { getForecast } = require('./weather');
const { recommendCrops, benchmarkFor, normalizeCategory, CATEGORY_LABELS } = require('./cropAdvisor');
const { BENCHMARK_SOURCE } = require('./cropCalendar');

const DAY = 86400000;
const OPEN_LOAN = ['approved', 'active', 'grace_period', 'defaulted'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const round = (n) => (Number.isFinite(n) ? Math.round(n) : null);
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const change = (now, before) => (before ? Math.round(((now - before) / Math.abs(before)) * 1000) / 10 : null);
const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const fmtDay = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

function totals(records) {
  const income = sum(records.filter((r) => r.type === 'income'), (r) => r.amount);
  const expenses = sum(records.filter((r) => r.type === 'expense'), (r) => r.amount);
  return { income: round2(income), expenses: round2(expenses), net: round2(income - expenses), marginPct: pct(income - expenses, income) };
}

function byCategory(records, type) {
  const m = new Map();
  for (const r of records.filter((x) => x.type === type)) {
    const name = r.category?.name || 'Uncategorized';
    m.set(name, (m.get(name) || 0) + r.amount);
  }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()]
    .map(([name, amount]) => ({ name, amount: round2(amount), sharePct: pct(amount, total) }))
    .sort((a, b) => b.amount - a.amount);
}

function cropNameOf(cycle) {
  return cycle.customCropName || cycle.crop?.name || 'Crop';
}

/** Loads the farmer's records and returns { facts, farmFound }. */
async function buildFacts(user, { today = new Date(), fetchImpl } = {}) {
  const farm = await Farm.findOne({ owner: user._id }).lean();
  const gaps = [];
  if (!farm) gaps.push('no_farm_profile');

  const [fields, loans] = await Promise.all([
    farm ? Field.find({ farm: farm._id, isActive: { $ne: false } }).lean() : [],
    Loan.find({ farmer: user._id, status: { $in: [...OPEN_LOAN, 'paid_off'] } }).populate('cooperative', 'name').lean(),
  ]);
  const fieldById = new Map(fields.map((f) => [String(f._id), f]));
  const [cycles, records, budgets, paymentSums] = await Promise.all([
    fields.length
      ? FarmingCycle.find({ field: { $in: fields.map((f) => f._id) } }).populate('crop', 'name category typicalGrowingDays').sort({ startDate: 1 }).lean()
      : [],
    farm
      ? FinancialRecord.find({ farm: farm._id, date: { $gte: new Date(today.getTime() - 400 * DAY) } }).populate('category', 'name type').lean()
      : [],
    farm ? Budget.find({ farm: farm._id }).populate('categories.category', 'name type').sort({ periodStart: -1 }).limit(3).lean() : [],
    loans.length
      ? LoanPayment.aggregate([{ $match: { loan: { $in: loans.map((l) => l._id) } } }, { $group: { _id: '$loan', paid: { $sum: '$amount' } } }])
      : [],
  ]);

  // ---- Location, season, weather
  const lgu = findLgu(String(farm?.location?.address || '').split(',')[0]);
  if (farm && !lgu) gaps.push('farm_location_not_set');
  const weather = lgu ? await getForecast(lgu, fetchImpl ? { fetchImpl } : undefined) : null;

  // ---- Fields
  const areaHa = Number(farm?.totalAreaHectares) || round2(sum(fields, (f) => f.areaHectares)) || null;
  const soilCounts = {};
  for (const f of fields) if (f.soilType) soilCounts[f.soilType.toLowerCase().trim()] = (soilCounts[f.soilType.toLowerCase().trim()] || 0) + (Number(f.areaHectares) || 1);
  const soilType = Object.entries(soilCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  if (!fields.length) gaps.push('no_fields');
  else if (!soilType) gaps.push('no_soil_type');

  // ---- Money: rolling 30-day windows, last 12 months, 6-month trend
  const t = today.getTime();
  const inRange = (from, to) => records.filter((r) => { const d = new Date(r.date).getTime(); return d > from && d <= to; });
  const last30 = inRange(t - 30 * DAY, t);
  const prev30 = inRange(t - 60 * DAY, t - 30 * DAY);
  const last12 = inRange(t - 365 * DAY, t);
  if (!records.length) gaps.push('no_financial_records');

  const now = totals(last30);
  const before = totals(prev30);
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const end = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
    const rows = records.filter((r) => new Date(r.date) >= start && new Date(r.date) < end);
    trend.push({ month: `${MONTHS[start.getMonth()]} ${start.getFullYear()}`, ...totals(rows), partial: i === 0 });
  }

  // ---- Crop cycles (profit per cycle)
  const recordsByCycle = new Map();
  for (const r of records) if (r.farmingCycle) {
    const k = String(r.farmingCycle);
    if (!recordsByCycle.has(k)) recordsByCycle.set(k, []);
    recordsByCycle.get(k).push(r);
  }
  const cycleFacts = cycles.map((c) => {
    const rows = recordsByCycle.get(String(c._id)) || [];
    const field = fieldById.get(String(c.field));
    const tt = totals(rows);
    const yieldKg = Number(c.actualYieldKg) || null;
    const area = Number(field?.areaHectares) || null;
    const bench = benchmarkFor(cropNameOf(c));
    const expenseCats = byCategory(rows, 'expense');
    // Which costs are well above typical for this crop and area (needs a known crop + area)
    const flags = [];
    if (bench && area) {
      const byKey = {};
      for (const e of expenseCats) { const k = normalizeCategory(e.name); byKey[k] = (byKey[k] || 0) + e.amount; }
      for (const [k, amount] of Object.entries(byKey)) {
        const share = bench.costShares[k];
        if (!share) continue;
        const typical = bench.costPerHa * share * area;
        if (amount > typical * 1.15 && amount - typical > 1000) {
          flags.push({ category: CATEGORY_LABELS[k], amount: round(amount), typical: round(typical), overPct: round(((amount - typical) / typical) * 100), possibleSavings: round(amount - typical) });
        }
      }
    }
    return {
      crop: cropNameOf(c),
      field: field?.name || null,
      areaHa: area,
      status: c.status,
      startDate: c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : null,
      endDate: c.endDate ? new Date(c.endDate).toISOString().slice(0, 10) : null,
      ...tt,
      yieldKg,
      yieldPerHa: yieldKg && area ? round(yieldKg / area) : null,
      costPerKg: yieldKg && tt.expenses ? round2(tt.expenses / yieldKg) : null,
      breakEvenPricePerKg: yieldKg && tt.expenses ? round2(tt.expenses / yieldKg) : null,
      expensesByCategory: expenseCats,
      costsAboveTypical: flags,
      typicalCostPerHa: bench ? bench.costPerHa : null,
    };
  });
  const unlinked = records.filter((r) => !r.farmingCycle).length;
  if (records.length && unlinked / records.length > 0.5) gaps.push('records_not_linked_to_cycles');

  // Profitability per crop (finished cycles that have income)
  const perCrop = new Map();
  for (const c of cycleFacts.filter((x) => x.income > 0)) {
    const p = perCrop.get(c.crop) || { crop: c.crop, income: 0, expenses: 0, areaHa: 0, cycles: 0 };
    p.income += c.income; p.expenses += c.expenses; p.areaHa += c.areaHa || 0; p.cycles += 1;
    perCrop.set(c.crop, p);
  }
  const cropProfitability = [...perCrop.values()]
    .map((p) => ({ ...p, net: round2(p.income - p.expenses), marginPct: pct(p.income - p.expenses, p.income), profitPerHa: p.areaHa ? round((p.income - p.expenses) / p.areaHa) : null }))
    .sort((a, b) => (b.marginPct ?? -999) - (a.marginPct ?? -999));

  // ---- Budget (latest one that covers today, else the most recent)
  const budget = budgets.find((b) => new Date(b.periodStart) <= today && new Date(b.periodEnd) >= today) || budgets[0] || null;
  let budgetFacts = null;
  if (budget) {
    const rows = records.filter((r) => r.type === 'expense' && new Date(r.date) >= new Date(budget.periodStart) && new Date(r.date) <= new Date(budget.periodEnd));
    const spentBy = new Map();
    for (const r of rows) spentBy.set(String(r.category?._id || r.category), (spentBy.get(String(r.category?._id || r.category)) || 0) + r.amount);
    const cats = budget.categories.map((c) => {
      const spent = round2(spentBy.get(String(c.category?._id || c.category)) || 0);
      return { name: c.category?.name || 'Category', allocated: c.allocatedAmount, spent, remaining: round2(c.allocatedAmount - spent), overBy: spent > c.allocatedAmount ? round2(spent - c.allocatedAmount) : 0 };
    });
    const spentTotal = round2(sum(cats, (c) => c.spent));
    budgetFacts = {
      name: budget.name,
      period: `${fmtDay(new Date(budget.periodStart))} – ${fmtDay(new Date(budget.periodEnd))}`,
      isCurrent: new Date(budget.periodStart) <= today && new Date(budget.periodEnd) >= today,
      total: budget.totalAmount,
      spent: spentTotal,
      remaining: round2(budget.totalAmount - spentTotal),
      categories: cats,
      overCount: cats.filter((c) => c.overBy > 0).length,
    };
  } else gaps.push('no_budget');

  // ---- Loans (cooperative crop-cycle loans; same balance math as the Loans page)
  const paidBy = new Map(paymentSums.map((p) => [String(p._id), p.paid]));
  const loanItems = loans.map((l) => {
    const payable = totalPayable(l);
    const paid = round2(paidBy.get(String(l._id)) || 0);
    const remaining = round2(Math.max(0, payable - paid));
    const due = l.dueDate ? new Date(l.dueDate) : null;
    const sched = scheduleFor(l);
    return {
      lender: l.cooperative?.name || 'Cooperative',
      forCrop: l.crop && LOAN_CROPS[l.crop] ? LOAN_CROPS[l.crop].label : null,
      status: l.status,
      principal: l.principalAmount,
      interestRatePercent: l.interestRatePercent,
      rateBasis: l.rateBasis === 'cycle' ? 'flat for the whole crop cycle' : 'per year',
      totalPayable: payable,
      paid,
      remaining,
      paidPct: pct(paid, payable),
      dueDate: due ? due.toISOString().slice(0, 10) : null,
      daysUntilDue: due ? Math.ceil((due - today) / DAY) : null,
      harvestDate: sched ? sched.harvestAt.toISOString().slice(0, 10) : null,
    };
  });
  const open = loanItems.filter((l) => l.status !== 'paid_off' && l.remaining > 0);
  const nextDue = open.filter((l) => l.dueDate).sort((a, b) => a.daysUntilDue - b.daysUntilDue)[0] || null;
  const monthlyIncome12 = totals(last12).income / 12;

  const facts = {
    today: today.toISOString().slice(0, 10),
    location: lgu ? { province: 'Pangasinan', municipality: lgu.name, type: lgu.type, zone: lgu.zone } : null,
    season: seasonFor(today),
    weather,
    farm: { areaHa, fieldCount: fields.length, soilType, fields: fields.map((f) => ({ name: f.name, areaHa: f.areaHectares ?? null, soilType: f.soilType || null })) },
    money: {
      last30Days: { from: fmtDay(new Date(t - 30 * DAY)), to: fmtDay(today), ...now, change: { income: change(now.income, before.income), expenses: change(now.expenses, before.expenses), net: change(now.net, before.net) } },
      previous30Days: before,
      last12Months: totals(last12),
      monthlyTrend: trend,
      topExpenses12Months: byCategory(last12, 'expense').slice(0, 6),
      incomeSources12Months: byCategory(last12, 'income').slice(0, 6),
    },
    cropCycles: cycleFacts.slice(-6),
    cropProfitability,
    budget: budgetFacts,
    loans: {
      active: open,
      paidOff: loanItems.filter((l) => l.status === 'paid_off').map((l) => ({ lender: l.lender, forCrop: l.forCrop, principal: l.principal })),
      totalRemaining: round2(sum(open, (l) => l.remaining)),
      overdue: open.filter((l) => l.daysUntilDue != null && l.daysUntilDue < 0).length,
      nextDue: nextDue ? { lender: nextDue.lender, amount: nextDue.remaining, dueDate: nextDue.dueDate, daysUntilDue: nextDue.daysUntilDue } : null,
      shareOfYearlyIncomePct: monthlyIncome12 ? pct(sum(open, (l) => l.remaining), monthlyIncome12 * 12) : null,
    },
    dataGaps: gaps,
    dataNotes: [`Crop yields, prices and costs for crop suggestions are ${BENCHMARK_SOURCE}.`],
  };

  // ---- What to plant now
  const lastCycle = cycles[cycles.length - 1];
  facts.cropRecommendations = recommendCrops({
    today, lgu, forecast: weather,
    farm: { sizeHa: areaHa, soilType },
    pastCrops: cycles.map(cropNameOf),
    lastCrop: lastCycle ? cropNameOf(lastCycle) : null,
  });

  return { facts, farmFound: !!farm };
}

module.exports = { buildFacts };
