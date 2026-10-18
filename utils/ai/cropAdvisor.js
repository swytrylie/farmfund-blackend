// "What to plant now" for a Pangasinan farm: rule-based and explainable.
// Every suggestion carries reason codes; reasonText() turns them into plain
// English for the page, and the chatbot can explain them in more detail.
const { CROPS, monthsLabel, findCropByName } = require('./cropCalendar');

// Which Request-a-Loan crop group (utils/loanTerms.js) a suggestion belongs to.
const LOAN_CROP = {
  'rice-irrigated': 'rice', 'rice-rainfed': 'rice', 'corn-yellow': 'yellow_corn',
  pechay: 'leafy_greens', okra: 'fast_vegetables', sitaw: 'fast_vegetables',
  eggplant: 'fruit_vegetables', ampalaya: 'fruit_vegetables', tomato: 'fruit_vegetables',
};

const CATEGORY_RULES = [
  ['seeds', /seed|binhi|seedling|planting material|punla/i],
  ['fertilizer', /fertili|abono|urea|complete|ammo|potash|compost/i],
  ['pesticides', /pestic|herbic|insectic|fungic|chemical|spray|weedicide/i],
  ['labor', /labor|labour|worker|trabahador|hired|wage|transplant|weeding/i],
  ['machinery', /machin|tractor|harvester|thresher|land prep|plow|araro|fuel|diesel|gasoline|equipment/i],
  ['irrigation', /irrigat|water|nia|pump|patubig/i],
  ['transport', /transport|hauling|delivery|freight/i],
  ['materials', /trellis|mulch|plastic|bamboo|stake|materials/i],
];
const CATEGORY_LABELS = {
  seeds: 'Seeds', fertilizer: 'Fertilizer', pesticides: 'Pesticides', labor: 'Labor', machinery: 'Machinery & fuel',
  irrigation: 'Irrigation', transport: 'Transport', materials: 'Materials', other: 'Other',
};
function normalizeCategory(name) {
  for (const [key, re] of CATEGORY_RULES) if (re.test(String(name || ''))) return key;
  return 'other';
}

/** Typical cost/yield figures for a crop name the farmer typed ("Rice", "Palay", "Talong"…). */
function benchmarkFor(cropName) {
  if (/rice|palay/i.test(cropName || '')) return CROPS.find((c) => c.id === 'rice-irrigated');
  return findCropByName(cropName);
}

const REASON_TEXT = {
  IN_SEASON: () => 'Now is planting time for this crop in Pangasinan.',
  PLANT_NEXT_MONTH: () => 'Its planting window opens next month, so prepare the land and inputs now.',
  NEEDS_IRRIGATION: () => 'It needs irrigation in the dry season, so plant it only where you have water.',
  LOW_WATER_NEED: () => 'It needs little water.',
  SOIL_MATCH: (r) => `It suits your ${r.soil} soil.`,
  SOIL_MISMATCH: (r) => `It is not ideal for your ${r.soil} soil.`,
  ZONE_FIT: () => 'It grows well in your part of the province.',
  HEAVY_RAIN_RISK: (r) => `Heavy rain (up to ${r.mm} mm in 3 days) is forecast, so wait for it to pass or prepare drainage.`,
  DRY_SPELL_RISK: () => 'A dry spell is forecast.',
  HIGH_MARGIN: (r) => `Its estimated profit margin is high (about ${r.marginPct}%).`,
  PRICE_VOLATILE: () => 'Its market price changes a lot, so start small or find a buyer first.',
  ROTATION_AFTER_RICE: () => 'It is a good crop to follow rice: it adds nitrogen to the soil and breaks pest cycles.',
  FAMILIAR: () => 'You have grown this before.',
  GOVT_SUPPORT: () => 'It has government support (RCEF seeds and machinery, crop insurance) and a steady market.',
};
const reasonText = (reasons) => reasons.map((r) => REASON_TEXT[r.code]?.(r)).filter(Boolean).join(' ');

const monthsAhead = (from, to) => (to - from + 12) % 12;

