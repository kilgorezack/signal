import { useEffect, useRef, useState } from 'react';
import { scoreToHex } from '../utils/scoreColors.js';
import { MAP_CENTER, MAP_CAMERA_DISTANCE } from '../config.js';

/**
 * SignalMap — Apple MapKit JS choropleth for SA4 broadband opportunity scores.
 *
 * Props:
 *   geojson        — FeatureCollection (sa4.geojson), null while loading
 *   selectedId     — currently selected region id (string)
 *   onRegionSelect — callback(properties) when a region is clicked
 */
export default function SignalMap({ geojson, selectedId, onRegionSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const overlayMapRef = useRef({}); // id → overlay item
  const [tooltip, setTooltip] = useState(null); // { x, y, name, score }
  const [mapReady, setMapReady] = useState(false);

  // ── Initialize MapKit JS ────────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;

    function initMap() {
      if (!window.mapkit || mapRef.current) return;

      try {
        mapkit.init({
          authorizationCallback: done => {
            done(import.meta.env.VITE_MAPKIT_TOKEN || '');
          },
        });

        const map = new mapkit.Map(containerRef.current, {
          center: new mapkit.Coordinate(MAP_CENTER.lat, MAP_CENTER.lng),
          cameraDistance: MAP_CAMERA_DISTANCE,
          mapType: mapkit.Map.MapTypes.MutedStandard,
          colorScheme: mapkit.Map.ColorSchemes.Dark,
          showsCompass: mapkit.FeatureVisibility.Hidden,
          showsScale: mapkit.FeatureVisibility.Hidden,
          showsMapTypeControl: false,
          showsZoomControl: true,
          isRotationEnabled: false,
        });

        // Constrain to Australia
        map.cameraBoundary = new mapkit.CoordinateRegion(
          new mapkit.Coordinate(-25.7, 134.0),
          new mapkit.CoordinateSpan(35, 45)
        );

        mapRef.current = map;
        if (isMounted) setMapReady(true);
      } catch (err) {
        console.error('MapKit init error:', err);
      }
    }

    // MapKit core loads first, then libraries (including 'map') load separately.
    // Poll until both core and the Map constructor are available.
    const checkInterval = setInterval(() => {
      if (window.mapkit && window.mapkit.Map) {
        clearInterval(checkInterval);
        initMap();
      }
    }, 100);
    return () => {
      clearInterval(checkInterval);
      isMounted = false;
    };
  }, []);

  // ── Render choropleth overlays when geojson arrives ─────────────────────────
  useEffect(() => {
    if (!mapReady || !geojson || !mapRef.current) return;

    const map = mapRef.current;

    // Remove old overlays
    if (map.overlays?.length) {
      map.removeOverlays(map.overlays);
    }
    overlayMapRef.current = {};

    const delegate2 = {
      styleForFeature(style, feature) {
        const score = feature.properties?.opportunity_score;
        style.fillColor = scoreToHex(score);
        style.fillOpacity = 0.78;
        style.strokeColor = '#ffffff';
        style.strokeOpacity = 0.25;
        style.lineWidth = 0.8;
        return style;
      },

      itemForFeature(overlay, feature) {
        if (!overlay) return null;
        const props = feature.properties ?? {};
        overlay.data = props; // MapKit's built-in data property for user data
        overlayMapRef.current[props.id] = overlay;
        return overlay;
      },

      geoJSONDidComplete(result) {
        map.addItems(result.items);

        // MapKit overlays don't support DOM events — use map-level select
        map.addEventListener('select', (event) => {
          if (!event.overlay) return;
          const d = event.overlay.data;
          if (!d) return;
          // MapKit may overwrite overlay.data with the full GeoJSON feature after itemForFeature
          const props = (d.type === 'Feature' && d.properties) ? d.properties : d;
          if (props?.id) onRegionSelect?.(props);
        });
      },

      geoJSONDidError(error) {
        console.error('GeoJSON import error:', error);
      },
    };

    mapkit.importGeoJSON(geojson, delegate2);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, geojson]);

  // ── Update selected region highlight ────────────────────────────────────────
  useEffect(() => {
    if (!overlayMapRef.current) return;
    for (const [id, overlay] of Object.entries(overlayMapRef.current)) {
      const score = overlay.data?.opportunity_score;
      const isSelected = id === selectedId;
      overlay.style = new mapkit.Style({
        fillColor: scoreToHex(score),
        fillOpacity: isSelected ? 0.92 : 0.78,
        strokeColor: '#ffffff',
        strokeOpacity: isSelected ? 0.7 : 0.25,
        lineWidth: isSelected ? 2 : 0.5,
      });
    }
  }, [selectedId]);

  // ── Mouse move for tooltip ───────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      setTooltip(prev => prev ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
    };

    container.addEventListener('mousemove', onMouseMove);
    return () => container.removeEventListener('mousemove', onMouseMove);
  }, []);

  return (
    <div className="map-wrapper">
      <div ref={containerRef} className="map-container" />

      {!mapReady && (
        <div className="map-loading">
          <span className="loading-spinner" />
          <span>Loading map…</span>
        </div>
      )}

      {tooltip && (
        <div
          className="map-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          <div className="map-tooltip-name">{tooltip.name}</div>
          <div className="map-tooltip-score" style={{ color: scoreToHex(tooltip.score) }}>
            Score {tooltip.score ?? '—'}
          </div>
        </div>
      )}
    </div>
  );
}
