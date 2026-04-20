/**
 * Signal — Canada Data Build Script
 *
 * Fetches Statistics Canada Census 2021 data for Census Divisions and writes:
 *   public/data/ca-cd.geojson          — residential GeoJSON with opportunity scores
 *   public/data/ca-business-cd.geojson — business GeoJSON with SmartBiz scores
 *   public/data/ca-regions.json        — flat region index (sorted by score)
 *
 * Data sources:
 *   Boundaries: Stats Canada Census Division cartographic boundaries (shapefile)
 *   Census data: Stats Canada Census Profile 2021 (98-401-X2021004) — CSV download
 *
 * Key characteristics used (CHARACTERISTIC_ID):
 *   1  — Population, 2021
 *   40 — Median age of the population
 *   41–47 — Dwelling types (structural)
 *   244 — Median after-tax income of household in 2020 ($)
 *   1414–1416 — Tenure (owner / renter)
 *   2259–2281 — Industry by NAICS 2017 sectors
 *
 * Run: node scripts/build-data-ca.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as shapefile from 'shapefile';
import proj4 from 'proj4';
import simplify from 'simplify-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DATA_DIR  = path.join(ROOT, 'public', 'data');
const CACHE_DIR = path.join(ROOT, '.ca-cache');

fs.mkdirSync(DATA_DIR,  { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

// ─── Constants ────────────────────────────────────────────────────────────────

const BOUNDARY_ZIP_URL =
  'https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lcd_000b21a_e.zip';

const CENSUS_CSV_URL =
  'https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/download-telecharger/comp/getFile.cfm?LANG=E&GEONO=004&FILETYPE=CSV';

const CENSUS_CSV_FILENAME = '98-401-X2021004_English_CSV_data.csv';

const PRUID_TO_ABBREV = {
  '10': 'NL', '11': 'PE', '12': 'NS', '13': 'NB',
  '24': 'QC', '35': 'ON',
  '46': 'MB', '47': 'SK', '48': 'AB', '59': 'BC',
  '60': 'YT', '61': 'NT', '62': 'NU',
};

// NAICS 2017 section labels
const NAICS_SECTIONS = {
  '11':    'Agriculture, Forestry, Fishing & Hunting',
  '21':    'Mining, Quarrying, Oil & Gas',
  '22':    'Utilities',
  '23':    'Construction',
  '31-33': 'Manufacturing',
  '41':    'Wholesale Trade',
  '44-45': 'Retail Trade',
  '48-49': 'Transportation & Warehousing',
  '51':    'Information & Cultural Industries',
  '52':    'Finance & Insurance',
  '53':    'Real Estate & Rental',
  '54':    'Professional, Scientific & Technical',
  '55':    'Management of Companies',
  '56':    'Administrative & Support / Waste',
  '61':    'Educational Services',
  '62':    'Health Care & Social Assistance',
  '71':    'Arts, Entertainment & Recreation',
  '72':    'Accommodation & Food Services',
  '81':    'Other Services',
  '91':    'Public Administration',
};

// Broadband demand weights per NAICS section (0–1)
const NAICS_BW_WEIGHTS = {
  '51': 1.00, '52': 0.95, '54': 0.90, '55': 0.85,
  '61': 0.80, '62': 0.75, '56': 0.65, '53': 0.60,
  '41': 0.55, '44-45': 0.50, '31-33': 0.45,
  '48-49': 0.40, '72': 0.35, '71': 0.35, '81': 0.30,
  '91': 0.35, '23': 0.25, '22': 0.20, '21': 0.15, '11': 0.10,
};

// NAICS IDs in the census profile (CHARACTERISTIC_ID → section code)
const NAICS_CHAR_IDS = {
  2262: '11', 2263: '21', 2264: '22', 2265: '23', 2266: '31-33',
  2267: '41', 2268: '44-45', 2269: '48-49', 2270: '51', 2271: '52',
  2272: '53', 2273: '54', 2274: '55', 2275: '56', 2276: '61',
  2277: '62', 2278: '71', 2279: '72', 2280: '81', 2281: '91',
};

// ─── Utility ──────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function normalize(v, lo, hi) {
  if (v == null) return 50;
  return clamp(((v - lo) / (hi - lo)) * 100, 0, 100);
}

// ─── Boundary fetch ───────────────────────────────────────────────────────────

async function fetchCaBoundaries() {
  const cacheFile = path.join(CACHE_DIR, 'cd_boundaries.geojson');
  if (fs.existsSync(cacheFile)) {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < 30 * 24 * 60 * 60 * 1000) {
      process.stdout.write('  [cache] CD boundaries\n');
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  }

  const zipPath = path.join(CACHE_DIR, 'lcd_000b21a_e.zip');
  const extractDir = path.join(CACHE_DIR, 'lcd_extracted');

  // Download if not cached
  if (!fs.existsSync(zipPath)) {
    process.stdout.write(`  [fetch] Boundary shapefile (~140 MB)...\n`);
    const res = await fetch(BOUNDARY_ZIP_URL, { signal: AbortSignal.timeout(600_000) });
    if (!res.ok) throw new Error(`Boundary download: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zipPath, buf);
    process.stdout.write(`  ✓ Downloaded ${(buf.length / 1e6).toFixed(0)} MB\n`);
  } else {
    process.stdout.write('  [cache] Boundary zip already downloaded\n');
  }

  // Extract
  fs.mkdirSync(extractDir, { recursive: true });
  process.stdout.write('  [unzip] Extracting boundary shapefile...\n');
  execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });

  // Find .shp file
  const shpFile = fs.readdirSync(extractDir).find(f => f.endsWith('.shp'));
  if (!shpFile) throw new Error('No .shp file found in boundary zip');
  const shpPath = path.join(extractDir, shpFile);
  const dbpPath = shpPath.replace('.shp', '.dbf');

  // NAD83 Statistics Canada Lambert → WGS84
  const SRC_PROJ = '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=63.390675 +lon_0=-91.86666666666666 +x_0=6200000 +y_0=3000000 +ellps=GRS80 +datum=NAD83 +units=m +no_defs';
  const toWgs84 = proj4(SRC_PROJ, 'WGS84');

  process.stdout.write(`  [parse] Reading ${shpFile}...\n`);
  const features = [];
  const source = await shapefile.open(shpPath, dbpPath);
  while (true) {
    const { done, value } = await source.read();
    if (done) break;
    if (value) {
      reprojectAndSimplify(value.geometry, toWgs84);
      features.push(value);
    }
  }

  const geojson = { type: 'FeatureCollection', features };
  fs.writeFileSync(cacheFile, JSON.stringify(geojson));
  process.stdout.write(`  ✓ ${features.length} Census Division boundary features\n`);
  return geojson;
}

// Reproject from NAD83 Lambert → WGS84, simplify vertices, round to 3dp
function reprojectAndSimplify(geom, proj) {
  if (!geom) return;
  const TOLERANCE = 0.005; // ~500 m at Canadian latitudes

  const processRing = ring => {
    const reprojected = ring.map(([x, y]) => {
      const [lng, lat] = proj.forward([x, y]);
      return [Math.round(lng * 1000) / 1000, Math.round(lat * 1000) / 1000];
    });
    const pts = reprojected.map(([x, y]) => ({ x, y }));
    const simplified = simplify(pts, TOLERANCE, true);
    if (simplified.length < 4) return null; // degenerate ring, discard
    return simplified.map(p => [p.x, p.y]);
  };

  if (geom.type === 'Polygon') {
    const rings = geom.coordinates.map(processRing).filter(Boolean);
    // Keep polygon only if outer ring survived
    geom.coordinates = rings.length > 0 ? rings : [geom.coordinates[0].map(([x, y]) => {
      const [lng, lat] = proj.forward([x, y]);
      return [Math.round(lng * 1000) / 1000, Math.round(lat * 1000) / 1000];
    })];
  } else if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates
      .map(poly => poly.map(processRing).filter(Boolean))
      .filter(poly => poly.length > 0);
    geom.coordinates = polys.length > 0 ? polys : geom.coordinates.slice(0, 1).map(poly =>
      poly.map(ring => ring.map(([x, y]) => {
        const [lng, lat] = proj.forward([x, y]);
        return [Math.round(lng * 1000) / 1000, Math.round(lat * 1000) / 1000];
      }))
    );
  }
}

// ─── Census CSV fetch & parse ─────────────────────────────────────────────────

async function fetchCensusCsv() {
  const cacheFile = path.join(CACHE_DIR, CENSUS_CSV_FILENAME);
  if (fs.existsSync(cacheFile)) {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < 30 * 24 * 60 * 60 * 1000) {
      process.stdout.write('  [cache] Census Profile CSV\n');
      return cacheFile;
    }
  }

  const zipPath = path.join(CACHE_DIR, 'census_profile_cd.zip');
  process.stdout.write(`  [fetch] Census Profile CSV (~12 MB)...\n`);
  const res = await fetch(CENSUS_CSV_URL, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Census CSV download: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`Census CSV response too small: ${buf.length} bytes`);
  fs.writeFileSync(zipPath, buf);

  execSync(`unzip -o "${zipPath}" "${CENSUS_CSV_FILENAME}" -d "${CACHE_DIR}"`, { stdio: 'pipe' });
  process.stdout.write(`  ✓ Census Profile CSV extracted (${(fs.statSync(cacheFile).size / 1e6).toFixed(0)} MB)\n`);
  return cacheFile;
}

/**
 * Parse the Census Profile CSV into Map<cduid, Map<characteristicId, value>>.
 * Filters to Census Division level (GEO_LEVEL = 'Census division').
 */