function scoreCrop(crop, { today, lgu, farm, forecast, lastCrop, grownBefore }) {
  const month = today.getMonth() + 1;
  const ahead = Math.min(...crop.plantMonths.map((m) => monthsAhead(month, m)));
  if (ahead > 1) return null; // not plantable within ~30 days
  const reasons = [];
  let score = 0;
  if (ahead === 0) { score += 35; reasons.push({ code: 'IN_SEASON' }); } else { score += 20; reasons.push({ code: 'PLANT_NEXT_MONTH' }); }

  // Water. FarmFund doesn't record irrigation, so irrigation-dependent crops are flagged, not ruled out.
  const plantMonth = ((month - 1 + ahead) % 12) + 1;
  const dry = plantMonth >= 11 || plantMonth <= 4;
  if (crop.needsIrrigation && dry) { score += 2; reasons.push({ code: 'NEEDS_IRRIGATION' }); }
  else if (crop.water === 'low' || crop.droughtTolerant) { score += 10; reasons.push({ code: 'LOW_WATER_NEED' }); }
  else score += 6;

  if (farm.soilType) {
    if (crop.soils.includes(farm.soilType)) { score += 10; reasons.push({ code: 'SOIL_MATCH', soil: farm.soilType }); }
    else { score -= 6; reasons.push({ code: 'SOIL_MISMATCH', soil: farm.soilType }); }
  }
  if (lgu?.zone === 'coastal' && crop.sandyFriendly) { score += 5; reasons.push({ code: 'ZONE_FIT' }); }
  if (lgu?.zone === 'eastern' && crop.upland) { score += 5; reasons.push({ code: 'ZONE_FIT' }); }

  if (forecast) {
    if (forecast.risks.some((r) => r.includes('rain')) && !crop.floodTolerant) {
      score -= forecast.risks.includes('typhoon_or_heavy_rain') ? 12 : 6;
      reasons.push({ code: 'HEAVY_RAIN_RISK', mm: forecast.maxRain3DaysMm });
    }
    if (forecast.risks.includes('dry_spell') && crop.water === 'high') { score -= 10; reasons.push({ code: 'DRY_SPELL_RISK' }); }
  }

  const revenuePerHa = crop.yieldPerHa * crop.pricePerKg;
  const profitPerHa = revenuePerHa - crop.costPerHa;
  const marginPct = Math.round((profitPerHa / revenuePerHa) * 100);
  score += Math.max(0, Math.min(20, marginPct / 3));
  if (marginPct >= 45) reasons.push({ code: 'HIGH_MARGIN', marginPct });
  if (crop.priceVolatility === 'high') { score -= 8; reasons.push({ code: 'PRICE_VOLATILE' }); }
  else if (crop.priceVolatility === 'medium') score -= 3;

  if (lastCrop && /rice|palay/i.test(lastCrop) && crop.group === 'legume') { score += 6; reasons.push({ code: 'ROTATION_AFTER_RICE' }); }
  if (grownBefore) { score += 8; reasons.push({ code: 'FAMILIAR' }); }
  if (crop.govSupport) { score += 5; reasons.push({ code: 'GOVT_SUPPORT' }); }

  let area = Number(farm.sizeHa) || 1;
  if (crop.laborIntensity === 'high' && !grownBefore) area = Math.min(area, 0.5); // labor-heavy & new: start small
  area = Math.round(area * 10) / 10;

  return {
    id: crop.id,
    name: crop.name,
    localName: crop.localName,
    score: Math.round(score),
    plantNow: ahead === 0,
    plantingWindow: monthsLabel(crop.plantMonths),
    daysToHarvest: crop.daysToHarvest,
    expectedHarvestDate: new Date(today.getTime() + (ahead * 30 + crop.daysToHarvest) * 864e5).toISOString().slice(0, 10),
    suggestedAreaHa: area,
    estimated: {
      costPerHa: crop.costPerHa,
      profitPerHa,
      marginPct,
      cost: Math.round(crop.costPerHa * area),
      revenue: Math.round(revenuePerHa * area),
      profit: Math.round(profitPerHa * area),
    },
    priceVolatility: crop.priceVolatility,
    loanCrop: LOAN_CROP[crop.id] || null,
    reasons,
    why: reasonText(reasons.slice(0, 4)),
  };
}

function recommendCrops({ today = new Date(), lgu, farm = {}, forecast, pastCrops = [], lastCrop, limit = 4 }) {
  const past = pastCrops.map((c) => String(c).toLowerCase());
  const grown = (crop) => past.some((p) => p.includes(crop.name.toLowerCase().split(' ')[0]) || p.includes(crop.localName.toLowerCase().split(' ')[0]) || (/palay/.test(p) && crop.id.startsWith('rice')));
  const perGroup = {};
  return CROPS
    .map((c) => scoreCrop(c, { today, lgu, farm, forecast, lastCrop, grownBefore: grown(c) }))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .filter((r) => {
      // at most 2 per crop group so staples (rice, corn, legumes) aren't crowded out by vegetables
      const g = CROPS.find((c) => c.id === r.id).group;
      perGroup[g] = (perGroup[g] || 0) + 1;
      return perGroup[g] <= 2;
    })
    .slice(0, limit);
}

module.exports = { recommendCrops, scoreCrop, reasonText, benchmarkFor, normalizeCategory, CATEGORY_LABELS };
