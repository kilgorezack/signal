/**
 * Signal — Data Build Script
 *
 * Fetches ABS Census 2021 data + SA4 boundaries from public APIs,
 * computes opportunity scores, and writes static JSON files consumed
 * by the frontend at runtime.
 *
 * ABS Data API uses SDMX-JSON 2.0 (series-based, not observation-based).
 * Dataflows follow the pattern C21_G{NN}_SA2 (SA2+ includes SA3 and SA4).
 *
 * Outputs:
 *   public/data/sa4.geojson   — GeoJSON FeatureCollection with demographics + scores
 *   public/data/regions.json  — Flat region index array
 *
 * Run: node scripts/build-data.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const CACHE_DIR = path.join(ROOT, '.abs-cache');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

// ─── ABS API helpers ──────────────────────────────────────────────────────────

const ABS_BASE = 'https://api.data.abs.gov.au';

async function fetchAbs(dataflow, key) {
  const cacheFile = path.join(CACHE_DIR, `${dataflow}_${key.replace(/[^a-z0-9]/gi, '_')}.json`);

  if (fs.existsSync(cacheFile)) {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < 24 * 60 * 60 * 1000) {
      process.stdout.write(`  [cache] ${dataflow}/${key}\n`);
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  }

  const url = `${ABS_BASE}/data/${dataflow}/${key}/all`;
  process.stdout.write(`  [fetch] ${url}\n`);

  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.sdmx.data+json' },
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    throw new Error(`ABS API ${res.status} for ${dataflow}/${key}: ${await res.text().catch(() => '')}`);
  }

  const data = await res.json();
  fs.writeFileSync(cacheFile, JSON.stringify(data));
  return data;
}

/**
 * Parse SDMX-JSON 2.0 series response.
 * Returns: Map<regionCode, Map<dimKey, value>>
 * dimKey = all non-region dimension values joined as "DIM1=val|DIM2=val"
 */
function parseSdmx2Series(sdmx) {
  const structures = sdmx?.data?.structures ?? sdmx?.structures ?? [];
  const struct = structures[0];
  if (!struct) throw new Error('No structure found in SDMX response');

  const seriesDims = struct.dimensions?.series ?? [];
  const obsDims = struct.dimensions?.observation ?? [];

  const dataSets = sdmx?.data?.dataSets ?? sdmx?.dataSets ?? [];
  const series = dataSets[0]?.series ?? {};

  // Find region dimension index
  const regionDimIdx = seriesDims.findIndex(d =>
    d.id === 'REGION' || d.roles?.includes('REGION')
  );

  const result = new Map();

  for (const [seriesKey, seriesData] of Object.entries(series)) {
    const seriesIndices = seriesKey.split(':').map(Number);

    const regionCode = regionDimIdx >= 0
      ? seriesDims[regionDimIdx]?.values?.[seriesIndices[regionDimIdx]]?.id
      : null;
    if (!regionCode) continue;

    // Build dim key from all non-region series dimensions
    const dimParts = seriesIndices
      .map((idx, di) => {
        if (di === regionDimIdx) return null;
        const dim = seriesDims[di];
        const val = dim?.values?.[idx];
        return val ? `${dim.id}=${val.id}` : null;
      })
      .filter(Boolean);
    const dimKey = dimParts.join('|');

    // Get observation value (first obs, first value)
    const obsEntries = Object.entries(seriesData.observations ?? {});
    const value = obsEntries[0]?.[1]?.[0] ?? null;

    if (!result.has(regionCode)) result.set(regionCode, new Map());
    result.get(regionCode).set(dimKey, value);
  }

  return result;
}

/** Find value in a region's dim map where dimKey contains ALL given tokens. */
function find(regionMap, ...tokens) {
  if (!regionMap) return null;
  for (const [key, val] of regionMap) {
    const upper = key.toUpperCase();
    if (tokens.every(t => upper.includes(t.toUpperCase()))) {
      return val;
    }
  }
  return null;
}

/** Sum all values in a region's dim map where dimKey contains ANY of the given tokens. */
function sum(regionMap, ...tokens) {
  if (!regionMap) return null;
  let total = 0, found = false;
  for (const [key, val] of regionMap) {
    const upper = key.toUpperCase();
    if (tokens.some(t => upper.includes(t.toUpperCase()))) {
      total += val ?? 0;
      found = true;
    }
  }
  return found ? total : null;
}

// ─── Score calculation ────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function normalize(v, lo, hi) {
  if (v == null) return 50;
  return clamp(((v - lo) / (hi - lo)) * 100, 0, 100);
}
function gaussian(v, peak, sigma) {
  if (v == null) return 50;
  return 100 * Math.exp(-0.5 * ((v - peak) / sigma) ** 2);
}

