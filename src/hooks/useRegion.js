import { useState, useCallback } from 'react';

/**
 * Manages the currently selected region.
 * All data is already embedded in the GeoJSON loaded by the map,
 * so this just tracks which feature properties are "active".
 */
export function useRegion() {
  const [selectedId, setSelectedId] = useState(null);
  const [regionData, setRegionData] = useState(null);

  const selectRegion = useCallback((properties) => {
    if (!properties) {
      setSelectedId(null);
      setRegionData(null);
      return;
    }
    setSelectedId(properties.id);
    setRegionData(properties);
  }, []);

  const clearRegion = useCallback(() => {
    setSelectedId(null);
    setRegionData(null);
  }, []);

  return { selectedId, regionData, selectRegion, clearRegion };
}
