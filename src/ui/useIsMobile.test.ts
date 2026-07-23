import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './useIsMobile';

// ---------- helpers ----------

type ChangeHandler = (e: MediaQueryListEvent) => void;

function makeMockMql(matches: boolean) {
  const listeners: ChangeHandler[] = [];
  const mql = {
    matches,
    addEventListener: vi.fn((_type: string, handler: ChangeHandler) => {
      listeners.push(handler);
    }),
    removeEventListener: vi.fn((_type: string, handler: ChangeHandler) => {
      const idx = listeners.indexOf(handler);
      if (idx !== -1) listeners.splice(idx, 1);
    }),
    // helper: simulate a media-query change event
    _fire(nextMatches: boolean) {
      mql.matches = nextMatches;
      listeners.forEach((h) => h({ matches: nextMatches } as MediaQueryListEvent));
    },
    _listeners: listeners,
  };
  return mql;
}

// ---------- tests ----------

describe('useIsMobile', () => {
  let mockMql: ReturnType<typeof makeMockMql>;
  // Use a loose type so strict TS doesn't complain about overloaded matchMedia signatures.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let matchMediaSpy: any = null;

  beforeEach(() => {
    mockMql = makeMockMql(false);
    matchMediaSpy = vi.spyOn(window, 'matchMedia').mockReturnValue(
      mockMql as unknown as MediaQueryList,
    );
  });

  afterEach(() => {
    matchMediaSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it('returns the initial match state from matchMedia', () => {
    mockMql = makeMockMql(true);
    matchMediaSpy?.mockReturnValue(mockMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns false when matchMedia says not-mobile', () => {
    mockMql = makeMockMql(false);
    matchMediaSpy?.mockReturnValue(mockMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('updates when the change listener fires', () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => {
      mockMql._fire(true);
    });
    expect(result.current).toBe(true);
    act(() => {
      mockMql._fire(false);
    });
    expect(result.current).toBe(false);
  });

  it('removes the event listener on unmount', () => {
    const { unmount } = renderHook(() => useIsMobile());
    expect(mockMql._listeners.length).toBe(1);
    unmount();
    expect(mockMql.removeEventListener).toHaveBeenCalled();
    expect(mockMql._listeners.length).toBe(0);
  });

  it('returns false and does not throw when matchMedia is absent', () => {
    matchMediaSpy?.mockRestore();
    // Delete matchMedia to simulate jsdom/SSR absence
    const original = window.matchMedia;
    // @ts-expect-error intentionally removing matchMedia
    delete window.matchMedia;
    let result: boolean | undefined;
    expect(() => {
      const { result: r } = renderHook(() => useIsMobile());
      result = r.current;
    }).not.toThrow();
    expect(result).toBe(false);
    // Restore
    window.matchMedia = original;
  });

  it('respects a custom breakpoint in the query string', () => {
    renderHook(() => useIsMobile(1024));
    expect(matchMediaSpy).toHaveBeenCalledWith('(max-width: 1024px)');
  });
});
