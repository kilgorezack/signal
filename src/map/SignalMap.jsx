import { useEffect, useRef, useState } from 'react';
import { scoreToHex } from '../utils/scoreColors.js';
import { MAP_CENTER, MAP_CAMERA_DISTANCE } from '../config.js';

/**
 * SignalMap — Apple MapKit JS choropleth for SA4 broadband opportunity scores.
 *
 * Props:
 *   geojson        — FeatureCollection (sa4.geojson or business-sa4.geojson), null while loading
 *   selectedId     — currently selected region id (string)
 *   onRegionSelect — callback(properties) when a region is clicked
 *   scoreField     — property name to use for choropleth coloring (default: 'opportunity_score')
 */
export default function SignalMap({ geojson, selectedId, onRegionSelect, scoreField = 'opportunity_score' }) {
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

    // Build a first-coordinate → SA4 props lookup so we can stamp every
    // leaf ring overlay after MapKit expands MultiPolygons into sub-overlays.
    const coordKey = (lat, lng) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
    const coordToProps = new Map();
    for (const f of geojson.features) {
      if (!f.geometry || !f.properties?.id) continue;
      const props = f.properties;
      const rings = f.geometry.type === 'Polygon'
        ? f.geometry.coordinates
        : f.geometry.coordinates.flat(); // MultiPolygon → array of rings
      for (const ring of rings) {
        if (ring[0]) coordToProps.set(coordKey(ring[0][1], ring[0][0]), props);
      }
    }

    const delegate2 = {
      itemForFeature(overlay, feature) {
        if (!overlay) return null;
        const props = feature.properties ?? {};
        const score = props[scoreField];
        overlay.style = new mapkit.Style({
          fillColor: scoreToHex(score),
          fillOpacity: 0.78,
          strokeColor: '#ffffff',
          strokeOpacity: 0.25,
          lineWidth: 0.8,
        });
        overlay.data = props;
        overlayMapRef.current[props.id] = overlay;
        return overlay;
      },

      geoJSONDidComplete(result) {
        map.addItems(result.items);

        // MapKit expands MultiPolygonOverlay into individual PolygonOverlay rings in
        // map.overlays. Stamp each ring with SA4 props using first-coordinate lookup.
        for (const overlay of map.overlays) {
          if (overlay.data?.id) continue; // already has our props (Polygon features)
          const pt = overlay.points?.[0]?.[0]; // points[ring][vertex]
          if (!pt) continue;
          const props = coordToProps.get(coordKey(pt.latitude, pt.longitude));
          if (props) {
            overlay.data = props;
            overlay.style = new mapkit.Style({
              fillColor: scoreToHex(props[scoreField]),
              fillOpacity: 0.78,
              strokeColor: '#ffffff',
              strokeOpacity: 0.25,
              lineWidth: 0.8,
            });
          }
        }

        map.addEventListener('select', (event) => {
          const props = event.overlay?.data;
          if (props?.id) onRegionSelect?.(props);
        });
      },

      geoJSONDidError(error) {
        console.error('GeoJSON import error:', error);
      },
    };

    mapkit.importGeoJSON(geojson, delegate2);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, geojson, scoreField]);

  // ── Update selected region highlight ────────────────────────────────────────
  useEffect(() => {
    if (!overlayMapRef.current) return;
    for (const [id, overlay] of Object.entries(overlayMapRef.current)) {
      const score = overlay.data?.[scoreField];
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