function parseCensusCsv(csvPath) {
  process.stdout.write('  [parse] Reading Census Profile CSV...\n');
  const text = fs.readFileSync(csvPath, 'latin1');
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new Error('Empty census CSV');

  // Parse header
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const dguidIdx   = header.indexOf('DGUID');
  const geoLvlIdx  = header.indexOf('GEO_LEVEL');
  const charIdIdx  = header.indexOf('CHARACTERISTIC_ID');
  const valueIdx   = header.indexOf('C1_COUNT_TOTAL');
  const symbolIdx  = header.indexOf('SYMBOL');

  if (dguidIdx === -1 || charIdIdx === -1 || valueIdx === -1) {
    throw new Error(`Census CSV missing columns. Got: ${header.slice(0, 8).join(', ')}`);
  }

  const result = new Map();
  let parsed = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Fast-path: only process Census Division rows
    if (!line.includes('Census division')) continue;

    const cols = parseCsvRow(line);
    if (cols.length < valueIdx + 1) continue;

    const geoLevel = (cols[geoLvlIdx] ?? '').replace(/"/g, '').trim();
    if (geoLevel !== 'Census division') continue;

    const dguid = (cols[dguidIdx] ?? '').replace(/"/g, '').trim();
    // DGUID format: 2021A0003XXXX where XXXX is the 4-digit CDUID
    if (!dguid.startsWith('2021A0003')) continue;
    const cduid = dguid.replace('2021A0003', '');

    const symbol = (cols[symbolIdx] ?? '').replace(/"/g, '').trim();
    if (symbol === 'x' || symbol === 'F') continue; // suppressed

    const charId = parseInt(cols[charIdIdx]);
    if (isNaN(charId)) continue;

    const rawVal = (cols[valueIdx] ?? '').replace(/"/g, '').trim();
    const value  = parseFloat(rawVal.replace(/,/g, ''));
    if (isNaN(value)) continue;

    if (!result.has(cduid)) result.set(cduid, new Map());
    result.get(cduid).set(charId, value);
    parsed++;
  }

  process.stdout.write(`  ✓ Parsed ${result.size} Census Divisions (${parsed.toLocaleString()} values)\n`);
  return result;
}

function parseCsvRow(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; cur += ch; }
    else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur);
  return cols;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

const CA_RES_WEIGHTS = {
  income: 0.25, children: 0.15, ownership: 0.15,
  dwelling: 0.10, density: 0.10, elderly: 0.05,
};
const CA_RES_W_TOTAL = Object.values(CA_RES_WEIGHTS).reduce((s, v) => s + v, 0);

function computeCaOpportunityScore(d) {
  // Canada collects actual household income — normalize over CAD $40k–$120k range
  const income    = normalize(d.median_household_income_annual, 40_000, 120_000);
  const children  = clamp(d.households_with_children_pct ?? 35, 0, 100);
  const ownership = clamp(d.owned_pct ?? 60, 0, 100);
  const dwelling  = clamp((d.detached_pct ?? 0) + (d.semi_detached_pct ?? 0), 0, 100);
  // Canada is large/sparse — density cap higher than UK but lower than AU
  const density   = normalize(d.population_density_per_sqkm, 0, 1500);
  const elderly   = clamp(d.elderly_pct ?? 17, 0, 100);

  const rawScore =
    CA_RES_WEIGHTS.income    * income    +
    CA_RES_WEIGHTS.children  * children  +
    CA_RES_WEIGHTS.ownership * ownership +
    CA_RES_WEIGHTS.dwelling  * dwelling  +
    CA_RES_WEIGHTS.density   * density   +
    CA_RES_WEIGHTS.elderly   * elderly;

  return {
    opportunity_score:   clamp(Math.round(rawScore / CA_RES_W_TOTAL), 0, 100),
    income_component:    Math.round(income),
    children_component:  Math.round(children),
    ownership_component: Math.round(ownership),
    dwelling_component:  Math.round(dwelling),
    density_component:   Math.round(density),
    elderly_component:   Math.round(elderly),
  };
}

function computeCaBizScore(d) {
  const total = d.working_population ?? 0;
  const dist  = d.industry_distribution ?? {};

  let industryScore = 50;
  if (total > 0) {
    let weighted = 0;
    for (const [code, count] of Object.entries(dist)) {
      weighted += (count / total) * (NAICS_BW_WEIGHTS[code] ?? 0.35);
    }
    industryScore = weighted * 100;
  }

  const wpDensityScore  = normalize(d.working_pop_density, 0, 300);
  const highValue       = (dist['51'] ?? 0) + (dist['52'] ?? 0) +
                          (dist['54'] ?? 0) + (dist['62'] ?? 0);
  const hvPct           = total > 0 ? (highValue / total) * 100 : 0;
  const highValueScore  = normalize(hvPct, 0, 40);

  const BW       = { industry: 0.35, wpDensity: 0.25, highValue: 0.40 };
  const BW_TOTAL = Object.values(BW).reduce((s, v) => s + v, 0);

  const rawScore =
    BW.industry  * industryScore  +
    BW.wpDensity * wpDensityScore +
    BW.highValue * highValueScore;

  return {
    smartbiz_score:         clamp(Math.round(rawScore / BW_TOTAL), 0, 100),
    industry_mix_component: Math.round(industryScore),
    wp_density_component:   Math.round(wpDensityScore),
    high_value_component:   Math.round(highValueScore),
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
  console.log('\n🇨🇦 Signal — building Canada data files (Census Divisions)...\n');

  // ── 1. Boundaries ──────────────────────────────────────────────────────────
  console.log('▶ Fetching CD boundaries...');
  let boundaries;
  try {
    boundaries = await fetchCaBoundaries();
    const count = boundaries.features?.length ?? 0;
    console.log(`  ✓ ${count} Census Division boundary features`);
    if (count === 0) throw new Error('No features returned');
  } catch (err) {
    console.error(`  ✗ Boundary fetch failed: ${err.message}`);
    console.error('  ⚠ Canada data files will not be generated this build.');
    console.error('    Run "npm run build:data:ca" locally to generate them.\n');
    process.exit(0);
  }

  // ── 2. Census Profile CSV ──────────────────────────────────────────────────
  console.log('\n▶ Fetching Statistics Canada Census Profile...');
  let censusData;
  try {
    const csvPath = await fetchCensusCsv();
    censusData = parseCensusCsv(csvPath);
  } catch (err) {
    console.error(`  ✗ Census CSV failed: ${err.message}`);
    console.error('  ⚠ Canada data files will not be generated this build.\n');
    process.exit(0);
  }

  // ── 3. Build features ─────────────────────────────────────────────────────
  console.log(`\n▶ Building GeoJSON for ${boundaries.features.length} Census Divisions...`);

  let resWithData = 0;

  const residentialFeatures = boundaries.features.map(feature => {
    const props = feature.properties ?? {};

    // Match boundary CDUID to census data
    // Shapefile has CDUID (4-char) and PRUID (2-char)
    const cduid  = String(props.CDUID ?? props.cduid ?? '').trim();
    const pruid  = String(props.PRUID ?? props.pruid ?? cduid.slice(0, 2)).trim();
    const name   = (props.CDNAME ?? props.cdname ?? cduid).trim();
    const prov   = PRUID_TO_ABBREV[pruid] ?? pruid;
    // Land area from shapefile (m²) → km²
    const areaSqkm = (props.LANDAREA ?? props.landarea ?? props.ALAND ?? 0);
    // LANDAREA in the Stats Canada shapefile is already in km²

    const cd = censusData.get(cduid);
    const g  = (id) => cd?.get(id) ?? null;
    const r1 = v => v != null ? Math.round(v * 10) / 10 : null;

    // ── Population & age ──
    const population  = g(1);
    const medianAge   = g(40);
    const ageTotal    = g(8);

    const age0_14  = g(9) ?? 0;
    const age15_64 = g(13) ?? 0;
    const age65p   = g(24) ?? 0;

    const youthPct   = ageTotal > 0 ? (age0_14  / ageTotal) * 100 : null;
    const elderlyPct = ageTotal > 0 ? (age65p   / ageTotal) * 100 : null;
    const hhWithChildrenPct = youthPct != null ? Math.min(70, youthPct * 1.35) : null;

    // Build age distribution bands
    const ageDist = {
      '0–4':   g(10)  ?? 0,
      '5–9':   g(11)  ?? 0,
      '10–14': g(12)  ?? 0,
      '15–19': g(14)  ?? 0,
      '20–24': g(15)  ?? 0,
      '25–29': g(16)  ?? 0,
      '30–34': g(17)  ?? 0,
      '35–39': g(18)  ?? 0,
      '40–44': g(19)  ?? 0,
      '45–49': g(20)  ?? 0,
      '50–54': g(21)  ?? 0,
      '55–59': g(22)  ?? 0,
      '60–64': g(23)  ?? 0,
      '65–69': g(25)  ?? 0,
      '70–74': g(26)  ?? 0,
      '75–79': g(27)  ?? 0,
      '80–84': g(28)  ?? 0,
      '85+':   g(29)  ?? 0,
    };

    // ── Dwelling type ──
    const dwellingTotal    = g(41) ?? 0;
    const detached         = g(42) ?? 0;
    const semiDetached     = g(43) ?? 0;
    const rowHouse         = g(44) ?? 0;
    const flat             = (g(45) ?? 0) + (g(46) ?? 0) + (g(47) ?? 0);

    const detachedPct     = dwellingTotal > 0 ? (detached     / dwellingTotal) * 100 : null;
    const semiDetachedPct = dwellingTotal > 0 ? (semiDetached / dwellingTotal) * 100 : null;
    const rowHousePct     = dwellingTotal > 0 ? (rowHouse     / dwellingTotal) * 100 : null;
    const apartmentPct    = dwellingTotal > 0 ? (flat         / dwellingTotal) * 100 : null;

    // ── Tenure ──
    const tenureTotal  = g(1414) ?? 0;
    const owners       = g(1415) ?? 0;
    const renters      = g(1416) ?? 0;

    const ownedPct    = tenureTotal > 0 ? (owners  / tenureTotal) * 100 : null;
    const rentingPct  = tenureTotal > 0 ? (renters / tenureTotal) * 100 : null;

    // ── Income ──
    // ID=244: Median after-tax income of household in 2020 ($) — annual, CAD
    const medianHhIncomeAnnual = g(244);

    // Income distribution buckets from census (approximate from available data)
    // We don't have detailed brackets in the census profile at CD level,
    // so derive a rough distribution from median + household types
    const incDist = medianHhIncomeAnnual ? {
      '<$40k':    clamp(Math.round(normalize(medianHhIncomeAnnual, 80_000, 40_000)), 0, 100),
      '$40k–$80k': 35,
      '$80k–$120k': clamp(Math.round(normalize(medianHhIncomeAnnual, 40_000, 120_000) * 0.4), 0, 100),
      '$120k+':   clamp(Math.round(normalize(medianHhIncomeAnnual, 80_000, 150_000) * 0.3), 0, 100),
    } : null;

    // ── Derived ──
    const popDensity = population > 0 && areaSqkm > 0 ? population / areaSqkm : null;
    const avgHhSize  = dwellingTotal > 0 && population > 0 ? population / dwellingTotal : null;

    if (population > 0) resWithData++;

    const demographics = {
      population:                   population ? Math.round(population) : null,
      dwelling_count:               dwellingTotal > 0 ? Math.round(dwellingTotal) : null,
      median_household_income_annual: medianHhIncomeAnnual ? Math.round(medianHhIncomeAnnual) : null,
      // AU-compatible weekly field: annual ÷ 52
      median_household_income_weekly: medianHhIncomeAnnual
        ? Math.round(medianHhIncomeAnnual / 52) : null,
      median_age:                   medianAge,
      avg_household_size:           r1(avgHhSize),
      households_with_children_pct: r1(hhWithChildrenPct),
      detached_pct:                 r1(detachedPct),
      semi_detached_pct:            r1(semiDetachedPct),
      row_house_pct:                r1(rowHousePct),
      apartment_pct:                r1(apartmentPct),
      separate_house_pct:           r1(detachedPct), // AU-compat
      owned_pct:                    r1(ownedPct),
      renting_pct:                  r1(rentingPct),
      youth_pct:                    r1(youthPct),
      elderly_pct:                  r1(elderlyPct),
      population_density_per_sqkm:  popDensity ? Math.round(popDensity * 10) / 10 : null,
      area_sqkm:                    areaSqkm > 0 ? Math.round(areaSqkm) : null,
      lower_income_pct:             incDist ? incDist['<$40k'] : null,
      age_distribution:             Object.values(ageDist).some(v => v > 0) ? ageDist : null,
      income_distribution:          incDist,
    };

    const scores = computeCaOpportunityScore(demographics);

    return {
      ...feature,
      properties: {
        id: cduid, name, state_code: prov, type: 'cd', market: 'ca',
        ...demographics,
        ...scores,
      },
    };
  });

  // Write uk-lad.geojson-style file
  fs.writeFileSync(
    path.join(DATA_DIR, 'ca-cd.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: residentialFeatures })
  );
  console.log(`  ✓ Written public/data/ca-cd.geojson (${residentialFeatures.length} features, ${resWithData} with data)`);

  // ── Write ca-regions.json ──
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
      type: p.type, market: 'ca',
      opportunity_score: p.opportunity_score,
      centroid_lat: isFinite(minLat) ? Math.round(((minLat + maxLat) / 2) * 10000) / 10000 : 0,
      centroid_lng: isFinite(minLng) ? Math.round(((minLng + maxLng) / 2) * 10000) / 10000 : 0,
    };
  }).sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0));

  fs.writeFileSync(
    path.join(DATA_DIR, 'ca-regions.json'),
    JSON.stringify(regions, null, 2)
  );
  console.log(`  ✓ Written public/data/ca-regions.json (${regions.length} regions)`);

  // ── Business features ──────────────────────────────────────────────────────
  console.log('\n▶ Building ca-business-cd.geojson...');
  let bizWithData = 0;

  const businessFeatures = boundaries.features.map(feature => {
    const props  = feature.properties ?? {};
    const cduid  = String(props.CDUID ?? props.cduid ?? '').trim();
    const pruid  = String(props.PRUID ?? props.pruid ?? cduid.slice(0, 2)).trim();
    const name   = (props.CDNAME ?? props.cdname ?? cduid).trim();
    const prov   = PRUID_TO_ABBREV[pruid] ?? pruid;
    const areaSqkm = props.LANDAREA ?? props.landarea ?? 0;

    const cd = censusData.get(cduid);
    const g  = (id) => cd?.get(id) ?? null;
    const r1 = v => v != null ? Math.round(v * 10) / 10 : null;
    const pct = (n, tot) => tot > 0 ? r1((n / tot) * 100) : null;

    // Industry by NAICS
    const industryTotal = g(2261) ?? g(2259) ?? 0; // 2261 = All industries
    const industryDist  = {};
    for (const [charId, sectionCode] of Object.entries(NAICS_CHAR_IDS)) {
      const val = g(parseInt(charId));
      if (val != null && val > 0) industryDist[sectionCode] = val;
    }

    const workingPop = industryTotal;

    const industryPcts = {};
    if (workingPop > 0) {
      for (const [sec, cnt] of Object.entries(industryDist)) {
        industryPcts[sec] = Math.round((cnt / workingPop) * 1000) / 10;
      }
    }

    const highValue = (industryDist['51'] ?? 0) + (industryDist['52'] ?? 0) +
                      (industryDist['54'] ?? 0) + (industryDist['62'] ?? 0);

    const wpDensity = workingPop > 0 && areaSqkm > 0
      ? Math.round((workingPop / areaSqkm) * 10) / 10 : null;

    if (workingPop > 0) bizWithData++;

    const businessData = {
      working_population:        workingPop > 0 ? Math.round(workingPop) : null,
      working_pop_density:       wpDensity,
      industry_distribution:     Object.keys(industryDist).length > 0 ? industryDist : null,
      industry_pcts:             Object.keys(industryPcts).length > 0 ? industryPcts : null,
      knowledge_worker_pct:      pct(highValue + (industryDist['61'] ?? 0), workingPop),
      healthcare_pct:            pct(industryDist['62'] ?? 0, workingPop),
      professional_services_pct: pct(industryDist['54'] ?? 0, workingPop),
      finance_tech_pct:          pct((industryDist['51'] ?? 0) + (industryDist['52'] ?? 0), workingPop),
      construction_pct:          pct(industryDist['23'] ?? 0, workingPop),
      retail_pct:                pct(industryDist['44-45'] ?? 0, workingPop),
      total_businesses:          null,
      business_density:          null,
      business_size_dist:        null,
      area_sqkm:                 areaSqkm > 0 ? Math.round(areaSqkm) : null,
    };

    const scores = computeCaBizScore(businessData);

    return {
      ...feature,
      properties: {
        id: cduid, name, state_code: prov, type: 'cd', market: 'ca',
        ...businessData,
        ...scores,
      },
    };
  });

  fs.writeFileSync(
    path.join(DATA_DIR, 'ca-business-cd.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: businessFeatures })
  );
  console.log(`  ✓ Written public/data/ca-business-cd.geojson (${businessFeatures.length} features, ${bizWithData} with industry data)`);

  console.log('\n✅ Canada data build complete!\n');
}

main().catch(err => {
  console.error('\n⚠ Canada build encountered an error:', err.message);
  console.error('  Canada data files may be incomplete. Run "npm run build:data:ca" locally.\n');
  process.exit(0); // non-fatal — other market data remains valid
});
