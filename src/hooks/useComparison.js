import { useState, useCallback } from 'react';
import { MAX_COMPARISON } from '../config.js';

export function useComparison() {
  const [regions, setRegions] = useState([]); // array of region property objects
  const [open, setOpen] = useState(false);

  const add = useCallback((properties) => {
    setRegions(prev => {
      if (prev.some(r => r.id === properties.id)) return prev;
      if (prev.length >= MAX_COMPARISON) return prev;
      return [...prev, properties];
    });
    setOpen(true);
  }, []);

  const remove = useCallback((id) => {
    setRegions(prev => {
      const next = prev.filter(r => r.id !== id);
      if (next.length === 0) setOpen(false);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setRegions([]);
    setOpen(false);
  }, []);

  const isInComparison = useCallback((id) => {
    return regions.some(r => r.id === id);
  }, [regions]);

  return { regions, open, setOpen, add, remove, clear, isInComparison };
}
