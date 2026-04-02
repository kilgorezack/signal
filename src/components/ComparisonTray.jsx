import { useMemo } from 'react';
import ScoreGauge from './ScoreGauge.jsx';
import {
  formatPopulation,
  formatCount,
  formatAnnualIncome,
  formatPercent,
  formatAge,
  formatDensity,
} from '../utils/formatters.js';

const METRICS = [
  { label: 'Population',           fn: d => formatPopulation(d?.population) },
  { label: 'Households',           fn: d => formatCount(d?.dwelling_count) },
  { label: 'Avg Annual Income',    fn: d => formatAnnualIncome(d?.median_household_income_weekly) },
  { label: 'Median Age',           fn: d => formatAge(d?.median_age) },
  { label: 'Families w/ Children', fn: d => formatPercent(d?.households_with_children_pct, 0) },
  { label: 'Home Ownership',       fn: d => {
    const v = (d?.owned_outright_pct ?? 0) + (d?.owned_mortgage_pct ?? 0);
    return v > 0 ? formatPercent(v, 0) : '—';
  }},
  { label: 'Single Family Homes',  fn: d => formatPercent(d?.separate_house_pct, 0) },
  { label: 'Internet Access',      fn: d => formatPercent(d?.internet_access_pct, 0) },
  { label: 'Elderly (65+)',        fn: d => formatPercent(d?.elderly_pct, 0) },
  { label: 'Renters',              fn: d => formatPercent(d?.renting_pct, 0) },
  { label: 'Pop. Density',         fn: d => formatDensity(d?.population_density_per_sqkm) },
];

export default function ComparisonTray({ regions, onClose, onRemove, onClear }) {
  if (!regions?.length) return null;

  return (
    <div className="comparison-tray">
      <div className="comparison-header">
        <span className="comparison-title">Comparison ({regions.length})</span>
        <div className="comparison-header-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClear}>Clear all</button>
          <button className="btn-icon" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      <div className="comparison-scroll">
        <table className="comparison-table">
          <thead>
            <tr>
              <th className="comparison-metric-col" />
              {regions.map(r => (
                <th key={r.id} className="comparison-region-col">
                  <div className="comparison-region-header">
                    <div className="comparison-region-name">{r.name}</div>
                    <div className="comparison-region-state">{r.state_code}</div>
                    <button
                      className="btn-icon btn-icon-sm"
                      onClick={() => onRemove(r.id)}
                      title="Remove"
                    >✕</button>
                  </div>
                  <ScoreGauge score={r.opportunity_score} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map(({ label, fn }) => (
              <tr key={label}>
                <td className="comparison-metric-label">{label}</td>
                {regions.map(r => (
                  <td key={r.id} className="comparison-metric-value">{fn(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
