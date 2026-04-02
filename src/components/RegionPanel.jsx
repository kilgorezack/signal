import { useMemo } from 'react';
import ScoreGauge from './ScoreGauge.jsx';
import DistributionChart from './DistributionChart.jsx';
import InsightsDrawer from './InsightsDrawer.jsx';
import {
  formatPopulation,
  formatCount,
  formatAnnualIncome,
  formatPercent,
  formatAge,
  formatDensity,
  formatHouseholdSize,
  SA_TYPE_LABELS,
} from '../utils/formatters.js';
import { scoreToHex, scoreBadgeStyle } from '../utils/scoreColors.js';
import { SCORE_WEIGHT_LABELS } from '../config.js';

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <div className="section-label">{children}</div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-card-value">{value ?? '—'}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}

function MetricRow({ label, value }) {
  return (
    <div className="metric-row">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value ?? '—'}</span>
    </div>
  );
}

function ScoreBar({ label, value }) {
  const pct = value != null ? Math.max(0, Math.min(100, value)) : 0;
  const color = scoreToHex(pct);
  return (
    <div className="score-bar-row">
      <span className="score-bar-label">{label}</span>
      <div className="score-bar-track">
        <div
          className="score-bar-fill"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="score-bar-value" style={{ color }}>{Math.round(pct)}</span>
    </div>
  );
}

