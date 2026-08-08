import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsLandscape } from './useIsLandscape';

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

describe('useIsLandscape', () => {
  let mockMql: ReturnType<typeof makeMockMql>;
  let matchMediaSpy: MockInstance<typeof window.matchMedia> | null = null;

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

  it('queries the landscape orientation media feature', () => {
    renderHook(() => useIsLandscape());
    expect(matchMediaSpy).toHaveBeenCalledWith('(orientation: landscape)');
  });

  it('returns true when matchMedia reports landscape', () => {
    mockMql = makeMockMql(true);
    matchMediaSpy?.mockReturnValue(mockMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useIsLandscape());
    expect(result.current).toBe(true);
  });

  it('returns false when matchMedia reports portrait', () => {
    mockMql = makeMockMql(false);
    matchMediaSpy?.mockReturnValue(mockMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useIsLandscape());
    expect(result.current).toBe(false);
  });

  it('updates when the change listener fires', () => {
    const { result } = renderHook(() => useIsLandscape());
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
    const { unmount } = renderHook(() => useIsLandscape());
    expect(mockMql._listeners.length).toBe(1);
    unmount();
    expect(mockMql.removeEventListener).toHaveBeenCalled();
    expect(mockMql._listeners.length).toBe(0);
  });

  it('returns false and does not throw when matchMedia is absent', () => {
    matchMediaSpy?.mockRestore();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- we save the property reference only to restore it verbatim below; it is never invoked detached from `window`, so `this` binding is irrelevant.
    const original = window.matchMedia;
    // @ts-expect-error intentionally removing matchMedia
    delete window.matchMedia;
    let result: boolean | undefined;
    expect(() => {
      const { result: r } = renderHook(() => useIsLandscape());
      result = r.current;
    }).not.toThrow();
    expect(result).toBe(false);
    window.matchMedia = original;
  });
});
