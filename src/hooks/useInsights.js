import { useState, useCallback, useRef } from 'react';

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCached(regionId) {
  try {
    const raw = localStorage.getItem(`signal_insights_${regionId}`);
    if (!raw) return null;
    const { text, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return text;
  } catch {
    return null;
  }
}

function setCache(regionId, text) {
  try {
    localStorage.setItem(`signal_insights_${regionId}`, JSON.stringify({ text, ts: Date.now() }));
  } catch {
    // ignore storage errors
  }
}

export function useInsights() {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const generate = useCallback(async (regionId, properties) => {
    // Check cache first
    const cached = getCached(regionId);
    if (cached) {
      setText(cached);
      return;
    }

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setText('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regionId, properties }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Server error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const { delta } = JSON.parse(payload);
            if (delta) {
              full += delta;
              setText(full);
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }

      if (full) setCache(regionId, full);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Failed to generate insights');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setText('');
    setError(null);
    setLoading(false);
  }, []);

  return { text, loading, error, generate, clear };
}