const WEIGHTS = {
  income:    0.25,
  children:  0.15,
  ownership: 0.15,
  dwelling:  0.10,
  density:   0.10,
  elderly:   0.05,
  // internet competition removed (data not available in static tables used)
  // remaining 0.20 redistributed above
};
// Normalize weights to 1.0
const WEIGHT_TOTAL = Object.values(WEIGHTS).reduce((s, v) => s + v, 0);

function computeScore(d) {
  const income    = normalize(d.median_household_income_weekly, 600, 2500);
  const children  = clamp(d.households_with_children_pct ?? 40, 0, 100);
  const ownership = clamp((d.owned_outright_pct ?? 0) + (d.owned_mortgage_pct ?? 0), 0, 100);
  const dwelling  = clamp(d.separate_house_pct ?? 55, 0, 100);
  const density   = gaussian(d.population_density_per_sqkm, 500, 800);
  const elderly   = clamp(d.elderly_pct ?? 15, 0, 100);

  const rawScore =
    WEIGHTS.income    * income    +
    WEIGHTS.children  * children  +
    WEIGHTS.ownership * ownership +
    WEIGHTS.dwelling  * dwelling  +
    WEIGHTS.density   * density   +
    WEIGHTS.elderly   * elderly;

  const score = Math.round(rawScore / WEIGHT_TOTAL);

  return {
    opportunity_score:      clamp(score, 0, 100),
    income_component:       Math.round(income),
    children_component:     Math.round(children),
    ownership_component:    Math.round(ownership),
    dwelling_component:     Math.round(dwelling),
    density_component:      Math.round(density),
    elderly_component:      Math.round(elderly),
  };
}

// ─── Boundary fetch ───────────────────────────────────────────────────────────

async function fetchBoundaries() {
  const cacheFile = path.join(CACHE_DIR, 'sa4_boundaries.geojson');
  if (fs.existsSync(cacheFile)) {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < 7 * 24 * 60 * 60 * 1000) {
      process.stdout.write('  [cache] SA4 boundaries\n');
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  }

  // ABS ArcGIS REST API — field names are lowercase, outFields=* to get all
  const url = 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA4/MapServer/0/query' +
    '?where=1%3D1&outFields=*&f=geojson&geometryPrecision=4';

  process.stdout.write('  [fetch] SA4 boundaries (ABS ArcGIS)\n');
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Boundaries fetch failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`ArcGIS error: ${JSON.stringify(data.error)}`);

  fs.writeFileSync(cacheFile, JSON.stringify(data));
  return data;
}

// ─── State code → abbreviation ────────────────────────────────────────────────

const STATE_ABBREV = {
  '1': 'NSW', '2': 'VIC', '3': 'QLD', '4': 'SA',
  '5': 'WA', '6': 'TAS', '7': 'NT', '8': 'ACT', '9': 'OT',
};

// ─── Income bracket mapping ───────────────────────────────────────────────────
// G33 HIND codes → annual income brackets for display chart
// Weekly ranges mapped to annual ($0–$30k, $30k–$75k, $75k–$150k, $150k+)
const HIND_TO_BUCKET = {
  '1':   '$0–$30k',   // Negative/Nil income
  '2':   '$0–$30k',   // $1–$149/wk = up to ~$7.7k/yr
  '3':   '$0–$30k',   // $150–$299/wk = ~$7.8k–$15.5k/yr
  '4':   '$0–$30k',   // $300–$399/wk = ~$15.6k–$20.7k/yr
  '5':   '$0–$30k',   // $400–$499/wk = ~$20.8k–$25.9k/yr
  '6':   '$30k–$75k', // $500–$649/wk = ~$26k–$33.7k/yr
  '7':   '$30k–$75k', // $650–$799/wk = ~$33.8k–$41.5k/yr
  '8':   '$30k–$75k', // $800–$999/wk = ~$41.6k–$51.9k/yr
  '9':   '$30k–$75k', // $1,000–$1,249/wk = ~$52k–$64.9k/yr
  '10':  '$75k–$150k',// $1,250–$1,499/wk = ~$65k–$77.9k/yr
  '11':  '$75k–$150k',// $1,500–$1,749/wk = ~$78k–$90.9k/yr
  '12':  '$75k–$150k',// $1,750–$1,999/wk = ~$91k–$103.9k/yr
  '13':  '$75k–$150k',// $2,000–$2,499/wk = ~$104k–$129.9k/yr
  '14':  '$150k+',    // $2,500–$2,999/wk
  '15':  '$150k+',    // $3,000–$3,499/wk
  '16':  '$150k+',    // $3,500–$3,999/wk
  '17':  '$150k+',    // $4,000+/wk
};

