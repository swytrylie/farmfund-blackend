// Pangasinan: 44 municipalities + 4 component cities (48 LGUs).
// lat/lon = approximate poblacion (town center) coordinates, used only to fetch
// weather from Open-Meteo (~11 km grid), so small offsets do not matter.
// zone: rough agro-geographic grouping used by the crop scorer.
//   coastal  – western / Lingayen Gulf towns (sandy soils, salt spray, strong winds)
//   central  – central plain (mostly irrigated lowland rice)
//   eastern  – eastern towns toward the Cordillera/Caraballo foothills (more upland, corn)

const LGUS = [
  // ---- Cities ----
  { name: 'Alaminos City', type: 'city', district: 1, lat: 16.1553, lon: 119.9806, zone: 'coastal' },
  { name: 'Dagupan City', type: 'city', district: 4, lat: 16.0433, lon: 120.3333, zone: 'coastal' },
  { name: 'San Carlos City', type: 'city', district: 3, lat: 15.9281, lon: 120.3489, zone: 'central' },
  { name: 'Urdaneta City', type: 'city', district: 5, lat: 15.9761, lon: 120.5711, zone: 'central' },
  // ---- Municipalities ----
  { name: 'Agno', type: 'municipality', district: 1, lat: 16.1161, lon: 119.8027, zone: 'coastal' },
  { name: 'Aguilar', type: 'municipality', district: 2, lat: 15.8899, lon: 120.2379, zone: 'central' },
  { name: 'Alcala', type: 'municipality', district: 5, lat: 15.8468, lon: 120.5218, zone: 'central' },
  { name: 'Anda', type: 'municipality', district: 1, lat: 16.2896, lon: 119.9492, zone: 'coastal' },
  { name: 'Asingan', type: 'municipality', district: 6, lat: 16.0023, lon: 120.6695, zone: 'eastern' },
  { name: 'Balungao', type: 'municipality', district: 6, lat: 15.9000, lon: 120.7000, zone: 'eastern' },
  { name: 'Bani', type: 'municipality', district: 1, lat: 16.1869, lon: 119.8619, zone: 'coastal' },
  { name: 'Basista', type: 'municipality', district: 2, lat: 15.8524, lon: 120.3976, zone: 'central' },
  { name: 'Bautista', type: 'municipality', district: 5, lat: 15.7811, lon: 120.4985, zone: 'central' },
  { name: 'Bayambang', type: 'municipality', district: 3, lat: 15.8103, lon: 120.4558, zone: 'central' },
  { name: 'Binalonan', type: 'municipality', district: 5, lat: 16.0500, lon: 120.6000, zone: 'central' },
  { name: 'Binmaley', type: 'municipality', district: 2, lat: 16.0322, lon: 120.2690, zone: 'coastal' },
  { name: 'Bolinao', type: 'municipality', district: 1, lat: 16.3881, lon: 119.8950, zone: 'coastal' },
  { name: 'Bugallon', type: 'municipality', district: 2, lat: 15.9573, lon: 120.1876, zone: 'central' },
  { name: 'Burgos', type: 'municipality', district: 1, lat: 16.0600, lon: 119.8600, zone: 'coastal' },
  { name: 'Calasiao', type: 'municipality', district: 3, lat: 16.0104, lon: 120.3570, zone: 'central' },
  { name: 'Dasol', type: 'municipality', district: 1, lat: 15.9893, lon: 119.8803, zone: 'coastal' },
  { name: 'Infanta', type: 'municipality', district: 1, lat: 15.8203, lon: 119.9081, zone: 'coastal' },
  { name: 'Labrador', type: 'municipality', district: 2, lat: 16.0339, lon: 120.1394, zone: 'coastal' },
  { name: 'Laoac', type: 'municipality', district: 5, lat: 16.0333, lon: 120.5500, zone: 'central' },
  { name: 'Lingayen', type: 'municipality', district: 2, lat: 16.0218, lon: 120.2319, zone: 'coastal' },
  { name: 'Mabini', type: 'municipality', district: 1, lat: 16.0697, lon: 119.9397, zone: 'coastal' },
  { name: 'Malasiqui', type: 'municipality', district: 3, lat: 15.9182, lon: 120.4134, zone: 'central' },
  { name: 'Manaoag', type: 'municipality', district: 4, lat: 16.0439, lon: 120.4861, zone: 'central' },
  { name: 'Mangaldan', type: 'municipality', district: 4, lat: 16.0700, lon: 120.4025, zone: 'central' },
  { name: 'Mangatarem', type: 'municipality', district: 2, lat: 15.7874, lon: 120.2921, zone: 'central' },
  { name: 'Mapandan', type: 'municipality', district: 3, lat: 16.0254, lon: 120.4542, zone: 'central' },
  { name: 'Natividad', type: 'municipality', district: 6, lat: 16.0422, lon: 120.7883, zone: 'eastern' },
  { name: 'Pozorrubio', type: 'municipality', district: 5, lat: 16.1108, lon: 120.5436, zone: 'eastern' },
  { name: 'Rosales', type: 'municipality', district: 6, lat: 15.8944, lon: 120.6328, zone: 'central' },
  { name: 'San Fabian', type: 'municipality', district: 4, lat: 16.1206, lon: 120.4022, zone: 'coastal' },
  { name: 'San Jacinto', type: 'municipality', district: 4, lat: 16.0725, lon: 120.4378, zone: 'central' },
  { name: 'San Manuel', type: 'municipality', district: 6, lat: 16.0656, lon: 120.6667, zone: 'eastern' },
  { name: 'San Nicolas', type: 'municipality', district: 6, lat: 16.0700, lon: 120.7650, zone: 'eastern' },
  { name: 'San Quintin', type: 'municipality', district: 6, lat: 15.9844, lon: 120.8150, zone: 'eastern' },
  { name: 'Santa Barbara', type: 'municipality', district: 3, lat: 16.0006, lon: 120.4022, zone: 'central' },
  { name: 'Santa Maria', type: 'municipality', district: 6, lat: 15.9800, lon: 120.7000, zone: 'eastern' },
  { name: 'Santo Tomas', type: 'municipality', district: 5, lat: 15.8800, lon: 120.5850, zone: 'central' },
  { name: 'Sison', type: 'municipality', district: 5, lat: 16.1733, lon: 120.5156, zone: 'eastern' },
  { name: 'Sual', type: 'municipality', district: 1, lat: 16.0667, lon: 120.0958, zone: 'coastal' },
  { name: 'Tayug', type: 'municipality', district: 6, lat: 16.0267, lon: 120.7472, zone: 'eastern' },
  { name: 'Umingan', type: 'municipality', district: 6, lat: 15.9278, lon: 120.8411, zone: 'eastern' },
  { name: 'Urbiztondo', type: 'municipality', district: 2, lat: 15.8228, lon: 120.3294, zone: 'central' },
  { name: 'Villasis', type: 'municipality', district: 5, lat: 15.9017, lon: 120.5875, zone: 'central' },
];

