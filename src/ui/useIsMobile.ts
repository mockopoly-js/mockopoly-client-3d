import { useState, useEffect } from 'react';

/**
 * Returns true when the viewport width is <= breakpoint px.
 * SSR/jsdom-safe: if window or window.matchMedia is absent, returns false and does nothing.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const query = `(max-width: ${breakpoint}px)`;

  // Determine initial value without throwing when matchMedia is absent.
  const getMatch = (): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  };

  const [isMobile, setIsMobile] = useState<boolean>(getMatch);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    // Sync in case it changed between render and effect.
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return isMobile;
}
