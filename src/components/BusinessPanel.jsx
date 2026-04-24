import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import ScoreGauge from './ScoreGauge.jsx';
import DistributionChart from './DistributionChart.jsx';
import InsightsDrawer from './InsightsDrawer.jsx';
import { formatCount, formatPopulation, formatPercent, formatDensity, SA_TYPE_LABELS } from '../utils/formatters.js';
import { scoreToHex } from '../utils/scoreColors.js';
import { SMARTBIZ_SCORE_LABELS, ANZSIC_SHORT, UK_SIC_SHORT, NAICS_SHORT, ZA_ISIC_SHORT } from '../config.js';

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return <div className="section-label">{children}</div>;
}

function StatCard({ label, value, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-card-value" style={accent ? { color: accent } : undefined}>
        {value ?? '—'}
      </div>
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
        <div className="score-bar-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="score-bar-value" style={{ color }}>{Math.round(pct)}</span>
    </div>
  );
}

function OpportunityRow({ label, value, accentColor }) {
  const pct = value != null ? Math.max(0, Math.min(100, value)) : null;
  return (
    <div className="opportunity-row">
      <span className="opportunity-label">{label}</span>
      <div className="opportunity-bar-wrap">
        <div className="opportunity-bar-track">
          <div
            className="opportunity-bar-fill"
            style={{ width: `${pct ?? 0}%`, background: accentColor || undefined }}
          />
        </div>
      </div>
      <span className="opportunity-value" style={accentColor ? { color: accentColor } : undefined}>
        {pct != null ? `${Math.round(pct)}%` : '—'}
      </span>
    </div>
  );
}

// ── Top industries list ───────────────────────────────────────────────────────

function TopIndustriesList({ distribution, total, industryShort }) {
  const sorted = useMemo(() => {
    if (!distribution) return [];
    return Object.entries(distribution)
      .map(([code, count]) => ({
        code,
        label: (industryShort ?? ANZSIC_SHORT)[code] ?? code,
        count,
        pct: total > 0 ? (count / total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [distribution, total, industryShort]);

  if (sorted.length === 0) return <div className="dist-chart-empty">No data available</div>;

  return (
    <div className="top-industries-list">
      {sorted.map(({ code, label, count, pct }) => (
        <div key={code} className="top-industry-row">
          <span className="top-industry-code">{code}</span>
          <span className="top-industry-label">{label}</span>
          <div className="top-industry-bar-wrap">
            <div
              className="top-industry-bar"
              style={{ width: `${Math.min(100, pct * 2)}%` }}
            />
          </div>
          <span className="top-industry-pct">{pct.toFixed(1)}%</span>
          <span className="top-industry-count">{count.toLocaleString('en-AU')}</span>
        </div>
      ))}
    </div>
  );
}

// ── Industry mix horizontal bar chart ────────────────────────────────────────

const IndTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)',
      borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)',
    }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ color: 'var(--accent-biz)', fontWeight: 600 }}>{payload[0].value}%</div>
    </div>
  );
};

