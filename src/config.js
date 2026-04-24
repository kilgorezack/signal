// ─── Australia ────────────────────────────────────────────────────────────────
export const MAP_CENTER = { lat: -25.7, lng: 134.0 };
export const MAP_CAMERA_DISTANCE = 4_200_000;

// ─── Markets ──────────────────────────────────────────────────────────────────
export const MARKETS = {
  au: {
    label:           'Australia',
    flag:            '🇦🇺',
    center:          { lat: -25.7, lng: 134.0 },
    cameraDistance:  4_200_000,
    boundaryCenter:  { lat: -25.7, lng: 134.0 },
    boundarySpan:    { latDelta: 35, lngDelta: 45 },
    dataBadge:       'ABS Census 2021',
    geojsonRes:      '/data/sa4.geojson',
    geojsonBiz:      '/data/business-sa4.geojson',
  },
  uk: {
    label:           'United Kingdom',
    flag:            '🇬🇧',
    center:          { lat: 54.5, lng: -2.5 },
    cameraDistance:  700_000,
    boundaryCenter:  { lat: 54.5, lng: -2.5 },
    boundarySpan:    { latDelta: 12, lngDelta: 14 },
    dataBadge:       'ONS Census 2021',
    geojsonRes:      '/data/uk-lad.geojson',
    geojsonBiz:      '/data/uk-business-lad.geojson',
  },
  ca: {
    label:           'Canada',
    flag:            '🇨🇦',
    center:          { lat: 56.1, lng: -96.3 },
    cameraDistance:  5_500_000,
    boundaryCenter:  { lat: 56.1, lng: -96.3 },
    boundarySpan:    { latDelta: 50, lngDelta: 70 },
    dataBadge:       'StatCan Census 2021',
    geojsonRes:      '/data/ca-cd.geojson',
    geojsonBiz:      '/data/ca-business-cd.geojson',
  },
  za: {
    label:           'South Africa',
    flag:            '🇿🇦',
    center:          { lat: -29.0, lng: 25.0 },
    cameraDistance:  1_800_000,
    boundaryCenter:  { lat: -29.0, lng: 25.0 },
    boundarySpan:    { latDelta: 20, lngDelta: 22 },
    dataBadge:       'Stats SA Census 2022',
    geojsonRes:      '/data/za-lm.geojson',
    geojsonBiz:      '/data/za-business-lm.geojson',
  },
};

// ─── Score labels ─────────────────────────────────────────────────────────────
export const SCORE_WEIGHT_LABELS = {
  income_component:      'Income Level',
  competition_component: 'Underserved Market',
  children_component:    'Families with Children',
  ownership_component:   'Home Ownership',
  density_component:     'Population Density',
  dwelling_component:    'Separate Dwellings',
  elderly_component:     'Elderly Population',
};

export const MAX_COMPARISON = 5;

export const SMARTBIZ_SCORE_LABELS = {
  industry_mix_component: 'Industry Mix',
  wp_density_component:   'Business Density',
  high_value_component:   'High-Value Sectors',
  biz_density_component:  'Business Concentration',
};

// ─── Industry code labels ─────────────────────────────────────────────────────

// Australia: ANZSIC divisions
export const ANZSIC_SHORT = {
  A: 'Agriculture',
  B: 'Mining',
  C: 'Manufacturing',
  D: 'Utilities',
  E: 'Construction',
  F: 'Wholesale',
  G: 'Retail',
  H: 'Accommodation',
  I: 'Transport',
  J: 'Info & Media',
  K: 'Finance',
  L: 'Real Estate',
  M: 'Prof Services',
  N: 'Admin & Support',
  O: 'Public Admin',
  P: 'Education',
  Q: 'Healthcare',
  R: 'Arts & Recreation',
  S: 'Other Services',
};

// Canada: NAICS 2017 (numeric codes, differs from AU/UK letter codes)
export const NAICS_SHORT = {
  '11':    'Agriculture',
  '21':    'Mining & O&G',
  '22':    'Utilities',
  '23':    'Construction',
  '31-33': 'Manufacturing',
  '41':    'Wholesale',
  '44-45': 'Retail',
  '48-49': 'Transport',
  '51':    'Info & Media',
  '52':    'Finance',
  '53':    'Real Estate',
  '54':    'Prof Services',
  '55':    'Management',
  '56':    'Admin & Support',
  '61':    'Education',
  '62':    'Healthcare',
  '71':    'Arts & Rec',
  '72':    'Accommodation',
  '81':    'Other Services',
  '91':    'Public Admin',
};

// South Africa: ISIC Rev. 4 (letter-based A–T, same structure as UK SIC)
export const ZA_ISIC_SHORT = {
  A: 'Agriculture',
  B: 'Mining',
  C: 'Manufacturing',
  D: 'Electricity',
  E: 'Water & Waste',
  F: 'Construction',
  G: 'Wholesale & Retail',
  H: 'Transport',
  I: 'Accommodation',
  J: 'Info & Comm',
  K: 'Finance',
  L: 'Real Estate',
  M: 'Prof Services',
  N: 'Admin & Support',
  O: 'Public Admin',
  P: 'Education',
  Q: 'Healthcare',
  R: 'Arts & Rec',
  S: 'Other Services',
  T: 'Private Households',
};

// UK: SIC 2007 sections (A–U, note different letters vs ANZSIC for F/G/H/I)
export const UK_SIC_SHORT = {
  A: 'Agriculture',
  B: 'Mining',
  C: 'Manufacturing',
  D: 'Utilities',
  E: 'Water & Waste',
  F: 'Construction',
  G: 'Wholesale & Retail',
  H: 'Transport',
  I: 'Accommodation',
  J: 'Info & Comm',
  K: 'Finance',
  L: 'Real Estate',
  M: 'Prof Services',
  N: 'Admin & Support',
  O: 'Public Admin',
  P: 'Education',
  Q: 'Healthcare',
  R: 'Arts & Recreation',
  S: 'Other Services',
  T: 'Households',
  U: 'Extraterritorial',
};