function OpportunityRow({ label, value }) {
  const pct = value != null ? Math.max(0, Math.min(100, value)) : null;
  return (
    <div className="opportunity-row">
      <span className="opportunity-label">{label}</span>
      <div className="opportunity-bar-wrap">
        <div className="opportunity-bar-track">
          <div className="opportunity-bar-fill" style={{ width: `${pct ?? 0}%` }} />
        </div>
      </div>
      <span className="opportunity-value">{pct != null ? `${Math.round(pct)}%` : '—'}</span>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function RegionPanel({
  data,
  onClose,
  onAddToComparison,
  inComparison,
  insights,
  onGenerateInsights,
}) {
  const d = data ?? {};

  const homeOwnershipPct = useMemo(() => {
    const outright = d.owned_outright_pct ?? 0;
    const mortgage = d.owned_mortgage_pct ?? 0;
    return outright > 0 || mortgage > 0 ? outright + mortgage : null;
  }, [d.owned_outright_pct, d.owned_mortgage_pct]);

  const lowerIncomePct = useMemo(() => {
    if (d.lower_income_pct != null) return d.lower_income_pct;
    // Derive from income distribution if available
    if (!d.income_distribution) return null;
    const id = d.income_distribution;
    return Math.min(100, (id['$0–$30k'] ?? 0) + Math.round((id['$30k–$75k'] ?? 0) * 0.4));
  }, [d.lower_income_pct, d.income_distribution]);

  const scoreComponents = useMemo(() => [
    { key: 'income_component',      label: SCORE_WEIGHT_LABELS.income_component },
    { key: 'competition_component', label: SCORE_WEIGHT_LABELS.competition_component },
    { key: 'children_component',    label: SCORE_WEIGHT_LABELS.children_component },
    { key: 'ownership_component',   label: SCORE_WEIGHT_LABELS.ownership_component },
    { key: 'density_component',     label: SCORE_WEIGHT_LABELS.density_component },
    { key: 'dwelling_component',    label: SCORE_WEIGHT_LABELS.dwelling_component },
    { key: 'elderly_component',     label: SCORE_WEIGHT_LABELS.elderly_component },
  ], []);

  return (
    <div className="panel region-panel">
      {/* Header */}
      <div className="panel-header">
        <div>
          <div className="panel-title">{d.name || '—'}</div>
          <div className="panel-subtitle">
            {d.type ? SA_TYPE_LABELS[d.type] : ''}
            {d.state_code ? ` · ${d.state_code}` : ''}
          </div>
        </div>
        <button className="btn-icon" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="panel-body">

        {/* ── Opportunity Score ── */}
        <div className="panel-section">
          <ScoreGauge score={d.opportunity_score} />

          <div style={{ marginTop: 12 }}>
            {scoreComponents.map(({ key, label }) => (
              d[key] != null && <ScoreBar key={key} label={label} value={d[key]} />
            ))}
          </div>
        </div>

        {/* ── Summary Stat Cards ── */}
        <div className="panel-section">
          <SectionLabel>Market Summary</SectionLabel>
          <div className="stat-cards-grid">
            <StatCard label="Households" value={formatCount(d.dwelling_count)} />
            <StatCard label="Avg Annual Income" value={formatAnnualIncome(d.median_household_income_weekly)} />
            <StatCard label="Single Family Homes" value={formatPercent(d.separate_house_pct, 0)} />
            <StatCard label="Home Ownership" value={formatPercent(homeOwnershipPct, 0)} />
            <StatCard label="Median Age" value={formatAge(d.median_age)} />
            <StatCard label="Internet Access" value={formatPercent(d.internet_access_pct, 0)} />
          </div>
        </div>

        {/* ── Age Distribution Chart ── */}
        {d.age_distribution && (
          <div className="panel-section">
            <DistributionChart
              title="Age Ranges"
              data={d.age_distribution}
              unit="persons"
              height={160}
            />
          </div>
        )}

        {/* ── Income Distribution Chart ── */}
        {d.income_distribution && (
          <div className="panel-section">
            <DistributionChart
              title="Income Ranges"
              data={d.income_distribution}
              unit="%"
              color="var(--score-mid)"
              height={120}
            />
          </div>
        )}

        {/* ── Market Opportunities ── */}
        <div className="panel-section">
          <SectionLabel>Market Opportunities</SectionLabel>
          <OpportunityRow label="Lower Income (<$1k/wk)" value={lowerIncomePct} />
          <OpportunityRow label="Parental Control Candidates" value={d.households_with_children_pct} />
          <OpportunityRow label="Elderly (65+)" value={d.elderly_pct} />
          <OpportunityRow label="Renter Households" value={d.renting_pct} />
          <OpportunityRow label="Apartment Dwellers" value={d.apartment_pct} />
        </div>

        {/* ── Demographics detail ── */}
        <div className="panel-section">
          <SectionLabel>Demographics</SectionLabel>
          <MetricRow label="Population" value={formatPopulation(d.population)} />
          <MetricRow label="Median Income" value={d.median_household_income_weekly ? `AU$${Math.round(d.median_household_income_weekly).toLocaleString('en-AU')}/wk` : '—'} />
          <MetricRow label="Avg Household Size" value={formatHouseholdSize(d.avg_household_size)} />
          <MetricRow label="Population Density" value={formatDensity(d.population_density_per_sqkm)} />
          <MetricRow label="Youth (0–19)" value={formatPercent(d.youth_pct, 1)} />
          <MetricRow label="Owned Outright" value={formatPercent(d.owned_outright_pct, 1)} />
          <MetricRow label="Renting" value={formatPercent(d.renting_pct, 1)} />
          <MetricRow label="Semi-Detached" value={formatPercent(d.semi_detached_pct, 1)} />
          <MetricRow label="Apartments" value={formatPercent(d.apartment_pct, 1)} />
        </div>

        {/* ── AI Insights ── */}
        <div className="panel-section">
          <InsightsDrawer
            text={insights.text}
            loading={insights.loading}
            error={insights.error}
            onGenerate={onGenerateInsights}
          />
        </div>

        {/* ── Actions ── */}
        <div className="panel-section panel-actions">
          <button
            className={`btn ${inComparison ? 'btn-ghost' : 'btn-secondary'}`}
            onClick={() => onAddToComparison(d)}
            disabled={inComparison}
          >
            {inComparison ? '✓ In Comparison' : '+ Add to Comparison'}
          </button>
        </div>

      </div>
    </div>
  );
}
