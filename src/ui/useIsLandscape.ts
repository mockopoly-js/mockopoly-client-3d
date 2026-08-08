import { useState, useEffect } from 'react';

const QUERY = '(orientation: landscape)';

/**
 * Returns true when the viewport is in landscape orientation.
 *
 * Paired with `useIsMobile`, callers gate a landscape-only mobile layout with
 * `isMobile && isLandscape` — so portrait-mobile and desktop fall through to
 * their existing branches untouched.
 *
 * SSR/jsdom-safe: if `window` or `window.matchMedia` is absent, returns `false`
 * (the portrait/desktop fallback) and does nothing. Subscribes to orientation
 * changes and cleans up on unmount.
 */
export function useIsLandscape(): boolean {
  const getMatch = (): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
  };

  const [isLandscape, setIsLandscape] = useState<boolean>(getMatch);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mql.addEventListener('change', handler);
    // Sync in case it changed between render and effect.
    setIsLandscape(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isLandscape;
}
