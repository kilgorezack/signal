import { useState, useEffect, useCallback } from 'react';
import SignalMap from './map/SignalMap.jsx';
import RegionPanel from './components/RegionPanel.jsx';
import ComparisonTray from './components/ComparisonTray.jsx';
import Toast from './components/Toast.jsx';
import { useRegion } from './hooks/useRegion.js';
import { useInsights } from './hooks/useInsights.js';
import { useComparison } from './hooks/useComparison.js';

export default function App() {
  const [geojson, setGeojson] = useState(null);
  const [geoError, setGeoError] = useState(null);
  const [toast, setToast] = useState(null);

  const { selectedId, regionData, selectRegion, clearRegion } = useRegion();
  const insights = useInsights();
  const comparison = useComparison();

  // Load GeoJSON once on mount
  useEffect(() => {
    fetch('/data/sa4.geojson')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load map data (${r.status})`);
        return r.json();
      })
      .then(setGeojson)
      .catch(err => {
        console.error(err);
        setGeoError(err.message);
      });
  }, []);

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

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <span className="app-logo-mark">◈</span>
          <span className="app-logo-name">Signal</span>
          <span className="app-logo-sub">Broadband Market Intelligence</span>
        </div>
        <div className="app-header-right">
          {geojson && (
            <span className="app-data-badge">
              {geojson.features?.length ?? 0} SA4 regions · ABS Census 2021
            </span>
          )}
        </div>
      </header>

      {/* Map */}
      <main className="app-main">
        {geoError ? (
          <div className="map-error">
            <p>⚠ Could not load map data</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{geoError}</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Run <code>npm run build:data</code> to generate static data files.
            </p>
          </div>
        ) : (
          <SignalMap
            geojson={geojson}
            selectedId={selectedId}
            onRegionSelect={handleRegionSelect}
          />
        )}

        {/* Region detail panel */}
        {regionData && (
          <RegionPanel
            data={regionData}
            onClose={handleClose}
            onAddToComparison={handleAddToComparison}
            inComparison={comparison.isInComparison(regionData.id)}
            insights={insights}
            onGenerateInsights={handleGenerateInsights}
          />
        )}

        {/* Legend */}
        {geojson && !regionData && (
          <div className="map-legend">
            <div className="map-legend-title">Opportunity Score</div>
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
