import { useState } from 'react';
import { MARKETS } from '../config.js';
import ScoreGauge from './ScoreGauge.jsx';

const MARKET_META = {
  au: {
    regionLabel: '107 Statistical Areas',
    census:      'ABS Census 2021',
    description: 'SA4-level residential and business scoring across all Australian states and territories.',
    gradient:    'linear-gradient(135deg, rgba(0,105,55,0.18) 0%, rgba(255,205,0,0.10) 100%)',
    border:      'rgba(0,180,90,0.22)',
    glow:        'rgba(0,180,90,0.12)',
  },
  uk: {
    regionLabel: '331 Local Authority Districts',
    census:      'ONS Census 2021',
    description: 'LAD-level coverage across England and Wales with ASHE earnings and NS-SeC data.',
    gradient:    'linear-gradient(135deg, rgba(1,33,105,0.20) 0%, rgba(200,16,46,0.12) 100%)',
    border:      'rgba(100,140,255,0.22)',
    glow:        'rgba(100,140,255,0.12)',
  },
  ca: {
    regionLabel: '293 Census Divisions',
    census:      'StatCan Census 2021',
    description: 'Census Division scoring across all provinces and territories with NAICS industry data.',
    gradient:    'linear-gradient(135deg, rgba(255,0,0,0.14) 0%, rgba(255,255,255,0.04) 100%)',
    border:      'rgba(255,80,80,0.22)',
    glow:        'rgba(255,80,80,0.12)',
  },
};

export default function LandingPage({ onSelect, preloadState, avgScores }) {
  const [hovered, setHovered] = useState(null);

  return (
    <div className="landing">
      <div className="landing-bg" />

      <div className="landing-content">
        {/* Logo */}
        <div className="landing-logo">
          <span className="landing-logo-mark">◈</span>
          <span className="landing-logo-name">Signal</span>
        </div>
        <p className="landing-tagline">Broadband Market Intelligence</p>
        <p className="landing-sub">Select a market to explore residential and business broadband opportunities.</p>

        {/* Market cards */}
        <div className="landing-cards">
          {Object.entries(MARKETS).map(([key, m]) => {
            const meta   = MARKET_META[key];
            const status = preloadState[key];
            const ready  = status === 'ready';
            const loading = status === 'loading';

            return (
              <button
                key={key}
                className={`landing-card${hovered === key ? ' landing-card--hovered' : ''}`}
                style={{
                  '--card-gradient': meta.gradient,
                  '--card-border':   meta.border,
                  '--card-glow':     meta.glow,
                }}
                onClick={() => onSelect(key)}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered(null)}
              >
                <div className="landing-card-top">
                  <div>
                    <div className="landing-card-flag">{m.flag}</div>
                    <div className="landing-card-name">{m.label}</div>
                    <div className="landing-card-region">{meta.regionLabel}</div>
                  </div>
                  <div className="landing-card-gauge">
                    <ScoreGauge score={avgScores[key] ?? null} label="AVG SCORE" size={88} />
                  </div>
                </div>
                <div className="landing-card-desc">{meta.description}</div>
                <div className="landing-card-footer">
                  <span className="landing-card-census">{meta.census}</span>
                  <span className={`landing-card-status ${ready ? 'ready' : loading ? 'loading' : 'idle'}`}>
                    {ready ? '● Ready' : loading ? '○ Loading…' : '○ Click to load'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
