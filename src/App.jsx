import { useState, useEffect, useCallback } from 'react';
import SignalMap from './map/SignalMap.jsx';
import RegionPanel from './components/RegionPanel.jsx';
import BusinessPanel from './components/BusinessPanel.jsx';
import ComparisonTray from './components/ComparisonTray.jsx';
import Toast from './components/Toast.jsx';
import { useRegion } from './hooks/useRegion.js';
import { useInsights } from './hooks/useInsights.js';
import { useComparison } from './hooks/useComparison.js';
import { MARKETS } from './config.js';

export default function App() {
  const [market, setMarket]       = useState('au'); // 'au' | 'uk'
  const [activeTab, setActiveTab] = useState('residential'); // 'residential' | 'business'

  const [geojson, setGeojson]               = useState(null);
  const [geoError, setGeoError]             = useState(null);
  const [businessGeojson, setBusinessGeojson] = useState(null);
  const [businessGeoError, setBusinessGeoError] = useState(null);

  const [toast, setToast] = useState(null);

  const { selectedId, regionData, selectRegion, clearRegion } = useRegion();
  const insights  = useInsights();
  const comparison = useComparison();

  const mkt = MARKETS[market];

  // Load residential GeoJSON whenever market changes
  useEffect(() => {
    setGeojson(null);
    setGeoError(null);
    fetch(mkt.geojsonRes)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load map data (${r.status})`);
        return r.json();
      })
      .then(setGeojson)
      .catch(err => { console.error(err); setGeoError(err.message); });
  }, [market]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load business GeoJSON whenever market changes
  useEffect(() => {
    setBusinessGeojson(null);
    setBusinessGeoError(null);
    fetch(mkt.geojsonBiz)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load business data (${r.status})`);
        return r.json();
      })
      .then(setBusinessGeojson)
      .catch(err => { console.error(err); setBusinessGeoError(err.message); });
  }, [market]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMarketChange = useCallback((m) => {
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

  const isBusiness    = activeTab === 'business';
  const activeGeojson  = isBusiness ? businessGeojson : geojson;
  const activeGeoError = isBusiness ? businessGeoError : geoError;
  const scoreField     = isBusiness ? 'smartbiz_score' : 'opportunity_score';
  const regionCount    = activeGeojson?.features?.length ?? 0;
  const buildCmd       = market === 'uk' ? 'build:data:uk' : market === 'ca' ? 'build:data:ca' : 'build:data';

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <span className="app-logo-mark">◈</span>
          <span className="app-logo-name">Signal</span>
          <span className="app-logo-sub">Broadband Market Intelligence</span>
        </div>

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

          {activeGeojson && (
            <span className="app-data-badge">
              {regionCount} {market === 'uk' ? 'LADs' : market === 'ca' ? 'Census Divisions' : 'SA4 regions'} · {mkt.dataBadge}
            </span>
          )}
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
