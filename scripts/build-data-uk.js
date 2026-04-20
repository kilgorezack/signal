/**
 * Signal — UK Data Build Script
 *
 * Fetches ONS Census 2021 data for England + Wales (LAD level) and writes:
 *   public/data/uk-lad.geojson          — residential GeoJSON with opportunity scores
 *   public/data/uk-business-lad.geojson — business GeoJSON with SmartBiz scores
 *   public/data/uk-regions.json         — flat region index (sorted by score)
 *
 * Data sources:
 *   Boundaries : ONS Open Geography Portal (ArcGIS REST)
 *   Census data: ONS Census 2021 API (api.beta.ons.gov.au/v1) — CSV downloads
 *
 * ONS Census 2021 tables:
 *   TS007A — Age by 5-year groups → population + age distribution
 *   TS038  — Tenure of household → owned / rented split
 *   TS044  — Accommodation type → detached / semi / terraced / flat
 *   TS062  — NS-SeC → socioeconomic proxy used for income scoring
 *   TS060  — Industry (current) → UK SIC 2007 section breakdown
 *
 * Geographic coverage: England + Wales only (ONS Census 2021 scope)
 *   E06*, E07*, E08*, E09* = English LADs (unitary, district, metro, London)
 *   W06* = Welsh principal areas
 *
 * NOTE: median_household_income_weekly is not collected in the UK Census.
 *   professional_pct (NS-SeC classes 1+2 %) is used as the income component
 *   in scoring, and income_distribution shows NS-SeC socioeconomic tiers.
 *
 * Run: node scripts/build-data-uk.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DATA_DIR  = path.join(ROOT, 'public', 'data');
const CACHE_DIR = path.join(ROOT, '.ons-cache');

fs.mkdirSync(DATA_DIR,  { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

// ─── ONS API helpers ──────────────────────────────────────────────────────────

const ONS_BASE     = 'https://api.beta.ons.gov.uk/v1';
const ONS_GEO_BASE = 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services';

/** Fetch ONS Census 2021 table as full CSV (cached 7 days). */
async function fetchOnsTableCsv(datasetId) {
  const cacheFile = path.join(CACHE_DIR, `${datasetId}.csv`);
  if (fs.existsSync(cacheFile)) {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < 7 * 24 * 60 * 60 * 1000) {
      process.stdout.write(`  [cache] ONS ${datasetId}\n`);
      return fs.readFileSync(cacheFile, 'utf8');
    }
  }

  // Discover latest version
  process.stdout.write(`  [discover] ONS ${datasetId} versions...\n`);
  const versRes = await fetch(
    `${ONS_BASE}/datasets/${datasetId}/editions/2021/versions`,
    { signal: AbortSignal.timeout(30_000) }
  );
  if (!versRes.ok) throw new Error(`ONS version lookup for ${datasetId}: ${versRes.status}`);
  const versData = await versRes.json();
  const items = versData.items ?? [];
  if (!items.length) throw new Error(`No versions for ONS dataset ${datasetId}`);
  const latestVersion = Math.max(...items.map(v => Number(v.version ?? 1)));

  const csvUrl = `${ONS_BASE}/datasets/${datasetId}/editions/2021/versions/${latestVersion}/csv`;
  process.stdout.write(`  [fetch] ${csvUrl}\n`);

  const res = await fetch(csvUrl, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`ONS CSV ${datasetId} v${latestVersion}: ${res.status} ${res.statusText}`);

  const text = await res.text();
  fs.writeFileSync(cacheFile, text);
  process.stdout.write(`  ✓ ${datasetId}: ${(text.length / 1024).toFixed(0)} KB\n`);
  return text;
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur.trim());
  return cols;
}

/** True for 9-character England or Wales LAD codes. */
function isEngWalesLad(code) {
  if (!code || code.length !== 9) return false;
  return code.startsWith('E06') || code.startsWith('E07') ||
         code.startsWith('E08') || code.startsWith('E09') ||
         code.startsWith('W06');
}

