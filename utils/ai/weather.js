// 16-day forecast from Open-Meteo (free, no API key, non-commercial use).
// Attribution required: "Weather data by Open-Meteo.com" (shown in the UI).
// Never throws: on any failure it returns null and the advisor falls back to season-only logic.

const CACHE = new Map(); // key -> { at, data }   (per serverless instance)
const TTL_MS = 3 * 60 * 60 * 1000;

async function getForecast(lgu, { fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  if (!lgu) return null;
  const key = `${lgu.lat},${lgu.lon}`;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lgu.lat}&longitude=${lgu.lon}` +
    '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,wind_gusts_10m_max,precipitation_probability_max' +
    '&forecast_days=16&timezone=Asia%2FManila';

  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const json = await res.json();
    const data = summarizeForecast(json.daily);
    CACHE.set(key, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

/** Turn Open-Meteo daily arrays into a compact summary + risk flags. Exported for tests. */
function summarizeForecast(daily) {
  if (!daily?.time?.length) return null;
  const n = daily.time.length;
  const sum = (arr, from = 0, to = n) => (arr || []).slice(from, to).reduce((a, b) => a + (b || 0), 0);
  const max = (arr) => Math.max(...(arr || [0]).map((v) => v || 0));
  const avg = (arr) => (arr?.length ? arr.reduce((a, b) => a + (b || 0), 0) / arr.length : null);

  const rain16 = sum(daily.precipitation_sum);
  const rain7 = sum(daily.precipitation_sum, 0, 7);
  let maxRain3d = 0;
  for (let i = 0; i + 3 <= n; i++) maxRain3d = Math.max(maxRain3d, sum(daily.precipitation_sum, i, i + 3));
  const maxGust = max(daily.wind_gusts_10m_max);
  const dryDays = (daily.precipitation_sum || []).filter((v) => (v || 0) < 1).length;

  const risks = [];
  if (maxRain3d >= 150 || maxGust >= 75) risks.push('typhoon_or_heavy_rain');
  else if (maxRain3d >= 80) risks.push('heavy_rain');
  if (dryDays >= 12 && rain16 < 20) risks.push('dry_spell');
  if (max(daily.temperature_2m_max) >= 36) risks.push('extreme_heat');

  return {
    days: n,
    from: daily.time[0],
    to: daily.time[n - 1],
    rainNext7DaysMm: Math.round(rain7),
    rainNext16DaysMm: Math.round(rain16),
    maxRain3DaysMm: Math.round(maxRain3d),
    maxWindGustKph: Math.round(maxGust),
    avgMaxTempC: Math.round((avg(daily.temperature_2m_max) ?? 0) * 10) / 10,
    dryDays,
    risks,
    source: 'Open-Meteo.com',
  };
}

module.exports = { getForecast, summarizeForecast };
