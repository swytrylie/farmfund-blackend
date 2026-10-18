// Crop calendar + cost/yield benchmarks for Pangasinan (Type I climate).
//
// ⚠️ IMPORTANT: yield, price and cost numbers below are PLACEHOLDER ESTIMATES so the
// system works out of the box. Before a real deployment, replace them with figures from
// DA Region I, PhilRice, PSA OpenSTAT (cost & returns, farmgate prices) or your own
// collected farmer data, and have the Municipal Agriculture Office review the calendar.

const BENCHMARK_SOURCE = 'placeholder estimates – replace with DA Region I / PSA data';

// plantMonths: months (1–12) in which planting is recommended.
// water: 'low' | 'medium' | 'high'. needsIrrigation: true if it fails without irrigation
// in the dry season. costShares: typical share of total production cost per category.
const CROPS = [
  {
    id: 'rice-irrigated', name: 'Rice (irrigated)', localName: 'Palay (patubig)', group: 'cereal',
    plantMonths: [6, 7, 11, 12, 1], daysToHarvest: 115, water: 'high', needsIrrigation: true,
    soils: ['clay', 'clay loam', 'silty clay', 'silty clay loam'], floodTolerant: true, droughtTolerant: false,
    yieldPerHa: 4800, pricePerKg: 19, costPerHa: 62000, priceVolatility: 'low', laborIntensity: 'medium', govSupport: true,
    costShares: { seeds: 0.06, fertilizer: 0.22, pesticides: 0.07, labor: 0.38, machinery: 0.17, irrigation: 0.05, other: 0.05 },
  },
  {
    id: 'rice-rainfed', name: 'Rice (rainfed)', localName: 'Palay (sahod-ulan)', group: 'cereal',
    plantMonths: [6, 7], daysToHarvest: 115, water: 'high', needsIrrigation: false,
    soils: ['clay', 'clay loam', 'silty clay', 'silty clay loam'], floodTolerant: true, droughtTolerant: false,
    yieldPerHa: 3500, pricePerKg: 19, costPerHa: 48000, priceVolatility: 'low', laborIntensity: 'medium', govSupport: true,
    costShares: { seeds: 0.07, fertilizer: 0.22, pesticides: 0.07, labor: 0.40, machinery: 0.19, other: 0.05 },
  },
  {
    id: 'corn-yellow', name: 'Yellow corn', localName: 'Mais (dilaw)', group: 'cereal',
    plantMonths: [5, 6, 10, 11, 12], daysToHarvest: 110, water: 'medium', needsIrrigation: false,
    soils: ['loam', 'sandy loam', 'clay loam', 'silt loam'], floodTolerant: false, droughtTolerant: true,
    yieldPerHa: 5500, pricePerKg: 14, costPerHa: 55000, priceVolatility: 'medium', laborIntensity: 'low',
    upland: true,
    costShares: { seeds: 0.18, fertilizer: 0.30, pesticides: 0.08, labor: 0.26, machinery: 0.13, other: 0.05 },
  },
  {
    id: 'mungbean', name: 'Mungbean', localName: 'Munggo', group: 'legume',
    plantMonths: [11, 12, 1, 2, 3], daysToHarvest: 65, water: 'low', needsIrrigation: false,
    soils: ['loam', 'sandy loam', 'clay loam', 'silt loam'], floodTolerant: false, droughtTolerant: true,
    yieldPerHa: 800, pricePerKg: 75, costPerHa: 25000, priceVolatility: 'medium', laborIntensity: 'medium',
    costShares: { seeds: 0.16, fertilizer: 0.08, pesticides: 0.14, labor: 0.50, machinery: 0.07, other: 0.05 },
  },
  {
    id: 'peanut', name: 'Peanut', localName: 'Mani', group: 'legume',
    plantMonths: [10, 11, 12], daysToHarvest: 105, water: 'low', needsIrrigation: false,
    soils: ['sandy loam', 'sandy', 'loam'], floodTolerant: false, droughtTolerant: true,
    yieldPerHa: 1500, pricePerKg: 60, costPerHa: 40000, priceVolatility: 'medium', laborIntensity: 'medium',
    sandyFriendly: true, upland: true,
    costShares: { seeds: 0.30, fertilizer: 0.10, pesticides: 0.08, labor: 0.42, machinery: 0.05, other: 0.05 },
  },
  {
    id: 'onion-red', name: 'Red onion', localName: 'Sibuyas pula', group: 'vegetable',
    plantMonths: [11, 12, 1], daysToHarvest: 110, water: 'medium', needsIrrigation: true,
    soils: ['loam', 'sandy loam', 'clay loam', 'silt loam'], floodTolerant: false, droughtTolerant: false,
    yieldPerHa: 14000, pricePerKg: 40, costPerHa: 210000, priceVolatility: 'high', laborIntensity: 'high',
    costShares: { seeds: 0.20, fertilizer: 0.18, pesticides: 0.14, labor: 0.35, irrigation: 0.06, other: 0.07 },
  },
  {
    id: 'tomato', name: 'Tomato', localName: 'Kamatis', group: 'vegetable',
    plantMonths: [10, 11, 12], daysToHarvest: 85, water: 'medium', needsIrrigation: true,
    soils: ['loam', 'sandy loam', 'clay loam'], floodTolerant: false, droughtTolerant: false,
    yieldPerHa: 20000, pricePerKg: 20, costPerHa: 150000, priceVolatility: 'high', laborIntensity: 'high',
    costShares: { seeds: 0.08, fertilizer: 0.20, pesticides: 0.15, labor: 0.38, materials: 0.12, other: 0.07 },
  },
  {
    id: 'eggplant', name: 'Eggplant', localName: 'Talong', group: 'vegetable',
    plantMonths: [10, 11, 12, 1, 5, 6], daysToHarvest: 75, water: 'medium', needsIrrigation: true,
    soils: ['loam', 'sandy loam', 'clay loam'], floodTolerant: false, droughtTolerant: false,
    yieldPerHa: 18000, pricePerKg: 22, costPerHa: 150000, priceVolatility: 'medium', laborIntensity: 'high',
    costShares: { seeds: 0.05, fertilizer: 0.22, pesticides: 0.18, labor: 0.40, materials: 0.08, other: 0.07 },
  },
  {
    id: 'ampalaya', name: 'Bitter gourd', localName: 'Ampalaya', group: 'vegetable',
    plantMonths: [10, 11, 12, 1, 5, 6], daysToHarvest: 60, water: 'medium', needsIrrigation: true,
    soils: ['loam', 'sandy loam', 'clay loam'], floodTolerant: false, droughtTolerant: false,
    yieldPerHa: 12000, pricePerKg: 40, costPerHa: 170000, priceVolatility: 'medium', laborIntensity: 'high',
    costShares: { seeds: 0.08, fertilizer: 0.18, pesticides: 0.15, labor: 0.35, materials: 0.17, other: 0.07 },
  },
  {
    id: 'sitaw', name: 'String beans', localName: 'Sitaw', group: 'vegetable',
    plantMonths: [10, 11, 12, 1, 2, 5, 6, 7], daysToHarvest: 55, water: 'medium', needsIrrigation: false,
    soils: ['loam', 'sandy loam', 'clay loam'], floodTolerant: false, droughtTolerant: false,
    yieldPerHa: 8000, pricePerKg: 35, costPerHa: 110000, priceVolatility: 'medium', laborIntensity: 'high',
    costShares: { seeds: 0.08, fertilizer: 0.15, pesticides: 0.15, labor: 0.40, materials: 0.15, other: 0.07 },
  },
  {
    id: 'okra', name: 'Okra', localName: 'Okra', group: 'vegetable',
    plantMonths: [1, 2, 3, 4, 6, 7, 8], daysToHarvest: 50, water: 'low', needsIrrigation: false,
    soils: ['loam', 'sandy loam', 'clay loam'], floodTolerant: false, droughtTolerant: true,
    yieldPerHa: 10000, pricePerKg: 30, costPerHa: 80000, priceVolatility: 'medium', laborIntensity: 'high',
    costShares: { seeds: 0.08, fertilizer: 0.18, pesticides: 0.12, labor: 0.50, other: 0.12 },
  },
  {
    id: 'squash', name: 'Squash', localName: 'Kalabasa', group: 'vegetable',
    plantMonths: [10, 11, 12, 5, 6, 7], daysToHarvest: 85, water: 'low', needsIrrigation: false,
    soils: ['loam', 'sandy loam', 'clay loam', 'sandy'], floodTolerant: false, droughtTolerant: true,
    yieldPerHa: 10000, pricePerKg: 15, costPerHa: 60000, priceVolatility: 'medium', laborIntensity: 'low',
    sandyFriendly: true,
    costShares: { seeds: 0.10, fertilizer: 0.25, pesticides: 0.10, labor: 0.40, other: 0.15 },
  },
  {
    id: 'watermelon', name: 'Watermelon', localName: 'Pakwan', group: 'fruit-vegetable',
    plantMonths: [11, 12, 1], daysToHarvest: 75, water: 'medium', needsIrrigation: false,
    soils: ['sandy', 'sandy loam', 'loam'], floodTolerant: false, droughtTolerant: true,
    yieldPerHa: 18000, pricePerKg: 18, costPerHa: 130000, priceVolatility: 'high', laborIntensity: 'medium',
    sandyFriendly: true,
    costShares: { seeds: 0.15, fertilizer: 0.22, pesticides: 0.15, labor: 0.30, materials: 0.10, other: 0.08 },
  },
  {
    id: 'kamote', name: 'Sweet potato', localName: 'Kamote', group: 'root',
    plantMonths: [10, 11, 12, 5, 6, 7], daysToHarvest: 110, water: 'low', needsIrrigation: false,
    soils: ['sandy loam', 'loam', 'sandy'], floodTolerant: false, droughtTolerant: true,
    yieldPerHa: 9000, pricePerKg: 18, costPerHa: 60000, priceVolatility: 'low', laborIntensity: 'medium',
    sandyFriendly: true, upland: true,
    costShares: { seeds: 0.15, fertilizer: 0.15, pesticides: 0.05, labor: 0.50, other: 0.15 },
  },
  {
    id: 'pechay', name: 'Pechay', localName: 'Petsay', group: 'vegetable',
    plantMonths: [10, 11, 12, 1, 2], daysToHarvest: 35, water: 'medium', needsIrrigation: true,
    soils: ['loam', 'sandy loam', 'clay loam'], floodTolerant: false, droughtTolerant: false,
    yieldPerHa: 8000, pricePerKg: 25, costPerHa: 70000, priceVolatility: 'medium', laborIntensity: 'high',
    costShares: { seeds: 0.08, fertilizer: 0.22, pesticides: 0.10, labor: 0.45, other: 0.15 },
  },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct–Dec, May–Jun" style label from a month list (handles Dec→Jan wrap). */
function monthsLabel(months) {
  const set = [...new Set(months)].sort((a, b) => a - b);
  const runs = [];
  for (const m of set) {
    const last = runs[runs.length - 1];
    if (last && m === last[1] + 1) last[1] = m;
    else runs.push([m, m]);
  }
  // merge wrap-around run (e.g. [1,1] + [10,12] → Oct–Jan)
  if (runs.length > 1 && runs[0][0] === 1 && runs[runs.length - 1][1] === 12) {
    const first = runs.shift();
    runs[runs.length - 1][1] = first[1];
  }
  return runs.map(([a, b]) => (a === b ? MONTHS[a - 1] : `${MONTHS[a - 1]}–${MONTHS[b - 1]}`)).join(', ');
}

function findCropByName(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  return (
    CROPS.find((c) => c.id === n) ||
    CROPS.find((c) => c.name.toLowerCase() === n || c.localName.toLowerCase() === n) ||
    CROPS.find((c) => n.includes(c.name.toLowerCase().split(' ')[0]) || n.includes(c.localName.toLowerCase().split(' ')[0])) ||
    null
  );
}

module.exports = { BENCHMARK_SOURCE, CROPS, monthsLabel, findCropByName };
