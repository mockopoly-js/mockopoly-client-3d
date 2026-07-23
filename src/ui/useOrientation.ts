import { useState, useEffect } from 'react';

type Orientation = 'portrait' | 'landscape';

const QUERY = '(orientation: portrait)';

/**
 * Returns current orientation as 'portrait' or 'landscape'.
 * SSR/jsdom-safe: returns 'landscape' (the game's preferred orientation)
 * when window.matchMedia is absent, so callers that gate on portrait get a no-op.
 * Subscribes to changes and cleans up on unmount.
 */
export function useOrientation(): Orientation {
  const getMatch = (): Orientation => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'landscape';
    }
    return window.matchMedia(QUERY).matches ? 'portrait' : 'landscape';
  };

  const [orientation, setOrientation] = useState<Orientation>(getMatch);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) =>
      setOrientation(e.matches ? 'portrait' : 'landscape');
    mql.addEventListener('change', handler);
    // Sync in case it changed between render and effect.
    setOrientation(mql.matches ? 'portrait' : 'landscape');
    return () => mql.removeEventListener('change', handler);
  }, []);

  return orientation;
}
