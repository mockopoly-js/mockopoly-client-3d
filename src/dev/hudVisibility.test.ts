import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { overrideLaunchQuery } from './urlFlags';
import {
  getHudVisible,
  setHudVisible,
  subscribeHudVisible,
  toggleHudVisible,
  resetHudVisibleForTests,
} from './hudVisibility';

/**
 * The live half of `?nohud=1` (see hudVisibility.ts + hudOverride.tsx).
 *
 * `visible` is a LAZY singleton — computed once, from whatever the launch
 * query says, the first time anything asks for it — so every test resets it
 * via `resetHudVisibleForTests()` before touching the query string, otherwise
 * the first test to run in this file would permanently bake its answer in for
 * every test after it.
 */
describe('hudVisibility', () => {
  beforeEach(() => {
    resetHudVisibleForTests();
  });
  afterEach(() => {
    overrideLaunchQuery('');
    resetHudVisibleForTests();
  });

  it('defaults to visible (ON) with no query string', () => {
    overrideLaunchQuery('');
    expect(getHudVisible()).toBe(true);
  });

  it('toggles off and back on', () => {
    overrideLaunchQuery('');
    expect(getHudVisible()).toBe(true);
    toggleHudVisible();
    expect(getHudVisible()).toBe(false);
    toggleHudVisible();
    expect(getHudVisible()).toBe(true);
  });

  it('setHudVisible is a no-op when the value is unchanged (no notify)', () => {
    overrideLaunchQuery('');
    expect(getHudVisible()).toBe(true);
    let calls = 0;
    const unsubscribe = subscribeHudVisible(() => { calls++; });
    setHudVisible(true);
    expect(calls).toBe(0);
    setHudVisible(false);
    expect(calls).toBe(1);
    unsubscribe();
  });

  it('`?nohud=1` seeds the initial value OFF', () => {
    overrideLaunchQuery('?nohud=1');
    expect(getHudVisible()).toBe(false);
  });

  it('`?nohud=0` and `?nohud=false` seed the initial value ON', () => {
    for (const q of ['?nohud=0', '?nohud=false']) {
      resetHudVisibleForTests();
      overrideLaunchQuery(q);
      expect(getHudVisible(), q).toBe(true);
    }
  });

  it('a bare `?nohud` or any other value seeds the initial value OFF', () => {
    for (const q of ['?nohud', '?nohud=yes']) {
      resetHudVisibleForTests();
      overrideLaunchQuery(q);
      expect(getHudVisible(), q).toBe(false);
    }
  });

  it('an unrelated query string leaves it ON', () => {
    overrideLaunchQuery('?glow=0&glowNight=1');
    expect(getHudVisible()).toBe(true);
  });

  it('the URL-seeded value can still be flipped live — the whole point of the toggle', () => {
    overrideLaunchQuery('?nohud=1');
    expect(getHudVisible()).toBe(false);
    toggleHudVisible();
    expect(getHudVisible()).toBe(true);
  });

  it('notifies subscribers on change and stops once unsubscribed', () => {
    overrideLaunchQuery('');
    let calls = 0;
    const unsubscribe = subscribeHudVisible(() => { calls++; });
    toggleHudVisible();
    expect(calls).toBe(1);
    unsubscribe();
    toggleHudVisible();
    expect(calls).toBe(1);
  });
});