const INCOME_BUCKET_ORDER = ['$0–$30k', '$30k–$75k', '$75k–$150k', '$150k+'];

// ─── Age bracket mapping for G01 PCHAR ───────────────────────────────────────
const AGE_PCHAR_CODES = {
  '0_4':  '0–4',
  '5_14': '5–14',
  '15_19':'15–19',
  '20_24':'20–24',
  '25_34':'25–34',
  '35_44':'35–44',
  '45_54':'45–54',
  '55_64':'55–64',
  '65_74':'65–74',
  '75_84':'75–84',
  'GE85': '85+',
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📡 Signal — building static data files...\n');

  // 1. Fetch SA4 boundaries
  console.log('▶ Fetching SA4 boundaries...');
  let boundaries;
  try {
    boundaries = await fetchBoundaries();
    const count = boundaries.features?.length ?? 0;
    console.log(`  ✓ ${count} SA4 features`);
    if (count === 0) throw new Error('No features returned');
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    process.exit(1);
  }

  // 2. Fetch ABS tables
  console.log('\n▶ Fetching ABS Census 2021 data...');

  // Key format per table:
  //   G01: SEXP.PCHAR.REGION.REGION_TYPE.STATE
  //   G02: MEDAVG.REGION.REGION_TYPE.STATE
  //   G32: FINF.FMCF.REGION.REGION_TYPE.STATE  (family income × family composition)
  //   G33: HIND.HHCD.REGION.REGION_TYPE.STATE  (household income × household composition)
  //   G37: TENLLD.STRD.REGION.REGION_TYPE.STATE (tenure × dwelling structure)

  const tables = {};

  // G01 — population total (SEXP=3=Persons, PCHAR=P_1=Total)
  try {
    const d = await fetchAbs('C21_G01_SA2', '3.P_1..SA4.');
    tables.pop = parseSdmx2Series(d);
    console.log(`  ✓ G01 Population (${tables.pop.size} regions)`);
  } catch (e) { console.warn('  ⚠ G01 Population:', e.message); tables.pop = new Map(); }

  // G01 — age distribution (SEXP=3=Persons, PCHAR=age brackets, all SA4)
  const ageKey = '3.' + Object.keys(AGE_PCHAR_CODES).join('+') + '..SA4.';
  try {
    const d = await fetchAbs('C21_G01_SA2', ageKey);
    tables.age = parseSdmx2Series(d);
    console.log(`  ✓ G01 Age distribution (${tables.age.size} regions)`);
  } catch (e) { console.warn('  ⚠ G01 Age:', e.message); tables.age = new Map(); }

  // G02 — medians: MEDAVG 1=age, 4=household income, 8=avg household size
  try {
    const d = await fetchAbs('C21_G02_SA2', '1+4+8..SA4.');
    tables.medians = parseSdmx2Series(d);
    console.log(`  ✓ G02 Medians (${tables.medians.size} regions)`);
  } catch (e) { console.warn('  ⚠ G02 Medians:', e.message); tables.medians = new Map(); }

  // G33 — household income distribution (HIND=all, HHCD=_T=total households)
  // Key: HIND.HHCD.REGION.REGION_TYPE.STATE → use HHCD=_T for all households
  try {
    const d = await fetchAbs('C21_G33_SA2', '._T..SA4.');
    tables.hhincome = parseSdmx2Series(d);
    console.log(`  ✓ G33 Household income (${tables.hhincome.size} regions)`);
  } catch (e) { console.warn('  ⚠ G33 Household income:', e.message); tables.hhincome = new Map(); }

  // G32 — family composition: FINF=_T (all incomes), FMCF values for with/without children
  try {
    const d = await fetchAbs('C21_G32_SA2', '_T...SA4.');
    tables.family = parseSdmx2Series(d);
    console.log(`  ✓ G32 Family composition (${tables.family.size} regions)`);
  } catch (e) { console.warn('  ⚠ G32 Family:', e.message); tables.family = new Map(); }

  // G37 — tenure type × dwelling structure
  try {
    const d = await fetchAbs('C21_G37_SA2', '...SA4.');
    tables.tenure = parseSdmx2Series(d);
    console.log(`  ✓ G37 Tenure + dwelling structure (${tables.tenure.size} regions)`);
  } catch (e) { console.warn('  ⚠ G37 Tenure:', e.message); tables.tenure = new Map(); }

  // 3. Join + compute scores
  console.log('\n▶ Joining data and computing scores...');

  let withData = 0;

  const features = boundaries.features
    .filter(f => {
      // Skip non-SA4 rows (e.g. "No usual address", "Migratory" with codes like 1RNSW)
      const code = f.properties?.sa4_code_2021 ?? '';
      return /^\d{3}$/.test(code);
    })
    .map(feature => {
      const props = feature.properties ?? {};
      const code = String(props.sa4_code_2021 ?? '').trim();
      const name = props.sa4_name_2021 ?? code;
      const stateCode = String(props.state_code_2021 ?? '');
      const areaSqkm = props.area_albers_sqkm ?? 0;

      const popMap    = tables.pop.get(code);
      const ageMap    = tables.age.get(code);
      const medMap    = tables.medians.get(code);
      const hhIncMap  = tables.hhincome.get(code);
      const famMap    = tables.family.get(code);
      const tenureMap = tables.tenure.get(code);

      // ── Population ──
      const population = popMap?.values().next().value ?? null;

      // ── Age distribution ──
      const ageDist = {};
      let youthTotal = 0, elderlyTotal = 0, ageTotal = 0;
      if (ageMap) {
        for (const [dimKey, val] of ageMap) {
          const pcharMatch = dimKey.match(/PCHAR=([^|]+)/);
          const pcharCode = pcharMatch?.[1];
          const label = AGE_PCHAR_CODES[pcharCode];
          if (label && val != null) {
            ageDist[label] = (ageDist[label] ?? 0) + val;
            ageTotal += val;
            if (['0–4','5–14','15–19'].includes(label)) youthTotal += val;
            if (['65–74','75–84','85+'].includes(label)) elderlyTotal += val;
          }
        }
      }
      const youthPct  = ageTotal > 0 ? (youthTotal / ageTotal) * 100 : null;
      const elderlyPct = ageTotal > 0 ? (elderlyTotal / ageTotal) * 100 : null;
      const ageDistFinal = Object.keys(ageDist).length > 0 ? ageDist : null;

      // ── Medians ──
      const medianAge           = find(medMap, 'MEDAVG=1') ?? null;
      const medianHhIncomeWkly  = find(medMap, 'MEDAVG=4') ?? null;
      const avgHouseholdSize    = find(medMap, 'MEDAVG=8') ?? null;

      // ── Household income distribution ──
      const incomeRaw = {};
      let hhIncTotal = 0;
      if (hhIncMap) {
        for (const [dimKey, val] of hhIncMap) {
          const hindMatch = dimKey.match(/HIND=(\d+)/);
          const hindCode = hindMatch?.[1];
          const bucket = HIND_TO_BUCKET[hindCode];
          if (bucket && val != null) {
            incomeRaw[bucket] = (incomeRaw[bucket] ?? 0) + val;
            hhIncTotal += val;
          }
        }
      }
      const incomeDist = hhIncTotal > 0
        ? Object.fromEntries(
            INCOME_BUCKET_ORDER.map(b => [b, Math.round(((incomeRaw[b] ?? 0) / hhIncTotal) * 100)])
          )
        : null;

      // ── Family composition (households with children) ──
      // G32: FINF=_T (all incomes), FMCF=_T=total families, FMCF=2=couple+children, FMCF=3=one parent
      const totalFamilies = find(famMap, 'FMCF=_T') ?? null;
      const coupleWithKids = find(famMap, 'FMCF=2') ?? 0;
      const singleParent   = find(famMap, 'FMCF=3') ?? 0;
      const familiesWithChildren = coupleWithKids + singleParent;
      const householdsWithChildrenPct = totalFamilies
        ? (familiesWithChildren / totalFamilies) * 100 : null;

      // ── Tenure + Dwelling structure (G37) ──
      // Key dims: TENLLD.STRD → from parseSdmx2Series, dimKey = "TENLLD=X|STRD=Y"
      const totalTenureCount  = find(tenureMap, 'TENLLD=_T', 'STRD=_T') ?? null;
      const ownedOutrightCount = find(tenureMap, 'TENLLD=1',   'STRD=_T') ?? null;
      const ownedMortgageCount = find(tenureMap, 'TENLLD=2',   'STRD=_T') ?? null;
      const rentedTotalCount   = find(tenureMap, 'TENLLD=R_T', 'STRD=_T') ?? null;
      const separateHouseCount = find(tenureMap, 'TENLLD=_T',  'STRD=11') ?? null;
      const semiDetachedCount  = find(tenureMap, 'TENLLD=_T',  'STRD=2')  ?? null;
      const apartmentCount     = find(tenureMap, 'TENLLD=_T',  'STRD=3')  ?? null;

      const ownedOutrightPct = totalTenureCount ? (ownedOutrightCount / totalTenureCount) * 100 : null;
      const ownedMortgagePct = totalTenureCount ? (ownedMortgageCount / totalTenureCount) * 100 : null;
      const rentingPct       = totalTenureCount ? (rentedTotalCount   / totalTenureCount) * 100 : null;
      const separateHousePct = totalTenureCount ? (separateHouseCount / totalTenureCount) * 100 : null;
      const semiDetachedPct  = totalTenureCount ? (semiDetachedCount  / totalTenureCount) * 100 : null;
      const apartmentPct     = totalTenureCount ? (apartmentCount     / totalTenureCount) * 100 : null;

      // Dwelling count from tenure totals (total private dwellings)
      const dwellingCount = totalTenureCount;

      // ── Derived ──
      const popDensity = population != null && areaSqkm > 0 ? population / areaSqkm : null;

      // Lower-income estimate: $0–$30k + ~45% of $30k–$75k bucket
      const lowerIncomePct = incomeDist
        ? Math.round(clamp(
            (incomeDist['$0–$30k'] ?? 0) + Math.round((incomeDist['$30k–$75k'] ?? 0) * 0.45),
            0, 100
          ))
        : null;

      const round1 = v => v != null ? Math.round(v * 10) / 10 : null;

      if (population != null) withData++;

      const demographics = {
        population:                          population ? Math.round(population) : null,
        dwelling_count:                      dwellingCount ? Math.round(dwellingCount) : null,
        median_household_income_weekly:      medianHhIncomeWkly ? Math.round(medianHhIncomeWkly) : null,
        median_age:                          round1(medianAge),
        avg_household_size:                  round1(avgHouseholdSize),
        households_with_children_pct:        round1(householdsWithChildrenPct),
        separate_house_pct:                  round1(separateHousePct),
        semi_detached_pct:                   round1(semiDetachedPct),
        apartment_pct:                       round1(apartmentPct),
        owned_outright_pct:                  round1(ownedOutrightPct),
        owned_mortgage_pct:                  round1(ownedMortgagePct),
        renting_pct:                         round1(rentingPct),
        youth_pct:                           round1(youthPct),
        elderly_pct:                         round1(elderlyPct),
        population_density_per_sqkm:         popDensity ? Math.round(popDensity * 10) / 10 : null,
        area_sqkm:                           areaSqkm ? Math.round(areaSqkm) : null,
        lower_income_pct:                    lowerIncomePct,
        age_distribution:                    ageDistFinal,
        income_distribution:                 incomeDist,
      };

      const scores = computeScore(demographics);

      return {
        ...feature,
        properties: {
          id: code,
          name,
          state_code: STATE_ABBREV[stateCode] ?? stateCode,
          type: 'sa4',
          ...demographics,
          ...scores,
        },
      };
    });

  // 4. Write sa4.geojson
  const geojson = { type: 'FeatureCollection', features };
  fs.writeFileSync(path.join(DATA_DIR, 'sa4.geojson'), JSON.stringify(geojson));
  console.log(`  ✓ Written public/data/sa4.geojson (${features.length} features)`);

  // 5. Write regions.json (flat index, no geometry)
  const regions = features.map(f => {
    const p = f.properties;
    const coords = collectCoords(f.geometry);
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const c of coords) { if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1]; if (c[0] < minLng) minLng = c[0]; if (c[0] > maxLng) maxLng = c[0]; }
    const clat = isFinite(minLat) ? (minLat + maxLat) / 2 : 0;
    const clng = isFinite(minLng) ? (minLng + maxLng) / 2 : 0;
    return {
      id: p.id,
      name: p.name,
      state_code: p.state_code,
      type: p.type,
      opportunity_score: p.opportunity_score,
      centroid_lat: Math.round(clat * 10000) / 10000,
      centroid_lng: Math.round(clng * 10000) / 10000,
    };
  }).sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0));

  fs.writeFileSync(path.join(DATA_DIR, 'regions.json'), JSON.stringify(regions, null, 2));
  console.log(`  ✓ Written public/data/regions.json (${regions.length} regions)`);

  console.log(`\n✅ Done! ${features.length} SA4 regions, ${withData} with demographic data\n`);
}

function collectCoords(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.flat();
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
  return [];
}

main().catch(err => {
  console.error('\n❌ Build failed:', err);
  process.exit(1);
});
