import { describe, it, expect, afterEach } from 'vitest';
import { launchFlag, overrideLaunchQuery } from './urlFlags';

/**
 * THE BUG THIS MODULE EXISTS FOR.
 *
 * `useScreenRouting` mirrors the screen into the URL with
 * `navigate(SCREEN_TO_PATH[screen])`, and those are bare pathnames — React
 * Router replaces the whole location, so the query string is gone by the time
 * the game screen mounts. Every DEV flag in this app is consulted ON that
 * screen. Measured on the real client: `?glow=0` left the glow rendering and
 * `?nohud=1` never emitted its rule; the pre-existing `?glowNight` had the same
 * defect and had never worked from a fresh load.
 *
 * So the one property that must never regress is: THE FLAG IS NOT RE-READ FROM
 * `window.location`. The first test below is that property, stated directly —
 * it fails the moment somebody "simplifies" this back to reading the live URL.
 */
describe('DEV launch-URL flags', () => {
  afterEach(() => { overrideLaunchQuery(''); });

  it('does NOT re-read window.location — the router has already rewritten it', () => {
    overrideLaunchQuery('?glow=0&nohud=1');
    // Simulate exactly what the router does on entering the game screen.
    window.history.replaceState(null, '', '/game');
    expect(window.location.search).toBe('');
    // The snapshot survives it. This is the whole fix.
    expect(launchFlag('glow')).toBe('0');
    expect(launchFlag('nohud')).toBe('1');
    window.history.replaceState(null, '', '/');
  });

  it('returns null for a flag that is not present', () => {
    overrideLaunchQuery('?glow=0');
    expect(launchFlag('nohud')).toBeNull();
    expect(launchFlag('glowNight')).toBeNull();
  });

  it('returns the empty string for a bare flag, which is not null', () => {
    // `?glow` and `?glow=0` must be distinguishable: callers rely on it
    // (a bare `?glow` means "show me the glow", not "delete it").
    overrideLaunchQuery('?glow');
    expect(launchFlag('glow')).toBe('');
  });

  it('reads every flag off one query string', () => {
    overrideLaunchQuery('?glow=0&glowNight=1&nohud=1');
    expect(launchFlag('glow')).toBe('0');
    expect(launchFlag('glowNight')).toBe('1');
    expect(launchFlag('nohud')).toBe('1');
  });

  it('an empty launch query yields null for everything', () => {
    overrideLaunchQuery('');
    for (const f of ['glow', 'glowNight', 'nohud']) expect(launchFlag(f), f).toBeNull();
  });
});
