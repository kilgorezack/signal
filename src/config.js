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