function IndustryMixChart({ distribution, total, industryShort }) {
  const chartData = useMemo(() => {
    if (!distribution || !total) return [];
    return Object.entries(distribution)
      .map(([code, count]) => ({
        label: (industryShort ?? ANZSIC_SHORT)[code] ?? code,
        value: Math.round((count / total) * 1000) / 10,
      }))
      .sort((a, b) => b.value - a.value);
  }, [distribution, total, industryShort]);

  if (!chartData.length) return null;

  return (
    <div>
      <div className="section-label">Industry Mix (% of working population)</div>
      <ResponsiveContainer width="100%" height={chartData.length * 22 + 8}>
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
          barCategoryGap="25%"
        >
          <XAxis
            type="number"
            domain={[0, 'dataMax']}
            tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => `${v}%`}
            width={32}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={100}
            tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<IndTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill="var(--accent-biz)" fillOpacity={0.75} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Business size distribution ────────────────────────────────────────────────

function BizSizeChart({ sizeDist }) {
  const SIZE_ORDER = ['Non-employing', '1–4', '5–19', '20–199', '200+'];
  const data = useMemo(() => {
    if (!sizeDist) return null;
    const total = Object.values(sizeDist).reduce((s, v) => s + v, 0);
    if (total === 0) return null;
    return Object.fromEntries(
      SIZE_ORDER
        .filter(k => sizeDist[k] != null)
        .map(k => [k, Math.round((sizeDist[k] / total) * 100)])
    );
  }, [sizeDist]);

  if (!data) return null;
  return (
    <DistributionChart
      title="Business Size (by employees)"
      data={data}
      unit="%"
      color="var(--accent-biz)"
      height={100}
    />
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function BusinessPanel({
  data,
  onClose,
  onAddToComparison,
  inComparison,
  insights,
  onGenerateInsights,
}) {
  const d            = data ?? {};
  const industryShort = d.market === 'uk' ? UK_SIC_SHORT
    : d.market === 'ca' ? NAICS_SHORT
    : d.market === 'za' ? ZA_ISIC_SHORT
    : ANZSIC_SHORT;

  const scoreComponents = useMemo(() => [
    { key: 'industry_mix_component', label: SMARTBIZ_SCORE_LABELS.industry_mix_component },
    { key: 'high_value_component',   label: SMARTBIZ_SCORE_LABELS.high_value_component },
    { key: 'wp_density_component',   label: SMARTBIZ_SCORE_LABELS.wp_density_component },
    { key: 'biz_density_component',  label: SMARTBIZ_SCORE_LABELS.biz_density_component },
  ], []);

  const topIndustry = useMemo(() => {
    if (!d.industry_distribution) return null;
    const top = Object.entries(d.industry_distribution).sort((a, b) => b[1] - a[1])[0];
    return top ? (industryShort[top[0]] ?? top[0]) : null;
  }, [d.industry_distribution, industryShort]);

  return (
    <div className="panel region-panel">
      {/* Header */}
      <div className="panel-header">
        <div>
          <div className="panel-title">{d.name || '—'}</div>
          <div className="panel-subtitle">
            {d.type ? SA_TYPE_LABELS[d.type] : ''}
            {d.state_code ? ` · ${d.state_code}` : ''}
            {' · Business'}
          </div>
        </div>
        <button className="btn-icon" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="panel-body">

        {/* ── SmartBiz Score ── */}
        <div className="panel-section">
          <div className="smartbiz-score-label">Business Opportunity Score</div>
          <ScoreGauge score={d.smartbiz_score} />
          <div style={{ marginTop: 12 }}>
            {scoreComponents.map(({ key, label }) => (
              d[key] != null && <ScoreBar key={key} label={label} value={d[key]} />
            ))}
          </div>
        </div>

        {/* ── Market Summary ── */}
        <div className="panel-section">
          <SectionLabel>Business Market Summary</SectionLabel>
          <div className="stat-cards-grid">
            <StatCard
              label="Working Population"
              value={formatPopulation(d.working_population)}
            />
            <StatCard
              label="Total Businesses"
              value={d.total_businesses != null ? formatCount(d.total_businesses) : 'ABS est.'}
            />
            <StatCard
              label="Top Industry"
              value={topIndustry}
            />
            <StatCard
              label="Knowledge Workers"
              value={formatPercent(d.knowledge_worker_pct, 0)}
              accent="var(--accent-biz)"
            />
            <StatCard
              label="Healthcare"
              value={formatPercent(d.healthcare_pct, 0)}
            />
            <StatCard
              label="Prof. Services"
              value={formatPercent(d.professional_services_pct, 0)}
            />
          </div>
        </div>

        {/* ── Industry Distribution Chart ── */}
        {d.industry_distribution && (
          <div className="panel-section">
            <IndustryMixChart
              distribution={d.industry_distribution}
              total={d.working_population ?? 0}
              industryShort={industryShort}
            />
          </div>
        )}

        {/* ── Top Industries by workers ── */}
        {d.industry_distribution && (
          <div className="panel-section">
            <SectionLabel>Top Industries by Workers</SectionLabel>
            <TopIndustriesList
              distribution={d.industry_distribution}
              total={d.working_population ?? 0}
              industryShort={industryShort}
            />
          </div>
        )}

        {/* ── Business Size Distribution (if available) ── */}
        {d.business_size_dist && (
          <div className="panel-section">
            <BizSizeChart sizeDist={d.business_size_dist} />
          </div>
        )}

        {/* ── SmartBiz Target Sectors ── */}
        <div className="panel-section">
          <SectionLabel>Business Broadband Signals</SectionLabel>
          <OpportunityRow
            label={d.market === 'uk' ? 'Knowledge Workers (J+K+M+Q+P)' : 'Knowledge Workers (J+K+M+Q+P)'}
            value={d.knowledge_worker_pct}
            accentColor="var(--accent-biz)"
          />
          <OpportunityRow
            label="Healthcare & Social Assistance"
            value={d.healthcare_pct}
          />
          <OpportunityRow
            label="Professional & Technical Services"
            value={d.professional_services_pct}
          />
          <OpportunityRow
            label="Finance & Information Tech"
            value={d.finance_tech_pct}
          />
          <OpportunityRow
            label="Retail Trade (e-commerce potential)"
            value={d.retail_pct}
          />
          <OpportunityRow
            label="Construction (field connectivity)"
            value={d.construction_pct}
          />
        </div>

        {/* ── Details ── */}
        <div className="panel-section">
          <SectionLabel>Region Details</SectionLabel>
          <MetricRow label="Working Population" value={formatPopulation(d.working_population)} />
          <MetricRow label="Worker Density" value={formatDensity(d.working_pop_density)} />
          {d.total_businesses != null && (
            <MetricRow label="Total Businesses" value={formatCount(d.total_businesses)} />
          )}
          {d.business_density != null && (
            <MetricRow label="Business Density" value={`${d.business_density}/km²`} />
          )}
          <MetricRow label="Area" value={d.area_sqkm != null ? `${Math.round(d.area_sqkm).toLocaleString('en-AU')} km²` : '—'} />
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
