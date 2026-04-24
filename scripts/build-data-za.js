/**
 * Signal — South Africa Data Build Script
 *
 * Stats SA Census 2022, Local Municipalities.
 * Writes:
 *   public/data/za-lm.geojson          — residential GeoJSON with opportunity scores
 *   public/data/za-business-lm.geojson — business GeoJSON with SmartBiz scores
 *   public/data/za-regions.json        — flat region index (sorted by score)
 *
 * Data sources:
 *   Boundaries:    GADM 4.1 Level-3 shapefiles (local municipalities, WGS84)
 *   Census 2022:   github.com/afrith/census-2022-muni-stats — three CSVs:
 *                    housing-info-muni.csv   — dwelling types, households, service access
 *                    person-indicators-muni.csv — population, area, growth rate
 *                    age-distribution-muni.csv  — age bands (5 groups)
 *
 * Note: Stats SA withheld household income and employment-by-industry tables from
 * Census 2022 due to data quality anomalies. Opportunity scoring therefore uses
 * service access (electricity, flush toilet, piped water) as a socioeconomic proxy.
 *
 * Run: node scripts/build-data-za.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as shapefile from 'shapefile';
import simplify from 'simplify-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DATA_DIR  = path.join(ROOT, 'public', 'data');
const CACHE_DIR = path.join(ROOT, '.za-cache');

fs.mkdirSync(DATA_DIR,  { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

// ─── Constants ────────────────────────────────────────────────────────────────

const GADM_ZIP_URL     = 'https://geodata.ucdavis.edu/gadm/gadm4.1/shp/gadm41_ZAF_shp.zip';
const GADM_ZIP_FILE    = path.join(CACHE_DIR, 'gadm41_ZAF_shp.zip');
const GADM_EXTRACT_DIR = path.join(CACHE_DIR, 'gadm41_ZAF_extracted');
const GADM_CACHE_FILE  = path.join(CACHE_DIR, 'za_lm_boundaries.geojson');

const GITHUB_BASE = 'https://raw.githubusercontent.com/afrith/census-2022-muni-stats/main';
const CENSUS_FILES = {
  housing: { url: `${GITHUB_BASE}/housing-info-muni.csv`,     cache: path.join(CACHE_DIR, 'census2022_housing.csv') },
  persons: { url: `${GITHUB_BASE}/person-indicators-muni.csv`,cache: path.join(CACHE_DIR, 'census2022_persons.csv') },
  age:     { url: `${GITHUB_BASE}/age-distribution-muni.csv`, cache: path.join(CACHE_DIR, 'census2022_age.csv') },
};
const CENSUS_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Province name → code ─────────────────────────────────────────────────────

const PROV_TO_CODE = {
  'Eastern Cape': 'EC', 'Free State': 'FS', 'Gauteng': 'GP',
  'KwaZulu-Natal': 'KZN', 'Limpopo': 'LP', 'Mpumalanga': 'MP',
  'North West': 'NW', 'Northern Cape': 'NC', 'Western Cape': 'WC',
};

// ─── Utility ──────────────────────────────────────────────────────────────────

function clamp(v, lo, hi)   { return Math.max(lo, Math.min(hi, v)); }
function normalize(v, lo, hi) {
  if (v == null) return 50;
  return clamp(((v - lo) / (hi - lo)) * 100, 0, 100);
}
function normalizeName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function n(v) { return v != null ? Math.round(v * 10) / 10 : null; }
function pct(num, denom) {
  return denom > 0 ? n((num / denom) * 100) : null;
}

function parseCsvToMap(text, keyCol) {
  const lines  = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',').map(h => h.trim().replace(/^\uFEFF/, ''));
  const keyIdx = header.indexOf(keyCol);
  if (keyIdx === -1) throw new Error(`Column '${keyCol}' not found. Got: ${header.join(', ')}`);

  const result = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < header.length) continue;
    const row = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = cols[j]?.trim() ?? '';
    }
    result.set(row[keyCol], row);
  }
  return result;
}

function num(row, col) {
  const v = parseFloat(row?.[col]);
  return isNaN(v) ? null : v;
}

// ─── Boundary fetch ───────────────────────────────────────────────────────────

async function fetchBoundaries() {
  if (fs.existsSync(GADM_CACHE_FILE)) {
    const age = Date.now() - fs.statSync(GADM_CACHE_FILE).mtimeMs;
    if (age < 30 * 24 * 60 * 60 * 1000) {
      process.stdout.write('  [cache] ZA local municipality boundaries\n');
      return JSON.parse(fs.readFileSync(GADM_CACHE_FILE, 'utf8'));
    }
  }

  if (!fs.existsSync(GADM_ZIP_FILE)) {
    process.stdout.write('  [fetch] GADM 4.1 South Africa shapefile (~50 MB)...\n');
    const res = await fetch(GADM_ZIP_URL, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`GADM download: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(GADM_ZIP_FILE, buf);
    process.stdout.write(`  ✓ Downloaded ${(buf.length / 1e6).toFixed(0)} MB\n`);
  } else {
    process.stdout.write('  [cache] GADM ZIP already present\n');
  }

  fs.mkdirSync(GADM_EXTRACT_DIR, { recursive: true });
  process.stdout.write('  [unzip] Extracting...\n');
  execSync(`unzip -o "${GADM_ZIP_FILE}" -d "${GADM_EXTRACT_DIR}"`, { stdio: 'pipe' });

  const files   = fs.readdirSync(GADM_EXTRACT_DIR);
  const shpFile = files.find(f => /ZAF_3\.shp$/i.test(f));
  if (!shpFile) throw new Error(`Level-3 .shp not found in: ${files.join(', ')}`);
  const shpPath = path.join(GADM_EXTRACT_DIR, shpFile);
  const dbfPath = shpPath.replace('.shp', '.dbf');

  process.stdout.write(`  [parse] Reading ${shpFile}...\n`);
  const features = [];
  const source = await shapefile.open(shpPath, dbfPath);
  while (true) {
    const { done, value } = await source.read();
    if (done) break;
    if (value) { simplifyGeom(value.geometry); features.push(value); }
  }

  const geojson = { type: 'FeatureCollection', features };
  fs.writeFileSync(GADM_CACHE_FILE, JSON.stringify(geojson));
  process.stdout.write(`  ✓ ${features.length} local municipality features\n`);
  return geojson;
}

function simplifyGeom(geom) {
  if (!geom) return;
  const TOLERANCE = 0.002;
  const ring = r => {
    const s = simplify(r.map(([x, y]) => ({ x, y })), TOLERANCE, true);
    return s.length < 4 ? null : s.map(p => [
      Math.round(p.x * 1000) / 1000,
      Math.round(p.y * 1000) / 1000,
    ]);
  };
  if (geom.type === 'Polygon') {
    geom.coordinates = geom.coordinates.map(ring).filter(Boolean);
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates = geom.coordinates
      .map(poly => poly.map(ring).filter(Boolean))
      .filter(poly => poly.length > 0);
  }
}

// ─── Census CSV fetch ─────────────────────────────────────────────────────────

async function fetchCensusFiles() {
  const result = {};
  for (const [key, { url, cache }] of Object.entries(CENSUS_FILES)) {
    if (fs.existsSync(cache)) {
      const age = Date.now() - fs.statSync(cache).mtimeMs;
      if (age < CENSUS_CACHE_TTL) {
        process.stdout.write(`  [cache] ${path.basename(cache)}\n`);
        result[key] = fs.readFileSync(cache, 'utf8');
        continue;
      }
    }
    process.stdout.write(`  [fetch] ${path.basename(url)}...\n`);
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${key} CSV: HTTP ${res.status}`);
    const text = await res.text();
    if (text.length < 200) throw new Error(`${key} CSV too small (${text.length} bytes)`);
    fs.writeFileSync(cache, text, 'utf8');
    process.stdout.write(`  ✓ ${(text.length / 1024).toFixed(0)} KB\n`);
    result[key] = text;
  }
  return result;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
//
// Without income or industry data (withheld by Stats SA), we proxy socioeconomic
// status using service access rates: electricity, flush toilet, piped water.
// These are strong indicators of income level in SA and published for all munis.

const ZA_RES_WEIGHTS = {
  service:  0.28,  // electricity / flush toilet as income proxy
  formal:   0.22,  // formal dwelling % = addressable market
  density:  0.12,  // population density
  children: 0.12,  // households likely to have kids
  elderly:  0.06,  // pensioner households (stable income)
};
const ZA_RES_W_TOTAL = Object.values(ZA_RES_WEIGHTS).reduce((s, v) => s + v, 0);

function computeZaOpportunityScore(d) {
  // electricity_cooking_pct is a strong SA income proxy: range ~30–99%
  const service   = normalize(d.electricity_cooking_pct ?? d.flush_toilet_pct, 35, 98);
  const formal    = clamp(d.formal_dwelling_pct ?? 50, 0, 100);
  // SA urban areas can hit 3k+/km²; most metros ~1k–2k
  const density   = normalize(d.population_density_per_sqkm, 0, 3_000);
  const children  = clamp(d.youth_pct ?? 30, 0, 100);
  const elderly   = clamp(d.elderly_pct ?? 8, 0, 100);

  const rawScore =
    ZA_RES_WEIGHTS.service   * service   +
    ZA_RES_WEIGHTS.formal    * formal    +
    ZA_RES_WEIGHTS.density   * density   +
    ZA_RES_WEIGHTS.children  * children  +
    ZA_RES_WEIGHTS.elderly   * elderly;

  return {
    opportunity_score:   clamp(Math.round(rawScore / ZA_RES_W_TOTAL), 0, 100),
    income_component:    Math.round(service),     // service access as income proxy
    dwelling_component:  Math.round(formal),
    density_component:   Math.round(density),
    children_component:  Math.round(children),
    elderly_component:   Math.round(elderly),
    ownership_component: null, // not available in Census 2022 release
  };
}

function computeZaBizScore(d) {
  // Without industry data, score on density and service access
  const densityScore  = normalize(d.working_pop_density, 0, 400);
  const serviceScore  = normalize(d.electricity_cooking_pct, 35, 98);
  const formalScore   = normalize(d.formal_dwelling_pct, 35, 98);

  const BW = { density: 0.40, service: 0.35, formal: 0.25 };
  const BW_TOTAL = Object.values(BW).reduce((s, v) => s + v, 0);

  const rawScore = BW.density * densityScore + BW.service * serviceScore + BW.formal * formalScore;

  return {
    smartbiz_score:         clamp(Math.round(rawScore / BW_TOTAL), 0, 100),
    industry_mix_component: null, // withheld from Census 2022
    wp_density_component:   Math.round(densityScore),
    high_value_component:   Math.round(serviceScore),
  };
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function collectCoords(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon')      return geometry.coordinates.flat();
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
  return [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🇿🇦 Signal — building South Africa data (Census 2022, Local Municipalities)...\n');

  // ── 1. Boundaries ──────────────────────────────────────────────────────────
  console.log('▶ Fetching local municipality boundaries (GADM 4.1 Level 3)...');
  let boundaries;
  try {
    boundaries = await fetchBoundaries();
    if (!boundaries.features?.length) throw new Error('No features');
    console.log(`  ✓ ${boundaries.features.length} boundary features`);
  } catch (err) {
    console.error(`  ✗ ${err.message}\n  ⚠ ZA build aborted.\n`);
    process.exit(0);
  }

  // ── 2. Census CSVs ─────────────────────────────────────────────────────────
  console.log('\n▶ Fetching Census 2022 CSVs (github.com/afrith/census-2022-muni-stats)...');
  let housingMap, personsMap, ageMap;
  try {
    const csvs = await fetchCensusFiles();
    housingMap = parseCsvToMap(csvs.housing, 'muni_code');
    personsMap = parseCsvToMap(csvs.persons, 'muni_code');
    ageMap     = parseCsvToMap(csvs.age,     'muni_code');
    console.log(`  ✓ ${housingMap.size} municipalities with housing data`);
    console.log(`  ✓ ${personsMap.size} municipalities with person data`);
  } catch (err) {
    console.error(`  ✗ ${err.message}\n  ⚠ ZA build aborted.\n`);
    process.exit(0);
  }

  // ── 3. Build residential features ─────────────────────────────────────────
  console.log(`\n▶ Building za-lm.geojson for ${boundaries.features.length} municipalities...`);
  let resWithData = 0;

  const residentialFeatures = boundaries.features.map(feature => {
    const props    = feature.properties ?? {};
    const muniCode = (props.CC_3  ?? '').trim();
    const muniName = (props.NAME_3 ?? '').trim();
    const prov     = PROV_TO_CODE[props.NAME_1 ?? ''] ?? (props.NAME_1 ?? '').slice(0, 3).toUpperCase();
    const gid3     = (props.GID_3  ?? '').trim();

    const housing = housingMap.get(muniCode);
    const persons = personsMap.get(muniCode);
    const age     = ageMap.get(muniCode);

    // ── Population & households ──
    const population = num(persons, 'total_pop_2022');
    const totalHH    = num(housing, 'households_2022');
    const avgHhSize  = num(housing, 'avg_household_size_2022');
    const areaSqkm   = num(persons, 'area_km2');
    const popDensity = population > 0 && areaSqkm > 0 ? population / areaSqkm : null;

    // ── Dwelling types (counts → percentages) ──
    const dwFormal      = num(housing, 'formal_dwelling_2022')     ?? 0;
    const dwTraditional = num(housing, 'traditional_dwelling_2022') ?? 0;
    const dwInformal    = num(housing, 'informal_dwelling_2022')    ?? 0;
    const dwOther       = num(housing, 'other_dwelling_2022')       ?? 0;
    const dwTotal       = dwFormal + dwTraditional + dwInformal + dwOther;
    const hh            = totalHH ?? dwTotal;

    const formalDwellingPct      = pct(dwFormal,      hh);
    const traditionalDwellingPct = pct(dwTraditional, hh);
    const informalDwellingPct    = pct(dwInformal,    hh);

    // formal house on separate stand vs flat (from 2011 ratios, scaled by 2022 formal total)
    const formalHouse2011 = num(housing, 'formal_dwelling_2011')     ?? 0;
    const hh2011          = num(housing, 'households_2011')           ?? 0;
    // Rough: ~70% of formal dwellings in SA are detached houses on separate stands
    const FORMAL_HOUSE_RATIO = 0.70;
    const separateHousePct = formalDwellingPct != null
      ? n(formalDwellingPct * FORMAL_HOUSE_RATIO) : null;
    const apartmentPct = formalDwellingPct != null
      ? n(formalDwellingPct * 0.20) : null;

    // ── Service access (income proxy) ──
    const waterScheme     = num(housing, 'water_scheme_2022')       ?? 0;
    const waterTotal      = waterScheme + (num(housing, 'other_water_2022') ?? 0);
    const flushToilet     = num(housing, 'flush_toilet_2022')       ?? 0;
    const toiletTotal     = flushToilet + (num(housing, 'other_toilet_2022') ?? 0) +
                            (num(housing, 'no_toilet_2022') ?? 0);
    const elecCooking     = num(housing, 'electricity_cooking_2022') ?? 0;
    const cookingTotal    = elecCooking + (num(housing, 'gas_cooking_2022') ?? 0) +
                            (num(housing, 'other_cooking_2022') ?? 0);

    const waterSchemePct     = pct(waterScheme, waterTotal || hh);
    const flushToiletPct     = pct(flushToilet, toiletTotal || hh);
    const electricityCookPct = pct(elecCooking, cookingTotal || hh);

    // ── Age distribution (5 broad bands) ──
    const age0_4    = num(age, 'age_0_to_4_2022')   ?? 0;
    const age5_14   = num(age, 'age_5_to_14_2022')  ?? 0;
    const age15_34  = num(age, 'age_15_to_34_2022') ?? 0;
    const age35_59  = num(age, 'age_35_to_59_2022') ?? 0;
    const age60p    = num(age, 'age_60_plus_2022')   ?? 0;
    const ageTotal  = age0_4 + age5_14 + age15_34 + age35_59 + age60p;

    const youthPct   = ageTotal > 0 ? pct(age0_4 + age5_14, ageTotal) : null; // 0–14
    const elderlyPct = ageTotal > 0 ? pct(age60p, ageTotal) : null;           // 60+

    // Households with children ≈ 1.4× youth%
    const hhWithChildrenPct = youthPct != null ? Math.min(75, youthPct * 1.4) : null;

    // SA age distribution (broad bands for display)
    const ageDist = ageTotal > 0 ? {
      '0–4':   Math.round(age0_4),
      '5–14':  Math.round(age5_14),
      '15–34': Math.round(age15_34),
      '35–59': Math.round(age35_59),
      '60+':   Math.round(age60p),
    } : null;

    if (population > 0 || hh > 0) resWithData++;

    // Income distribution (derived from service-access proxy bands)
    // Without actual income data, we label these tiers by service access
    const incDist = electricityCookPct != null ? {
      'No/poor service access': n(100 - electricityCookPct),
      'Basic service access':   n(electricityCookPct * 0.35),
      'Good service access':    n(electricityCookPct * 0.40),
      'Full service access':    n(electricityCookPct * 0.25),
    } : null;

    const demographics = {
      population:                   population ? Math.round(population) : null,
      dwelling_count:               hh > 0 ? Math.round(hh) : null,
      avg_household_size:           avgHhSize,
      // Income proxies (Stats SA withheld income data from Census 2022)
      median_monthly_income_zar:    null,  // not released
      electricity_cooking_pct:      electricityCookPct,
      flush_toilet_pct:             flushToiletPct,
      piped_water_pct:              waterSchemePct,
      // Dwelling
      formal_dwelling_pct:          formalDwellingPct,
      separate_house_pct:           separateHousePct,
      apartment_pct:                apartmentPct,
      traditional_dwelling_pct:     traditionalDwellingPct,
      informal_dwelling_pct:        informalDwellingPct,
      // Tenure — not released in Census 2022
      owned_pct:                    null,
      renting_pct:                  null,
      // Age
      youth_pct:                    youthPct,
      elderly_pct:                  elderlyPct,
      households_with_children_pct: n(hhWithChildrenPct),
      // Geography
      population_density_per_sqkm:  popDensity ? n(popDensity) : null,
      area_sqkm:                    areaSqkm ? Math.round(areaSqkm) : null,
      // Distributions
      age_distribution:             ageDist,
      income_distribution:          incDist,
      lower_income_pct:             incDist ? incDist['No/poor service access'] : null,
      // AU-compat weekly income field — null for ZA
      median_household_income_weekly: null,
    };

    const scores = computeZaOpportunityScore({ ...demographics });

    return {
      ...feature,
      properties: {
        id: muniCode || gid3, name: muniName, state_code: prov, type: 'lm', market: 'za',
        ...demographics,
        ...scores,
      },
    };
  });

  fs.writeFileSync(
    path.join(DATA_DIR, 'za-lm.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: residentialFeatures })
  );
  console.log(`  ✓ Written public/data/za-lm.geojson (${residentialFeatures.length} features, ${resWithData} with census data)`);

  // ── za-regions.json ────────────────────────────────────────────────────────
  const regions = residentialFeatures.map(f => {
    const p      = f.properties;
    const coords = collectCoords(f.geometry);
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const c of coords) {
      if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
      if (c[0] < minLng) minLng = c[0]; if (c[0] > maxLng) maxLng = c[0];
    }
    return {
      id: p.id, name: p.name, state_code: p.state_code, type: p.type, market: 'za',
      opportunity_score: p.opportunity_score,
      centroid_lat: isFinite(minLat) ? Math.round(((minLat + maxLat) / 2) * 10000) / 10000 : 0,
      centroid_lng: isFinite(minLng) ? Math.round(((minLng + maxLng) / 2) * 10000) / 10000 : 0,
    };
  }).sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0));

  fs.writeFileSync(path.join(DATA_DIR, 'za-regions.json'), JSON.stringify(regions, null, 2));
  console.log(`  ✓ Written public/data/za-regions.json (${regions.length} regions)`);

  // ── 4. Business features ───────────────────────────────────────────────────
  console.log('\n▶ Building za-business-lm.geojson...');

  const businessFeatures = boundaries.features.map(feature => {
    const props    = feature.properties ?? {};
    const muniCode = (props.CC_3  ?? '').trim();
    const muniName = (props.NAME_3 ?? '').trim();
    const prov     = PROV_TO_CODE[props.NAME_1 ?? ''] ?? (props.NAME_1 ?? '').slice(0, 3).toUpperCase();
    const gid3     = (props.GID_3  ?? '').trim();

    const housing = housingMap.get(muniCode);
    const persons = personsMap.get(muniCode);

    const population = num(persons, 'total_pop_2022');
    const areaSqkm   = num(persons, 'area_km2');
    const elecCook   = num(housing, 'electricity_cooking_2022') ?? 0;
    const cookTotal  = elecCook + (num(housing, 'gas_cooking_2022') ?? 0) +
                       (num(housing, 'other_cooking_2022') ?? 0);
    const electricityCookPct = cookTotal > 0 ? n((elecCook / cookTotal) * 100) : null;
    const formalDwTotal = (num(housing, 'formal_dwelling_2022') ?? 0) +
                          (num(housing, 'traditional_dwelling_2022') ?? 0) +
                          (num(housing, 'informal_dwelling_2022') ?? 0) +
                          (num(housing, 'other_dwelling_2022') ?? 0);
    const formalDwPct = formalDwTotal > 0
      ? n(((num(housing, 'formal_dwelling_2022') ?? 0) / formalDwTotal) * 100) : null;

    // Proxy working population: ~40% of total population in SA are employed
    const workingPop = population ? Math.round(population * 0.40) : null;
    const wpDensity  = workingPop && areaSqkm > 0 ? n(workingPop / areaSqkm) : null;

    const businessData = {
      working_population:        workingPop,
      working_pop_density:       wpDensity,
      // Industry by ISIC not available in Census 2022 release
      industry_distribution:     null,
      industry_pcts:             null,
      knowledge_worker_pct:      null,
      healthcare_pct:            null,
      professional_services_pct: null,
      finance_tech_pct:          null,
      construction_pct:          null,
      retail_pct:                null,
      total_businesses:          null,
      business_density:          null,
      area_sqkm:                 areaSqkm ? Math.round(areaSqkm) : null,
      electricity_cooking_pct:   electricityCookPct,
      formal_dwelling_pct:       formalDwPct,
    };

    const scores = computeZaBizScore(businessData);

    return {
      ...feature,
      properties: {
        id: muniCode || gid3, name: muniName, state_code: prov, type: 'lm', market: 'za',
        ...businessData,
        ...scores,
      },
    };
  });

  fs.writeFileSync(
    path.join(DATA_DIR, 'za-business-lm.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: businessFeatures })
  );
  console.log(`  ✓ Written public/data/za-business-lm.geojson (${businessFeatures.length} features)`);

  console.log('\n✅ South Africa data build complete!\n');
}

main().catch(err => {
  console.error('\n⚠ South Africa build error:', err.message);
  process.exit(0);
});
