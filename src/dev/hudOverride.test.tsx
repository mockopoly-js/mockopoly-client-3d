import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { HudHideStyle } from './hudOverride';
import { overrideLaunchQuery } from './urlFlags';
import { resetHudVisibleForTests, toggleHudVisible } from './hudVisibility';

/**
 * `?nohud=1` — the DEV arm that answers "how much of this frame is the DOM".
 *
 * The flag exists because the question is only answerable ON THE DEVICE: the
 * DOM rasterises at the real dpr (3 on an iPhone 13 Pro) while the WebGL
 * renderer is capped at 2, so a desktop harness at dpr 2 under-reports the DOM's
 * pixel bill by 2.25x. What is asserted here is the two ways the flag could be
 * WORSE THAN NOTHING: firing when it was not asked for (you measure the wrong
 * build and never know), and shipping the rule to production.
 *
 * `HudHideStyle` now reads a LAZY, mutable store (`hudVisibility.ts`) seeded
 * from this flag, rather than re-reading the launch query on every render —
 * that is what lets the Layers panel flip it back on live. Every test below
 * therefore resets that store first, otherwise the first render in this file
 * would permanently bake in its answer for every test after it.
 */
describe('?nohud=1 DEV override', () => {
  // The launch-query snapshot, not window.location: the router drops the
  // search before the game screen mounts. See src/dev/urlFlags.ts.
  const search = (q: string) => { overrideLaunchQuery(q); };
  beforeEach(() => { resetHudVisibleForTests(); });
  afterEach(() => { overrideLaunchQuery(''); resetHudVisibleForTests(); });

  it('renders nothing at all with no query string', () => {
    const { container } = render(<HudHideStyle />);
    expect(container.innerHTML).toBe('');
  });

  it('emits the kill rule on ?nohud=1', () => {
    search('?nohud=1');
    const { container } = render(<HudHideStyle />);
    const style = container.querySelector('style');
    expect(style).not.toBeNull();
    // The harness's own definition of a HUD root — every #root child that does
    // not contain the canvas, except the Layers panel itself (`[data-hud-exempt]`
    // — see DebugTogglePanel.tsx), which must survive to undo this. Naming other
    // surfaces individually would stop covering any overlay added later, which
    // is the failure that matters for a measurement tool.
    expect(style?.textContent).toBe(
      '#root > *:not(:has(canvas)):not([data-hud-exempt]) { display: none !important; }',
    );
  });

  it('is off for ?nohud=0 and ?nohud=false, and on for any other value', () => {
    // Each iteration re-seeds the store fresh: it is a lazily-cached module
    // singleton (see hudVisibility.ts), so re-rendering with a new query
    // string WITHOUT resetting would just read back the first iteration's
    // cached answer.
    for (const q of ['?nohud=0', '?nohud=false']) {
      resetHudVisibleForTests();
      search(q);
      expect(render(<HudHideStyle />).container.innerHTML, q).toBe('');
    }
    // A bare `?nohud` is a deliberate ask, so it counts — unlike `?glow`, where
    // the bare form has to mean "leave it alone" (see ownedGlow.test.ts).
    for (const q of ['?nohud', '?nohud=1', '?nohud=yes']) {
      resetHudVisibleForTests();
      search(q);
      expect(render(<HudHideStyle />).container.querySelector('style'), q).not.toBeNull();
    }
  });

  it('ignores an unrelated query string', () => {
    search('?glow=0&glowNight=1');
    expect(render(<HudHideStyle />).container.innerHTML).toBe('');
  });

  it('hides with display:none, NOT visibility — this is the "DOM is not here" arm', () => {
    // Deliberately the opposite choice from closed panels/takeovers, which must
    // keep their layout so the safe-area audit can still measure them. Here
    // layout and hit-testing have to go too, or the measurement is not the one
    // the flag claims to take.
    search('?nohud=1');
    const text = render(<HudHideStyle />).container.querySelector('style')?.textContent ?? '';
    expect(text).toContain('display: none');
    expect(text).not.toContain('visibility');
  });

  it('flips live when the Layers panel toggles it — no remount, no reload', () => {
    // Boots with the HUD shown (no ?nohud), same as the panel's default-on row.
    search('');
    const { container } = render(<HudHideStyle />);
    expect(container.innerHTML).toBe('');

    // The panel's "DOM HUD" row calls exactly this.
    act(() => { toggleHudVisible(); });
    expect(container.querySelector('style')?.textContent).toBe(
      '#root > *:not(:has(canvas)):not([data-hud-exempt]) { display: none !important; }',
    );

    // And back on — the whole point of a live toggle over the URL flag.
    act(() => { toggleHudVisible(); });
    expect(container.innerHTML).toBe('');
  });
});