const normalizeKey = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/,?\s*pangasinan$/, '')
    .replace(/^city of\s+/, '')
    .replace(/\s+city$/, '')
    .replace(/\bsta\.?\s+/g, 'santa ')
    .replace(/\bsto\.?\s+/g, 'santo ')
    .replace(/\bsn\.?\s+/g, 'san ')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const INDEX = new Map(LGUS.map((l) => [normalizeKey(l.name), l]));

/** Find a Pangasinan LGU by any common spelling ("Sta. Barbara", "City of Urdaneta", "urdaneta"). */
function findLgu(name) {
  return INDEX.get(normalizeKey(name)) || null;
}

/** Pangasinan has a Type I climate: dry Nov–Apr, wet May–Oct. */
function seasonFor(date = new Date()) {
  const m = date.getMonth() + 1;
  if (m >= 5 && m <= 10) {
    return {
      key: 'wet',
      label: 'Wet season (tag-ulan)',
      note:
        m >= 9
          ? 'Late wet season: harvest of wet-season rice, land preparation for the dry season. Typhoons are still possible.'
          : 'Wet season: main rainfed rice and corn planting period. Watch for typhoons and flooding.',
    };
  }
  return {
    key: 'dry',
    label: 'Dry season (tag-araw)',
    note:
      m >= 11 || m <= 1
        ? 'Early dry season: best window for irrigated rice, vegetables, onion, mungbean and other legumes on residual moisture.'
        : 'Late dry season: water is scarce; favor short-duration, drought-tolerant crops unless irrigated.',
  };
}

module.exports = { LGUS, findLgu, seasonFor };
