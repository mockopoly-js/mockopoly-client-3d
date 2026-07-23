import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrientation } from './useOrientation';

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
    _fire(nextMatches: boolean) {
      mql.matches = nextMatches;
      listeners.forEach((h) => h({ matches: nextMatches } as MediaQueryListEvent));
    },
    _listeners: listeners,
  };
  return mql;
}

// ---------- tests ----------

describe('useOrientation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let matchMediaSpy: any = null;
  let mockMql: ReturnType<typeof makeMockMql>;

  beforeEach(() => {
    mockMql = makeMockMql(false); // default: landscape (portrait=false)
    matchMediaSpy = vi.spyOn(window, 'matchMedia').mockReturnValue(
      mockMql as unknown as MediaQueryList,
    );
  });

  afterEach(() => {
    matchMediaSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it('returns landscape when matchMedia(portrait) does not match', () => {
    mockMql = makeMockMql(false);
    matchMediaSpy.mockReturnValue(mockMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useOrientation());
    expect(result.current).toBe('landscape');
  });

  it('returns portrait when matchMedia(portrait) matches', () => {
    mockMql = makeMockMql(true);
    matchMediaSpy.mockReturnValue(mockMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useOrientation());
    expect(result.current).toBe('portrait');
  });

  it('updates from landscape to portrait when media query fires', () => {
    const { result } = renderHook(() => useOrientation());
    expect(result.current).toBe('landscape');
    act(() => {
      mockMql._fire(true); // portrait
    });
    expect(result.current).toBe('portrait');
  });

  it('updates from portrait back to landscape when media query fires', () => {
    mockMql = makeMockMql(true);
    matchMediaSpy.mockReturnValue(mockMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useOrientation());
    expect(result.current).toBe('portrait');
    act(() => {
      mockMql._fire(false); // landscape
    });
    expect(result.current).toBe('landscape');
  });

  it('removes the event listener on unmount (cleanup)', () => {
    const { unmount } = renderHook(() => useOrientation());
    expect(mockMql._listeners.length).toBe(1);
    unmount();
    expect(mockMql.removeEventListener).toHaveBeenCalled();
    expect(mockMql._listeners.length).toBe(0);
  });

  it('returns landscape and does not throw when matchMedia is absent', () => {
    matchMediaSpy?.mockRestore();
    const original = window.matchMedia;
    // @ts-expect-error intentionally removing matchMedia
    delete window.matchMedia;
    let result: string | undefined;
    expect(() => {
      const { result: r } = renderHook(() => useOrientation());
      result = r.current;
    }).not.toThrow();
    expect(result).toBe('landscape');
    window.matchMedia = original;
  });
});