/**
 * Parse an ONS Census 2021 full-UK CSV into Map<geoCode, Map<categoryName, value>>.
 * ONS CSV structure: geography_code, geography_name, [cat_code_col], [cat_name_col], obs
 * Filters to England + Wales LADs only.
 */
function parseOnsCsv(csvText) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) throw new Error('Empty CSV');

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/"/g, '').trim());
  const geoIdx = headers.indexOf('geography_code');
  const obsIdx = headers.indexOf('obs');
  if (geoIdx === -1 || obsIdx === -1) {
    throw new Error(`CSV missing required columns. Got: ${headers.slice(0, 8).join(', ')}`);
  }
  // ONS format: ...code_col, name_col, obs → name column is immediately before obs
  const catNameIdx = obsIdx - 1;

  const result = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols    = parseCsvLine(line);
    const geoCode = (cols[geoIdx] ?? '').replace(/"/g, '');
    if (!isEngWalesLad(geoCode)) continue;
    const value   = parseFloat(cols[obsIdx]);
    if (isNaN(value)) continue;
    const catName = (cols[catNameIdx] ?? '').replace(/"/g, '').toLowerCase().trim();
    if (!result.has(geoCode)) result.set(geoCode, new Map());
    const m = result.get(geoCode);
    m.set(catName, (m.get(catName) ?? 0) + value);
  }
  return result;
}

// ─── Boundary + region lookup ─────────────────────────────────────────────────

// ONS Geography Portal service name candidates for LAD Dec 2021 boundaries.
// Tried in order; first successful response wins.
const BOUNDARY_CANDIDATES = [
  // BGC = Generalised Clipped (preferred: smaller file)
  `${ONS_GEO_BASE}/Local_Authority_Districts_December_2021_UK_BGC/FeatureServer/0/query`,
  // BFC = Full Clipped (fallback)
  `${ONS_GEO_BASE}/Local_Authority_Districts_December_2021_UK_BFC/FeatureServer/0/query`,
  // BUC = Ultra-generalised (last resort)
  `${ONS_GEO_BASE}/Local_Authority_Districts_December_2021_UK_BUC/FeatureServer/0/query`,
];

