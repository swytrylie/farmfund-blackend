// Text and numbers built straight from the facts, with no AI call:
// - the advisor's welcome message and suggested questions (instant page load)
// - the summary's metric tiles and tags (numbers must never come from the AI)
// - rule-based answers used when Gemini is unavailable (no key, quota used up, timeout)

const peso = (n) => '₱' + Math.round(Number(n) || 0).toLocaleString('en-PH');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-11-22" -> "Nov 22, 2026"
const day = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const signed = (p) => (p == null ? null : `${p >= 0 ? '+' : ''}${p}%`);

const SUGGESTED_PROMPTS = [
  'What should I plant this season?',
  'How can I reduce my farm expenses?',
  'Advise me on my current loans',
  'Help me plan my personal budget',
  "How is my farm's profit margin?",
  'Analyze my finances',
];

const GAP_TIPS = {
  no_farm_profile: 'Set up your Farm Profile so I can give advice for your farm.',
  farm_location_not_set: 'Choose your municipality in Farm Profile so I can use your local season and weather.',
  no_fields: 'Add your fields (with size and soil type) in Farm Profile for better crop advice.',
  no_soil_type: 'Add the soil type of your fields in Farm Profile for better crop advice.',
  no_financial_records: 'Record your income and expenses so I can analyze your finances.',
  records_not_linked_to_cycles: 'Link your income and expenses to a crop cycle so I can show the profit of each crop.',
  no_budget: 'Create a budget in Budget Management so I can track your spending against it.',
};

