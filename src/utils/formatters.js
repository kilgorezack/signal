export const SA_TYPE_LABELS = {
  sa4: 'Statistical Area 4',
  sa3: 'Statistical Area 3',
  sa2: 'Statistical Area 2',
};

export function formatPopulation(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString('en-AU');
}

export function formatCount(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-AU');
}

export function formatIncome(weeklyAud) {
  if (weeklyAud == null) return '—';
  return `AU$${weeklyAud.toLocaleString('en-AU')}/wk`;
}

export function formatAnnualIncome(weeklyAud) {
  if (weeklyAud == null) return '—';
  const annual = weeklyAud * 52;
  if (annual >= 1_000) return `AU$${Math.round(annual / 1_000)}k`;
  return `AU$${annual.toLocaleString('en-AU')}`;
}

export function formatPercent(v, decimals = 0) {
  if (v == null) return '—';
  return `${v.toFixed(decimals)}%`;
}

export function formatAge(age) {
  if (age == null) return '—';
  return `${Math.round(age)} yrs`;
}

export function formatDensity(v) {
  if (v == null) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K/km²`;
  return `${Math.round(v)}/km²`;
}

export function formatArea(sqkm) {
  if (sqkm == null) return '—';
  if (sqkm >= 1000) return `${Math.round(sqkm / 1000)}K km²`;
  return `${Math.round(sqkm)} km²`;
}

export function formatHouseholdSize(v) {
  if (v == null) return '—';
  return v.toFixed(1);
}

export function formatScore(v) {
  if (v == null) return '—';
  return Math.round(v).toString();
}