async function fetchUkBoundaries() {
  const cacheFile = path.join(CACHE_DIR, 'lad_boundaries.geojson');
  if (fs.existsSync(cacheFile)) {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < 7 * 24 * 60 * 60 * 1000) {
      process.stdout.write('  [cache] LAD boundaries\n');
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  }

  // Note: maxAllowableOffset is not valid for FeatureServer — omit it.
  // Use specific outFields to avoid schema-mismatch 400 errors.
  const QS = '?where=1%3D1&outFields=LAD21CD,LAD21NM,Shape__Area&f=geojson&geometryPrecision=3&resultRecordCount=500';

  let lastErr;
  for (const base of BOUNDARY_CANDIDATES) {
    const url = base + QS;
    process.stdout.write(`  [fetch] ${url}\n`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const data = await res.json();
      if (data.error) { lastErr = new Error(`ArcGIS: ${JSON.stringify(data.error)}`); continue; }
      if ((data.features?.length ?? 0) === 0) { lastErr = new Error('0 features'); continue; }
      fs.writeFileSync(cacheFile, JSON.stringify(data));
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('All boundary candidates failed');
}

const RGN_ABBREV = {
  'North East':                 'NE',
  'North West':                 'NW',
  'Yorkshire and The Humber':   'YH',
  'East Midlands':              'EM',
  'West Midlands':              'WM',
  'East of England':            'EE',
  'London':                     'LON',
  'South East':                 'SE',
  'South West':                 'SW',
};

/** Returns Map<LAD21CD, regionAbbrev> for English LADs. */
async function fetchLadRegionMap() {
  const cacheFile = path.join(CACHE_DIR, 'lad_region_lookup.json');
  if (fs.existsSync(cacheFile)) {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < 30 * 24 * 60 * 60 * 1000) {
      process.stdout.write('  [cache] LAD→Region lookup\n');
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  }

  const url =
    `${ONS_GEO_BASE}/LAD21_RGN21_EN_LU/FeatureServer/0/query` +
    `?where=1%3D1&outFields=LAD21CD,RGN21NM&f=json&resultRecordCount=500`;

  process.stdout.write('  [fetch] LAD→Region lookup\n');
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`LAD region lookup: ${res.status}`);
  const data = await res.json();

  const map = {};
  for (const feat of data.features ?? []) {
    const a = feat.attributes ?? feat;
    if (a.LAD21CD && a.RGN21NM) {
      map[a.LAD21CD] = RGN_ABBREV[a.RGN21NM] ?? a.RGN21NM.slice(0, 6);
    }
  }

  fs.writeFileSync(cacheFile, JSON.stringify(map));
  return map;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

/** Sum values whose category name contains any of the given substrings. */
function sumByName(catMap, ...substrings) {
  if (!catMap) return null;
  let total = 0, found = false;
  for (const [name, val] of catMap) {
    if (substrings.some(s => name.includes(s))) { total += val ?? 0; found = true; }
  }
  return found ? total : null;
}

// ─── Age group mappings ───────────────────────────────────────────────────────

const AGE_GROUPS = [
  { label: '0–4',   subs: ['4 years and under', '0 to 4'] },
  { label: '5–9',   subs: ['5 to 9'] },
  { label: '10–14', subs: ['10 to 14'] },
  { label: '15–19', subs: ['15 to 19'] },
  { label: '20–24', subs: ['20 to 24'] },
  { label: '25–29', subs: ['25 to 29'] },
  { label: '30–34', subs: ['30 to 34'] },
  { label: '35–39', subs: ['35 to 39'] },
  { label: '40–44', subs: ['40 to 44'] },
  { label: '45–49', subs: ['45 to 49'] },
  { label: '50–54', subs: ['50 to 54'] },
  { label: '55–59', subs: ['55 to 59'] },
  { label: '60–64', subs: ['60 to 64'] },
  { label: '65–69', subs: ['65 to 69'] },
  { label: '70–74', subs: ['70 to 74'] },
  { label: '75–79', subs: ['75 to 79'] },
  { label: '80–84', subs: ['80 to 84'] },
  { label: '85+',   subs: ['85 and over', '85 years and over'] },
];
const YOUTH_LABELS   = new Set(['0–4', '5–9', '10–14', '15–19']);
const ELDERLY_LABELS = new Set(['65–69', '70–74', '75–79', '80–84', '85+']);

// ─── UK SIC 2007 sections ─────────────────────────────────────────────────────

const UK_SIC_SECTIONS = {
  A: 'Agriculture, Forestry & Fishing',
  B: 'Mining & Quarrying',
  C: 'Manufacturing',
  D: 'Electricity, Gas & Steam Supply',
  E: 'Water Supply & Waste',
  F: 'Construction',
  G: 'Wholesale & Retail Trade',
  H: 'Transportation & Storage',
  I: 'Accommodation & Food Service',
  J: 'Information & Communication',
  K: 'Financial & Insurance',
  L: 'Real Estate',
  M: 'Professional, Scientific & Technical',
  N: 'Administrative & Support',
  O: 'Public Administration & Defence',
  P: 'Education',
  Q: 'Human Health & Social Work',
  R: 'Arts, Entertainment & Recreation',
  S: 'Other Service Activities',
  T: 'Households as Employers',
  U: 'Extraterritorial Activities',
};

// Broadband demand intensity per UK SIC section (0–1)
const UK_SIC_BW_WEIGHTS = {
  J: 1.00, K: 0.95, M: 0.90, Q: 0.85, P: 0.70, N: 0.65,
  L: 0.60, G: 0.55, C: 0.50, I: 0.45, O: 0.40, R: 0.35,
  S: 0.35, H: 0.30, F: 0.30, D: 0.20, E: 0.20, B: 0.15,
  A: 0.10, T: 0.10, U: 0.05,
};

/**
 * Extract UK SIC section letter from an ONS industry category name.
 * ONS TS060 format: "A : Agriculture, forestry and fishing"
 */
function extractSicSection(name) {
  const m = name.match(/^([a-u])\s*[:\-–]/i);
  if (m) return m[1].toUpperCase();
  // Fallback: match known section names
  for (const [code, label] of Object.entries(UK_SIC_SECTIONS)) {
    if (name.includes(label.toLowerCase().slice(0, 10))) return code;
  }
  return null;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function normalize(v, lo, hi) {
  if (v == null) return 50;
  return clamp(((v - lo) / (hi - lo)) * 100, 0, 100);
}

const UK_RES_WEIGHTS = {
  income: 0.25, children: 0.15, ownership: 0.15,
  dwelling: 0.10, density: 0.10, elderly: 0.05,
};
const UK_RES_W_TOTAL = Object.values(UK_RES_WEIGHTS).reduce((s, v) => s + v, 0);

function computeUkOpportunityScore(d) {
  // Income proxy: % in NS-SeC classes 1+2 (professional/managerial)
  // UK LAD range roughly 10–60% → normalize accordingly
  const income    = normalize(d.professional_pct, 10, 55);
  const children  = clamp(d.households_with_children_pct ?? 35, 0, 100);
  const ownership = clamp((d.owned_outright_pct ?? 0) + (d.owned_mortgage_pct ?? 0), 0, 100);
  // Detached + semi-detached: good ISP prospects vs flats/terraces
  const dwelling  = clamp((d.detached_pct ?? 0) + (d.semi_detached_pct ?? 0), 0, 100);
  // UK cities are denser than AU; cap normalization at 2000/km²
  const density   = normalize(d.population_density_per_sqkm, 0, 2000);
  const elderly   = clamp(d.elderly_pct ?? 17, 0, 100);

  const rawScore =
    UK_RES_WEIGHTS.income    * income    +
    UK_RES_WEIGHTS.children  * children  +
    UK_RES_WEIGHTS.ownership * ownership +
    UK_RES_WEIGHTS.dwelling  * dwelling  +
    UK_RES_WEIGHTS.density   * density   +
    UK_RES_WEIGHTS.elderly   * elderly;

  return {
    opportunity_score:   clamp(Math.round(rawScore / UK_RES_W_TOTAL), 0, 100),
    income_component:    Math.round(income),
    children_component:  Math.round(children),
    ownership_component: Math.round(ownership),
    dwelling_component:  Math.round(dwelling),
    density_component:   Math.round(density),
    elderly_component:   Math.round(elderly),
  };
}

function computeUkBizScore(d) {
  const total = d.working_population ?? 0;
  const dist  = d.industry_distribution ?? {};

  let industryScore = 50;
  if (total > 0) {
    let weighted = 0;
    for (const [code, count] of Object.entries(dist)) {
      weighted += (count / total) * (UK_SIC_BW_WEIGHTS[code] ?? 0.35);
    }
    industryScore = weighted * 100;
  }

  const wpDensityScore = normalize(d.working_pop_density, 0, 400);

  const highValue    = (dist.J ?? 0) + (dist.K ?? 0) + (dist.M ?? 0) + (dist.Q ?? 0);
  const hvPct        = total > 0 ? (highValue / total) * 100 : 0;
  const highValueScore = normalize(hvPct, 0, 45);

  const bizDensityScore = d.business_density != null
    ? normalize(d.business_density, 0, 40) : wpDensityScore;

  const BW       = { industry: 0.35, wpDensity: 0.25, highValue: 0.25, bizDensity: 0.15 };
  const BW_TOTAL = Object.values(BW).reduce((s, v) => s + v, 0);

  const rawScore =
    BW.industry   * industryScore   +
    BW.wpDensity  * wpDensityScore  +
    BW.highValue  * highValueScore  +
    BW.bizDensity * bizDensityScore;

  return {
    smartbiz_score:         clamp(Math.round(rawScore / BW_TOTAL), 0, 100),
    industry_mix_component: Math.round(industryScore),
    wp_density_component:   Math.round(wpDensityScore),
    high_value_component:   Math.round(highValueScore),
    biz_density_component:  Math.round(bizDensityScore),
  };
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

function collectCoords(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon')      return geometry.coordinates.flat();
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
  return [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🇬🇧 Signal — building UK data files (England + Wales)...\n');

  // ── 1. Boundaries ──────────────────────────────────────────────────────────
  console.log('▶ Fetching UK LAD boundaries...');
  let boundaries;
  try {
    boundaries = await fetchUkBoundaries();
    const count = boundaries.features?.length ?? 0;
    console.log(`  ✓ ${count} LAD boundary features`);
    if (count === 0) throw new Error('No features returned');
  } catch (err) {
    console.error(`  ✗ Boundary fetch failed: ${err.message}`);
    console.error('  ⚠ UK data files will not be generated this build.');
    console.error('    Run "npm run build:data:uk" locally to generate them.\n');
    process.exit(0); // non-fatal — AU data is still valid
  }

  // ── 2. Region lookup (England only; Wales = WLS) ───────────────────────────
  console.log('\n▶ Fetching LAD → Region lookup...');
  let ladRegionMap = {};
  try {
    ladRegionMap = await fetchLadRegionMap();
    console.log(`  ✓ ${Object.keys(ladRegionMap).length} English LAD → Region mappings`);
  } catch (err) {
    console.warn(`  ⚠ Region lookup failed (continuing without): ${err.message}`);
  }

  // ── 3. ONS Census 2021 tables ──────────────────────────────────────────────
  console.log('\n▶ Fetching ONS Census 2021 tables...');
  const tables = {};
  const TABLE_IDS = [
    ['TS007A', 'age'],
    ['TS038',  'tenure'],
    ['TS044',  'accommodation'],
    ['TS062',  'nssec'],
    ['TS060',  'industry'],
  ];

  for (const [datasetId, key] of TABLE_IDS) {
    try {
      const csv = await fetchOnsTableCsv(datasetId);
      tables[key] = parseOnsCsv(csv);
      console.log(`  ✓ ${datasetId} (${key}): ${tables[key].size} E+W LADs`);
    } catch (err) {
      console.warn(`  ⚠ ${datasetId}: ${err.message}`);
      tables[key] = new Map();
    }
  }

  // ── 4. Filter boundaries to E+W LADs ──────────────────────────────────────
  const ewFeatures = (boundaries.features ?? []).filter(f =>
    isEngWalesLad(f.properties?.LAD21CD ?? '')
  );
  console.log(`\n▶ Building GeoJSON for ${ewFeatures.length} England+Wales LADs...`);

  let resWithData = 0;

  // ── 5. Residential features ────────────────────────────────────────────────
  const residentialFeatures = ewFeatures.map(feature => {
    const props    = feature.properties ?? {};
    const code     = String(props.LAD21CD ?? '').trim();
    const name     = props.LAD21NM ?? code;
    const region   = ladRegionMap[code] ?? (code.startsWith('W') ? 'WLS' : '??');
    // Shape__Area is in m² (British National Grid) — divide by 1e6 for km²
    const areaSqkm = (props.Shape__Area ?? 0) / 1_000_000;

    const ageMap   = tables.age?.get(code);
    const tenMap   = tables.tenure?.get(code);
    const accMap   = tables.accommodation?.get(code);
    const nsMap    = tables.nssec?.get(code);

    // ── Population + age distribution ──
    let population = 0;
    const ageDist  = {};
    let youthTotal = 0, elderlyTotal = 0;

    for (const { label, subs } of AGE_GROUPS) {
      const count = sumByName(ageMap, ...subs) ?? 0;
      ageDist[label] = count;
      population    += count;
      if (YOUTH_LABELS.has(label))   youthTotal   += count;
      if (ELDERLY_LABELS.has(label)) elderlyTotal += count;
    }

    const youthPct   = population > 0 ? (youthTotal   / population) * 100 : null;
    const elderlyPct = population > 0 ? (elderlyTotal / population) * 100 : null;
    // Estimated households with children: youth fraction × 1.35
    const hhWithChildrenPct = youthPct != null ? Math.min(70, youthPct * 1.35) : null;

    // ── Tenure ──
    const ownedOutright = sumByName(tenMap, 'owned: outright', 'owned outright') ?? 0;
    const ownedMortgage = sumByName(tenMap,
      'owned: with a mortgage', 'owned with a mortgage', 'shared ownership') ?? 0;
    const socialRented  = sumByName(tenMap, 'social rented') ?? 0;
    const privateRented = sumByName(tenMap, 'private rented') ?? 0;
    const tenureTotal   = sumByName(tenMap, 'total', 'all tenures') ??
      (ownedOutright + ownedMortgage + socialRented + privateRented);

    const ownedOutrightPct = tenureTotal > 0 ? (ownedOutright / tenureTotal) * 100 : null;
    const ownedMortgagePct = tenureTotal > 0 ? (ownedMortgage / tenureTotal) * 100 : null;
    const rentingPct       = tenureTotal > 0
      ? ((socialRented + privateRented) / tenureTotal) * 100 : null;
    const dwellingCount    = tenureTotal > 0 ? Math.round(tenureTotal) : null;

    // ── Accommodation type ──
    const detached     = sumByName(accMap, 'detached') ?? 0;
    const semiDetached = sumByName(accMap, 'semi-detached') ?? 0;
    const terraced     = sumByName(accMap, 'terraced') ?? 0;
    const flat         = sumByName(accMap, 'flat', 'maisonette', 'apartment') ?? 0;
    const accTotal     = detached + semiDetached + terraced + flat;

    const detachedPct     = accTotal > 0 ? (detached     / accTotal) * 100 : null;
    const semiDetachedPct = accTotal > 0 ? (semiDetached / accTotal) * 100 : null;
    const terracedPct     = accTotal > 0 ? (terraced     / accTotal) * 100 : null;
    const apartmentPct    = accTotal > 0 ? (flat         / accTotal) * 100 : null;

    // ── NS-SeC socioeconomic proxy ──
    const higherProf   = sumByName(nsMap, 'higher managerial', 'large employers and higher') ?? 0;
    const lowerProf    = sumByName(nsMap, 'lower managerial', 'lower professional') ?? 0;
    const intermediate = sumByName(nsMap, 'intermediate occupations') ?? 0;
    const smallEmp     = sumByName(nsMap, 'small employers', 'own account') ?? 0;
    const lowerSuper   = sumByName(nsMap, 'lower supervisory') ?? 0;
    const semiRoutine  = sumByName(nsMap, 'semi-routine') ?? 0;
    const routine      = sumByName(nsMap, 'routine occupations', 'routine and manual') ?? 0;
    const neverWorked  = sumByName(nsMap, 'never worked', 'long-term unemployed') ?? 0;
    const nsTotal      = higherProf + lowerProf + intermediate + smallEmp +
                         lowerSuper + semiRoutine + routine + neverWorked;

    const professionalPct = nsTotal > 0 ? ((higherProf + lowerProf) / nsTotal) * 100 : null;

    // Income distribution analog (NS-SeC tiers) — used by RegionPanel income chart
    const incDist = nsTotal > 0 ? {
      'Routine/Semi-routine':   Math.round(((semiRoutine + routine + neverWorked) / nsTotal) * 100),
      'Intermediate':            Math.round(((intermediate + smallEmp + lowerSuper) / nsTotal) * 100),
      'Professional/Managerial': Math.round(((higherProf + lowerProf) / nsTotal) * 100),
    } : null;

    // ── Derived ──
    const popDensity       = population > 0 && areaSqkm > 0 ? population / areaSqkm : null;
    const avgHouseholdSize = dwellingCount && population > 0 ? population / dwellingCount : null;
    const r1               = v => v != null ? Math.round(v * 10) / 10 : null;

    if (population > 0) resWithData++;

    const demographics = {
      population:                   population > 0 ? Math.round(population) : null,
      dwelling_count:               dwellingCount,
      // Income: not collected in UK Census — professional_pct used for scoring instead
      median_household_income_weekly: null,
      professional_pct:             r1(professionalPct),
      median_age:                   null,
      avg_household_size:           r1(avgHouseholdSize),
      households_with_children_pct: r1(hhWithChildrenPct),
      detached_pct:                 r1(detachedPct),
      semi_detached_pct:            r1(semiDetachedPct),
      terraced_pct:                 r1(terracedPct),
      apartment_pct:                r1(apartmentPct),
      separate_house_pct:           r1(detachedPct), // AU-compatible field → detached
      owned_outright_pct:           r1(ownedOutrightPct),
      owned_mortgage_pct:           r1(ownedMortgagePct),
      renting_pct:                  r1(rentingPct),
      youth_pct:                    r1(youthPct),
      elderly_pct:                  r1(elderlyPct),
      population_density_per_sqkm:  popDensity ? Math.round(popDensity * 10) / 10 : null,
      area_sqkm:                    areaSqkm > 0 ? Math.round(areaSqkm) : null,
      lower_income_pct:             incDist?.['Routine/Semi-routine'] ?? null,
      age_distribution:             Object.values(ageDist).some(v => v > 0) ? ageDist : null,
      income_distribution:          incDist,
    };

    const scores = computeUkOpportunityScore(demographics);

    return {
      ...feature,
      properties: {
        id: code, name, state_code: region, type: 'lad', market: 'uk',
        ...demographics,
        ...scores,
      },
    };
  });

  // ── Write uk-lad.geojson ──
  fs.writeFileSync(
    path.join(DATA_DIR, 'uk-lad.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: residentialFeatures })
  );
  console.log(`  ✓ Written public/data/uk-lad.geojson (${residentialFeatures.length} features, ${resWithData} with data)`);

  // ── Write uk-regions.json ──
  const regions = residentialFeatures.map(f => {
    const p      = f.properties;
    const coords = collectCoords(f.geometry);
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const c of coords) {
      if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
      if (c[0] < minLng) minLng = c[0]; if (c[0] > maxLng) maxLng = c[0];
    }
    return {
      id: p.id, name: p.name, state_code: p.state_code,
      type: p.type, market: 'uk',
      opportunity_score: p.opportunity_score,
      centroid_lat: isFinite(minLat) ? Math.round(((minLat + maxLat) / 2) * 10000) / 10000 : 0,
      centroid_lng: isFinite(minLng) ? Math.round(((minLng + maxLng) / 2) * 10000) / 10000 : 0,
    };
  }).sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0));

  fs.writeFileSync(
    path.join(DATA_DIR, 'uk-regions.json'),
    JSON.stringify(regions, null, 2)
  );
  console.log(`  ✓ Written public/data/uk-regions.json (${regions.length} regions)`);

  // ── 6. Business features ───────────────────────────────────────────────────
  console.log('\n▶ Building uk-business-lad.geojson...');
  let bizWithData = 0;

  const businessFeatures = ewFeatures.map(feature => {
    const props    = feature.properties ?? {};
    const code     = String(props.LAD21CD ?? '').trim();
    const name     = props.LAD21NM ?? code;
    const region   = ladRegionMap[code] ?? (code.startsWith('W') ? 'WLS' : '??');
    const areaSqkm = (props.Shape__Area ?? 0) / 1_000_000;

    const indMap = tables.industry?.get(code);

    // ── Industry distribution (UK SIC sections) ──
    const industryDist = {};
    let workingPop     = 0;

    if (indMap) {
      for (const [catName, val] of indMap) {
        if (catName.includes('total') || catName.includes('all categories')) continue;
        const section = extractSicSection(catName);
        if (section && UK_SIC_SECTIONS[section] && val != null) {
          industryDist[section] = (industryDist[section] ?? 0) + val;
          workingPop            += val;
        }
      }
    }

    // Use 'total' category if available; else sum of sections
    const rawTotal = sumByName(indMap, 'total', 'all categories') ?? workingPop;
    const totalWP  = rawTotal > 0 ? rawTotal : workingPop;

    const industryPcts = {};
    if (totalWP > 0) {
      for (const [sec, cnt] of Object.entries(industryDist)) {
        industryPcts[sec] = Math.round((cnt / totalWP) * 1000) / 10;
      }
    }

    const highValue = (industryDist.J ?? 0) + (industryDist.K ?? 0) +
                      (industryDist.M ?? 0) + (industryDist.Q ?? 0);
    const r1  = v => v != null ? Math.round(v * 10) / 10 : null;
    const pct = n => totalWP > 0 ? r1((n / totalWP) * 100) : null;

    const knowledgeWorkerPct      = pct(highValue + (industryDist.P ?? 0));
    const healthcarePct           = pct(industryDist.Q ?? 0);
    const professionalServicesPct = pct(industryDist.M ?? 0);
    const finTechPct              = pct((industryDist.J ?? 0) + (industryDist.K ?? 0));
    const constructionPct         = pct(industryDist.F ?? 0); // UK SIC F = Construction
    const retailPct               = pct(industryDist.G ?? 0); // UK SIC G = Wholesale & Retail

    const wpDensity = totalWP > 0 && areaSqkm > 0
      ? Math.round((totalWP / areaSqkm) * 10) / 10 : null;

    if (totalWP > 0) bizWithData++;

    const businessData = {
      working_population:        totalWP > 0 ? Math.round(totalWP) : null,
      working_pop_density:       wpDensity,
      industry_distribution:     Object.keys(industryDist).length > 0 ? industryDist : null,
      industry_pcts:             Object.keys(industryPcts).length > 0 ? industryPcts : null,
      knowledge_worker_pct:      knowledgeWorkerPct,
      healthcare_pct:            healthcarePct,
      professional_services_pct: professionalServicesPct,
      finance_tech_pct:          finTechPct,
      construction_pct:          constructionPct,
      retail_pct:                retailPct,
      total_businesses:          null, // not in ONS Census 2021
      business_density:          null,
      business_size_dist:        null,
      area_sqkm:                 areaSqkm > 0 ? Math.round(areaSqkm) : null,
    };

    const scores = computeUkBizScore(businessData);

    return {
      ...feature,
      properties: {
        id: code, name, state_code: region, type: 'lad', market: 'uk',
        ...businessData,
        ...scores,
      },
    };
  });

  fs.writeFileSync(
    path.join(DATA_DIR, 'uk-business-lad.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: businessFeatures })
  );
  console.log(`  ✓ Written public/data/uk-business-lad.geojson (${businessFeatures.length} features, ${bizWithData} with industry data)\n`);

  console.log('✅ UK data build complete!\n');
  console.log('   NOTE: Scotland and Northern Ireland are not yet included.');
  console.log('   Their 2022/2021 census data can be added via NRS and NISRA APIs.\n');
}

main().catch(err => {
  console.error('\n⚠ UK build encountered an error:', err.message);
  console.error('  UK data files may be incomplete. Run "npm run build:data:uk" locally.\n');
  process.exit(0); // non-fatal — AU data remains valid
});