// ---------------------------------------------------------------- welcome
function welcomeMessage(firstName, facts) {
  const m = facts.money.last30Days;
  const lines = [`Magandang araw${firstName ? `, ${firstName}` : ''}! I'm your AI Farm Advisor.`, ''];
  if (m.income || m.expenses) {
    lines.push(`Based on your records for the last 30 days:`);
    lines.push(`• Total Income: ${peso(m.income)}`);
    lines.push(`• Total Expenses: ${peso(m.expenses)}`);
    lines.push(`• Net: ${peso(m.net)}`);
    lines.push('');
  }
  const l = facts.loans;
  if (l.active.length) {
    lines.push(`You have ${l.active.length} active loan${l.active.length > 1 ? 's' : ''} with ${peso(l.totalRemaining)} left to pay${l.nextDue?.dueDate ? `, next due on ${day(l.nextDue.dueDate)}` : ''}.`);
  }
  const top = facts.cropRecommendations[0];
  const where = facts.location ? ` in ${facts.location.municipality}` : '';
  lines.push(`It's the ${facts.season.label.toLowerCase()}${where}.${top ? ` A good crop to ${top.plantNow ? 'plant now' : 'prepare for'} is ${top.name.toLowerCase()} (${top.localName}).` : ''}`);
  lines.push('');
  lines.push('Ask me what to plant, how to cut costs, about your loans, or to plan your budget.');
  const gap = facts.dataGaps.find((g) => GAP_TIPS[g]);
  if (gap) lines.push('', `Tip: ${GAP_TIPS[gap]}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- summary numbers
function summaryMetrics(facts) {
  const m = facts.money.last30Days;
  const c = m.change;
  const tone = (p, upIsGood = true) => (p == null ? 'neutral' : (p >= 0) === upIsGood ? 'good' : 'bad');
  const vs = (p) => (p == null ? 'No records in the 30 days before' : `${signed(p)} vs previous 30 days`);
  const l = facts.loans;
  return [
    { label: 'TOTAL INCOME', value: peso(m.income), change: vs(c.income), tone: tone(c.income) },
    { label: 'TOTAL EXPENSES', value: peso(m.expenses), change: vs(c.expenses), tone: tone(c.expenses, false) },
    { label: 'NET BALANCE', value: peso(m.net), change: vs(c.net), tone: tone(c.net) },
    {
      label: 'ACTIVE LOANS',
      value: peso(l.totalRemaining),
      change: l.active.length
        ? `${l.active.length} active${l.overdue ? `, ${l.overdue} overdue` : l.nextDue?.dueDate ? `, next due ${day(l.nextDue.dueDate)}` : ''}`
        : 'No active loans',
      tone: l.overdue ? 'bad' : l.active.length ? 'warn' : 'good',
    },
  ];
}

function driverTags(facts) {
  const m = facts.money;
  const tags = {};
  tags['income-expenses'] = [
    m.last30Days.change.net != null && { label: `${signed(m.last30Days.change.net)} net balance`, tone: m.last30Days.change.net >= 0 ? 'good' : 'bad' },
    m.last12Months.marginPct != null && { label: `12-month margin: ${m.last12Months.marginPct}%`, tone: 'neutral' },
  ].filter(Boolean);
  tags['crop-profitability'] = facts.cropProfitability.length
    ? facts.cropProfitability.slice(0, 3).map((p, i) => ({ label: `${p.crop}: ${p.marginPct ?? 0}% margin`, tone: i === 0 && p.marginPct > 0 ? 'good' : 'neutral' }))
    : [{ label: 'No harvested cycles with income yet', tone: 'neutral' }];
  const l = facts.loans;
  tags['loans-debt'] = [
    ...l.active.slice(0, 2).map((x) => ({ label: `${x.lender}: ${x.paidPct ?? 0}% paid`, tone: x.daysUntilDue != null && x.daysUntilDue < 0 ? 'bad' : 'neutral' })),
    ...l.paidOff.slice(0, 1).map((x) => ({ label: `${x.lender}: fully repaid`, tone: 'good' })),
    l.nextDue?.dueDate && { label: `Next due: ${day(l.nextDue.dueDate)}`, tone: l.nextDue.daysUntilDue < 0 ? 'bad' : 'neutral' },
  ].filter(Boolean);
  if (!tags['loans-debt'].length) tags['loans-debt'] = [{ label: 'No loans', tone: 'good' }];
  const b = facts.budget;
  tags['budget-management'] = b
    ? [
        ...b.categories.filter((x) => x.overBy > 0).slice(0, 2).map((x) => ({ label: `${x.name}: over by ${peso(x.overBy)}`, tone: 'bad' })),
        { label: `${b.categories.length - b.overCount} of ${b.categories.length} categories on track`, tone: b.overCount ? 'neutral' : 'good' },
      ]
    : [{ label: 'No budget yet', tone: 'neutral' }];
  return tags;
}

const DRIVER_TITLES = {
  'income-expenses': 'Income and expenses',
  'crop-profitability': 'Crop profitability',
  'loans-debt': 'Loans and debt',
  'budget-management': 'Budget Management',
};
// Which of the four drivers looks healthy (green), needs watching (amber) or is a problem (red).
function driverStatus(facts) {
  const m = facts.money;
  const b = facts.budget;
  const l = facts.loans;
  return {
    'income-expenses': m.last30Days.net < 0 ? 'bad' : m.last30Days.change.net != null && m.last30Days.change.net < 0 ? 'warn' : 'good',
    'crop-profitability': !facts.cropProfitability.length ? 'neutral' : facts.cropProfitability[0].marginPct > 0 ? 'good' : 'bad',
    'loans-debt': l.overdue ? 'bad' : l.nextDue && l.nextDue.daysUntilDue <= 14 ? 'warn' : 'good',
    'budget-management': !b ? 'neutral' : b.overCount ? 'bad' : 'good',
  };
}

// ---------------------------------------------------------------- rule-based summary text
function fallbackSummary(facts) {
  const m = facts.money;
  const n = m.last30Days;
  const up = n.change.net != null && n.change.net >= 0;
  const narrative = n.income || n.expenses
    ? [
        { text: `In the last 30 days you earned ${peso(n.income)} and spent ${peso(n.expenses)}, so ` },
        { text: `your net balance is ${peso(n.net)}`, isHighlight: true },
        ...(n.change.net != null ? [{ text: ', ' }, { text: `${up ? 'up' : 'down'} ${Math.abs(n.change.net)}%`, isHighlight: true }, { text: ' from the 30 days before.' }] : [{ text: '.' }]),
      ]
    : [{ text: 'No income or expenses were recorded in the last 30 days. ' }, { text: 'Record your sales and costs', isHighlight: true }, { text: ' to see your summary.' }];

  const best = facts.cropProfitability[0];
  const l = facts.loans;
  const b = facts.budget;
  const top = m.topExpenses12Months[0];
  const texts = {
    'income-expenses': m.last12Months.income || m.last12Months.expenses
      ? `Over the last 12 months you earned ${peso(m.last12Months.income)} and spent ${peso(m.last12Months.expenses)}, a ${m.last12Months.marginPct ?? 0}% margin.${top ? ` Your biggest cost is ${top.name} (${peso(top.amount)}, ${top.sharePct}% of expenses).` : ''}`
      : GAP_TIPS.no_financial_records,
    'crop-profitability': best
      ? `${best.crop} is your best performer so far: ${peso(best.income)} income against ${peso(best.expenses)} costs, a ${best.marginPct}% margin.${facts.cropProfitability.length > 1 ? ` ${facts.cropProfitability.slice(1).map((p) => `${p.crop} ${p.marginPct}%`).join(', ')}.` : ''}`
      : GAP_TIPS.records_not_linked_to_cycles,
    'loans-debt': l.active.length
      ? `You have ${peso(l.totalRemaining)} left to pay on ${l.active.length} loan${l.active.length > 1 ? 's' : ''}.${l.nextDue ? ` The next one (${l.nextDue.lender}, ${peso(l.nextDue.amount)}) is due ${day(l.nextDue.dueDate)}.` : ''}${l.overdue ? ` ${l.overdue} loan${l.overdue > 1 ? 's are' : ' is'} overdue, so contact your cooperative.` : ''}`
      : 'You have no active loans.',
    'budget-management': b
      ? `In "${b.name}" you have spent ${peso(b.spent)} of ${peso(b.total)}.${b.overCount ? ` ${b.categories.filter((c) => c.overBy > 0).map((c) => `${c.name} is over by ${peso(c.overBy)}`).join('; ')}.` : ' Every category is within budget.'}`
      : GAP_TIPS.no_budget,
  };
  const crop = facts.cropRecommendations[0];
  const focus = [
    crop && `For the ${facts.season.label.toLowerCase()}, ${crop.name.toLowerCase()} is a good fit (planting months ${crop.plantingWindow}).`,
    l.nextDue && `Set aside ${peso(l.nextDue.amount)} for your loan due ${day(l.nextDue.dueDate)}.`,
    b?.overCount ? 'Review the categories that are over budget before buying more inputs.' : top ? `Look for savings in ${top.name}, your largest cost.` : null,
  ].filter(Boolean).join(' ');
  return {
    narrative,
    drivers: Object.keys(DRIVER_TITLES).map((key) => ({ key, text: texts[key] })),
    focusRecommendation: focus || GAP_TIPS.no_financial_records,
  };
}

// ---------------------------------------------------------------- rule-based chat answers
function fallbackChat(facts, question) {
  const q = question.toLowerCase();
  const m = facts.money;
  const l = facts.loans;
  if (/plant|crop|tanim|itanim|season/.test(q)) {
    if (!facts.cropRecommendations.length) return 'I could not find a crop that is in season right now. Check again next month.';
    return [`For the ${facts.season.label.toLowerCase()}${facts.location ? ` in ${facts.location.municipality}` : ''}, these crops fit best:`, '',
      ...facts.cropRecommendations.map((c) => `• ${c.name} (${c.localName}): plant ${c.plantNow ? 'now' : 'next month'}, harvest in about ${c.daysToHarvest} days. Estimated profit ${peso(c.estimated.profit)} on ${c.suggestedAreaHa} ha. ${c.why}`),
      '', 'These are planning estimates. Confirm the variety with your Municipal Agriculture Office.'].join('\n');
  }
  if (/expense|reduce|cost|gastos|tipid|save/.test(q)) {
    const flags = facts.cropCycles.flatMap((c) => c.costsAboveTypical.map((f) => ({ ...f, crop: c.crop })));
    const top = m.topExpenses12Months.slice(0, 3);
    return [
      top.length ? `Your biggest costs in the last 12 months: ${top.map((t) => `${t.name} ${peso(t.amount)}`).join(', ')}.` : 'You have no expenses recorded yet.',
      ...flags.slice(0, 2).map((f) => `• ${f.category} for ${f.crop} was ${f.overPct}% above typical. Bringing it to typical would save about ${peso(f.possibleSavings)}.`),
      '• Buy inputs together through your cooperative for a lower price.',
      '• Get a soil test from the MAO before buying fertilizer, and apply only what the soil needs.',
      '• Share labor (bayanihan) or rent machinery as a group.',
    ].join('\n');
  }
  if (/loan|utang|debt|pay|bayad/.test(q)) {
    if (!l.active.length) return 'You have no active loans right now. If you need one, ask your cooperative through Loans & Debt.';
    return [`You have ${peso(l.totalRemaining)} left to pay:`,
      ...l.active.map((x) => `• ${x.lender}${x.forCrop ? ` (${x.forCrop})` : ''}: ${peso(x.remaining)} left, ${x.paidPct ?? 0}% paid${x.dueDate ? `, due ${day(x.dueDate)}` : ''}.`),
      '', l.nextDue ? `Pay the loan due soonest first (${l.nextDue.lender}, ${day(l.nextDue.dueDate)}) to avoid penalties. Set aside money for it from your harvest.` : ''].join('\n');
  }
  if (/margin|profit|tubo/.test(q)) {
    const y = m.last12Months;
    return [`Your profit margin is the part of your sales you keep after paying farm costs.`,
      `Last 12 months: ${peso(y.income)} sales − ${peso(y.expenses)} costs = ${peso(y.net)}, a margin of ${y.marginPct ?? 0}%.`,
      ...facts.cropProfitability.slice(0, 3).map((p) => `• ${p.crop}: ${p.marginPct}% margin`)].join('\n');
  }
  if (/budget|plan/.test(q)) {
    const n = m.last12Months.net;
    return [`From your farm records, you kept ${peso(n)} in the last 12 months (about ${peso(n / 12)} a month).`,
      '• First set aside money for next season’s inputs and loan payments due before the next harvest.',
      '• Then plan household spending from what is left, and save a little each month for emergencies.',
      'Tell me your monthly household spending and any other income, and I can make a budget with you.'].join('\n');
  }
  // income trend / overall analysis / anything else
  const trend = m.monthlyTrend.filter((x) => !x.partial).slice(-3).map((x) => `${x.month}: ${peso(x.income)} in, ${peso(x.expenses)} out`).join('; ');
  return [`Here is your farm at a glance:`,
    `• Last 30 days: income ${peso(m.last30Days.income)}, expenses ${peso(m.last30Days.expenses)}, net ${peso(m.last30Days.net)}.`,
    `• Last 12 months: net ${peso(m.last12Months.net)} (margin ${m.last12Months.marginPct ?? 0}%).`,
    trend && `• Recent months: ${trend}.`,
    l.active.length ? `• Loans: ${peso(l.totalRemaining)} left to pay.` : '• No active loans.',
    '', 'Ask me about crops to plant, costs, loans or your budget for more detail.'].filter(Boolean).join('\n');
}

module.exports = { SUGGESTED_PROMPTS, GAP_TIPS, DRIVER_TITLES, welcomeMessage, summaryMetrics, driverTags, driverStatus, fallbackSummary, fallbackChat, peso };
