import { scoreToHex } from '../utils/scoreColors.js';

const SIZE = 120;
const STROKE = 10;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;
// Show 75% of the circle (arc from 135° to 45°, going clockwise)
const ARC_FRACTION = 0.75;
const ARC_LENGTH = CIRCUMFERENCE * ARC_FRACTION;

export default function ScoreGauge({ score }) {
  const pct = score != null ? Math.max(0, Math.min(100, score)) / 100 : 0;
  const filled = pct * ARC_LENGTH;
  const color = scoreToHex(score);

  // Rotate so the arc starts at bottom-left (225°) and ends at bottom-right (315°)
  const rotation = 135;

  return (
    <div className="score-gauge">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="var(--bg-raised)"
          strokeWidth={STROKE}
          strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform={`rotate(${rotation} ${SIZE / 2} ${SIZE / 2})`}
        />
        {/* Fill */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform={`rotate(${rotation} ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.4s ease' }}
        />
        {/* Score label */}
        <text
          x={SIZE / 2}
          y={SIZE / 2 - 4}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={score != null ? color : 'var(--text-muted)'}
          fontSize="26"
          fontWeight="700"
          fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
        >
          {score != null ? Math.round(score) : '—'}
        </text>
        <text
          x={SIZE / 2}
          y={SIZE / 2 + 16}
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize="10"
          fontWeight="500"
          fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
          letterSpacing="0.06em"
        >
          OPPORTUNITY
        </text>
      </svg>
    </div>
  );
}
