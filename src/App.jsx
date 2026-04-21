import { useState, useEffect, useCallback, useRef } from 'react';
import SignalMap from './map/SignalMap.jsx';
import RegionPanel from './components/RegionPanel.jsx';
import BusinessPanel from './components/BusinessPanel.jsx';
import ComparisonTray from './components/ComparisonTray.jsx';
import LandingPage from './components/LandingPage.jsx';
import Toast from './components/Toast.jsx';
import { useRegion } from './hooks/useRegion.js';
import { useInsights } from './hooks/useInsights.js';
import { useComparison } from './hooks/useComparison.js';
import { MARKETS } from './config.js';

const LS_MARKET_KEY = 'signal_last_market';
const LS_THEME_KEY  = 'signal_theme';

export default function App() {
  // Restore last market from localStorage — skip landing for returning users
  const lastMarket = localStorage.getItem(LS_MARKET_KEY);
  const validLast  = lastMarket && MARKETS[lastMarket] ? lastMarket : null;

  const savedTheme = localStorage.getItem(LS_THEME_KEY) ?? 'dark';

  const [showLanding, setShowLanding] = useState(!validLast);
  const [market, setMarket]           = useState(validLast);
  const [theme, setTheme]             = useState(savedTheme);
  const [activeTab, setActiveTab]     = useState('residential'); // 'residential' | 'business'

  const [geojson, setGeojson]                   = useState(null);
  const [geoError, setGeoError]                 = useState(null);
  const [businessGeojson, setBusinessGeojson]   = useState(null);
  const [businessGeoError, setBusinessGeoError] = useState(null);

  const [toast, setToast] = useState(null);

  // Background preload cache: { au: {res, biz}, uk: {...}, ca: {...} }
  const preloadCache  = useRef({});
  // Per-market load status for landing page indicators: 'loading' | 'ready'
  const [preloadState, setPreloadState] = useState({});

  // Apply theme to <html> data attribute and persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(LS_THEME_KEY, theme);
  }, [theme]);

  const handleThemeToggle = useCallback(() => {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  }, []);

  const { selectedId, regionData, selectRegion, clearRegion } = useRegion();
  const insights  = useInsights();
  const comparison = useComparison();

  // Kick off background fetches for all markets while landing page is shown
  useEffect(() => {
    if (!showLanding) return;
    Object.entries(MARKETS).forEach(([key, m]) => {
      if (preloadCache.current[key]) return; // already started
      preloadCache.current[key] = {};
      setPreloadState(s => ({ ...s, [key]: 'loading' }));

      const resPromise = fetch(m.geojsonRes).then(r => r.ok ? r.json() : Promise.reject(r.status));
      const bizPromise = fetch(m.geojsonBiz).then(r => r.ok ? r.json() : Promise.reject(r.status));

      Promise.all([resPromise, bizPromise])
        .then(([res, biz]) => {
          preloadCache.current[key] = { res, biz };
          setPreloadState(s => ({ ...s, [key]: 'ready' }));
        })
        .catch(err => {
          console.warn(`Preload failed for ${key}:`, err);
          preloadCache.current[key] = null;
          setPreloadState(s => ({ ...s, [key]: 'error' }));
        });
    });
  }, [showLanding]);

  // Resolve GeoJSON from cache or re-fetch when market is set
  useEffect(() => {
    if (!market) return;
    const cached = preloadCache.current[market];

    if (cached?.res) {
      setGeojson(cached.res);
      setGeoError(null);
    } else {
      setGeojson(null);
      setGeoError(null);
      fetch(MARKETS[market].geojsonRes)
        .then(r => { if (!r.ok) throw new Error(`Failed to load map data (${r.status})`); return r.json(); })
        .then(setGeojson)
        .catch(err => { console.error(err); setGeoError(err.message); });
    }

    if (cached?.biz) {
      setBusinessGeojson(cached.biz);
      setBusinessGeoError(null);
    } else {
      setBusinessGeojson(null);
      setBusinessGeoError(null);
      fetch(MARKETS[market].geojsonBiz)
        .then(r => { if (!r.ok) throw new Error(`Failed to load business data (${r.status})`); return r.json(); })
        .then(setBusinessGeojson)
        .catch(err => { console.error(err); setBusinessGeoError(err.message); });
    }
  }, [market]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLandingSelect = useCallback((m) => {
    localStorage.setItem(LS_MARKET_KEY, m);
    setMarket(m);
    setShowLanding(false);
  }, []);

  const handleGoToLanding = useCallback(() => {
    clearRegion();
    insights.clear();
    comparison.clear();
    setShowLanding(true);
  }, [clearRegion, insights, comparison]);

  const handleMarketChange = useCallback((m) => {
    localStorage.setItem(LS_MARKET_KEY, m);
    setMarket(m);
    clearRegion();
    insights.clear();
    comparison.clear();
  }, [clearRegion, insights, comparison]);

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    clearRegion();
    insights.clear();
  }, [clearRegion, insights]);

  const handleRegionSelect = useCallback((properties) => {
    selectRegion(properties);
    insights.clear();
  }, [selectRegion, insights]);

  const handleClose = useCallback(() => {
    clearRegion();
    insights.clear();
  }, [clearRegion, insights]);

  const handleAddToComparison = useCallback((properties) => {
    if (comparison.isInComparison(properties.id)) return;
    comparison.add(properties);
    showToast(`Added ${properties.name} to comparison`);
  }, [comparison]);

  const handleGenerateInsights = useCallback(() => {
    if (regionData) {
      insights.generate(regionData.id, regionData);
    }
  }, [regionData, insights]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  const mkt            = market ? MARKETS[market] : null;
  const isBusiness     = activeTab === 'business';
  const activeGeojson  = isBusiness ? businessGeojson : geojson;
  const activeGeoError = isBusiness ? businessGeoError : geoError;
  const scoreField     = isBusiness ? 'smartbiz_score' : 'opportunity_score';
  const regionCount    = activeGeojson?.features?.length ?? 0;
  const buildCmd       = market === 'uk' ? 'build:data:uk' : market === 'ca' ? 'build:data:ca' : 'build:data';

  // Show landing until a market is chosen
  if (showLanding) {
    return <LandingPage onSelect={handleLandingSelect} preloadState={preloadState} />;
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <button className="app-logo" onClick={handleGoToLanding} title="Change market">
          <span className="app-logo-mark">◈</span>
          <span className="app-logo-name">Signal</span>
          <span className="app-logo-sub">Broadband Market Intelligence</span>
        </button>

        {/* Tab switcher */}
        <div className="app-tabs">
          <button
            className={`app-tab${activeTab === 'residential' ? ' app-tab--active' : ''}`}
            onClick={() => handleTabChange('residential')}
          >
            Residential
          </button>
          <button
            className={`app-tab app-tab--business${activeTab === 'business' ? ' app-tab--active' : ''}`}
            onClick={() => handleTabChange('business')}
          >
            Business
          </button>
        </div>

        <div className="app-header-right">
          {/* Market selector */}
          <div className="market-selector">
            {Object.entries(MARKETS).map(([key, m]) => (
              <button
                key={key}
                className={`market-btn${market === key ? ' market-btn--active' : ''}`}
                onClick={() => handleMarketChange(key)}
                title={m.label}
              >
                <span className="market-flag">{m.flag}</span>
                <span className="market-label">{m.label}</span>
              </button>
            ))}
          </div>

          {activeGeojson && mkt && (
            <span className="app-data-badge">
              {regionCount} {market === 'uk' ? 'LADs' : market === 'ca' ? 'Census Divisions' : 'SA4 regions'} · {mkt.dataBadge}
            </span>
          )}

          <button
            className="btn-theme"
            onClick={handleThemeToggle}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀︎' : '☾'}
          </button>
        </div>
      </header>

      {/* Map */}
      <main className="app-main">
        {activeGeoError ? (
          <div className="map-error">
            <p>⚠ Could not load {isBusiness ? 'business' : 'map'} data</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{activeGeoError}</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Run <code>npm run {buildCmd}</code> to generate static data files.
            </p>
          </div>
        ) : (
          <SignalMap
            key={`${market}-${activeTab}`}
            geojson={activeGeojson}
            selectedId={selectedId}
            onRegionSelect={handleRegionSelect}
            scoreField={scoreField}
            market={market}
            theme={theme}
          />
        )}

        {/* Region detail panel */}
        {regionData && !isBusiness && (
          <RegionPanel
            data={regionData}
            onClose={handleClose}
            onAddToComparison={handleAddToComparison}
            inComparison={comparison.isInComparison(regionData.id)}
            insights={insights}
            onGenerateInsights={handleGenerateInsights}
          />
        )}

        {regionData && isBusiness && (
          <BusinessPanel
            data={regionData}
            onClose={handleClose}
            onAddToComparison={handleAddToComparison}
            inComparison={comparison.isInComparison(regionData.id)}
            insights={insights}
            onGenerateInsights={handleGenerateInsights}
          />
        )}

        {/* Legend */}
        {activeGeojson && !regionData && (
          <div className="map-legend">
            <div className="map-legend-title">
              {isBusiness ? 'Business Score' : 'Opportunity Score'}
            </div>
            <div className="map-legend-bar" />
            <div className="map-legend-labels">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>
        )}
      </main>

      {/* Comparison tray */}
      {comparison.open && (
        <ComparisonTray
          regions={comparison.regions}
          onClose={() => comparison.setOpen(false)}
          onRemove={comparison.remove}
          onClear={comparison.clear}
        />
      )}

      {/* Toast */}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
