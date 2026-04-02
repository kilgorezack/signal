import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const CustomTooltip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-raised)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 6,
      padding: '6px 10px',
      fontSize: 12,
      color: 'var(--text-primary)',
    }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ color: 'var(--accent)', fontWeight: 600 }}>
        {unit === '%'
          ? `${payload[0].value}%`
          : payload[0].value?.toLocaleString('en-AU')}
      </div>
    </div>
  );
};

/**
 * DistributionChart — renders a small bar chart for age or income distributions.
 *
 * Props:
 *   title     — section heading string
 *   data      — { [label]: value } object or null
 *   unit      — '%' | 'persons' (controls tooltip format)
 *   color     — bar fill color (default: var(--accent))
 *   height    — chart height in px (default: 150)
 */
export default function DistributionChart({ title, data, unit = 'persons', color, height = 150 }) {
  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="dist-chart-wrap">
        <div className="section-label">{title}</div>
        <div className="dist-chart-empty">No data available</div>
      </div>
    );
  }

  const chartData = Object.entries(data).map(([label, value]) => ({ label, value }));
  const barColor = color || 'var(--accent)';

  return (
    <div className="dist-chart-wrap">
      <div className="section-label">{title}</div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={chartData}
          margin={{ top: 4, right: 4, left: -28, bottom: unit === '%' ? 4 : 24 }}
          barCategoryGap="20%"
        >
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            interval={unit === 'persons' ? 1 : 0}
            angle={unit === 'persons' ? -45 : 0}
            textAnchor={unit === 'persons' ? 'end' : 'middle'}
          />
          <YAxis
            tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => unit === '%' ? `${v}%` : (v >= 1000 ? `${(v/1000).toFixed(0)}k` : v)}
          />
          <Tooltip
            content={<CustomTooltip unit={unit} />}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={barColor} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
