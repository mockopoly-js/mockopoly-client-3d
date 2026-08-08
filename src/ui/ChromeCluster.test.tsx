import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MuteButton } from './MuteButton';
import { CameraViewButton } from './CameraViewButton';
import { FullscreenButton } from './FullscreenButton';
import { SA_PX } from './kit';
import { BELOW_CHROME_ROW } from './chromeRow';

/**
 * THE NO-OVERLAP INVARIANT — pinned numerically, not just visually.
 *
 * jsdom has no layout engine (every `getBoundingClientRect()` is a zeroed
 * stub), so a real pixel-overlap assertion is not expressible here — this is
 * exactly why the placement is verified with real headless-Chrome screenshots
 * at 844x390 under four safe-area scenarios rather than trusted to this file
 * alone. What IS expressible, and worth pinning, is the arithmetic the
 * placement relies on: this test reads the actual inline `top`/`right` pads the
 * three components render (not a second, hand-copied set of numbers) and checks
 * them against the measured boundaries that justified the placement.
 *
 * *** THE ROW IS IN THE CORNER, AND THE TOAST STACK YIELDED TO IT. *** The row
 * spent one release at y96, held down by <ToastLayer>'s stack, which started at
 * the top of the safe box. On device that read as three buttons loose in the
 * middle of the right edge rather than as window chrome, so the priority was
 * inverted: persistent chrome takes the corner and the transient surface moves.
 * The toast stack now derives its own top from `BELOW_CHROME_ROW` in
 * ./chromeRow, so the clearance below is guaranteed by construction rather than
 * by two files agreeing about a number — and this suite asserts that shape
 * instead of the y96 it used to defend.
 *
 * MEASURED at 844x390, in-game, via a real Chrome DevTools Protocol session
 * with `Emulation.setSafeAreaInsetsOverride` (not inferred):
 *
 *   insets t/r/b/l   chrome row   toast stack (2, one wrapping)   ZoneAct top
 *   0/0/0/0            8..52          60..154                        274
 *   0/47/21/47         8..52          60..154                        265
 *   20/68/29/68       20..64          72..166                        257
 *
 * The 8px gap under the row is identical at --sa-t 0 and 20, which is the whole
 * point of the subtraction in BELOW_CHROME_ROW — the row is positioned against
 * the viewport and the stack against `.kit-safe`, and those two frames differ
 * by exactly `max(0, 8px - sa-t)`.
 */
const CHROME_TOP_PAD = 8;
const TOAST_GAP = 8;
/** The lowest ZoneAct top across the audited scenarios (20/68/29/68). */
const ZONE_ACT_TOP = 257;
/** Apple HIG tap floor — also the minimum honest width for an overlap check. */
const TAP_MIN = 44;

function padPx(style: string): number {
  const m = /,\s*(\d+)px\)/.exec(style);
  if (!m) throw new Error(`could not parse a px pad out of "${style}"`);
  return Number(m[1]);
}

/**
 * The real *rendered* right offset for a chip's `right` style, given the
 * device's actual `--sa-r`. Two shapes exist on purpose:
 *   - `max(var(--sa-r), Npx)`                      → max(saR, N)
 *   - `calc(max(var(--sa-r), Npx) + Mpx)`           → max(saR, N) + M
 * A THIRD shape — `max(var(--sa-r), Npx)` used independently per chip with N
 * already including the pitch (e.g. 60, 112) — LOOKS equivalent but is not:
 * once saR (47 on this device) exceeds the smallest chip's raw pad (8), that
 * chip's floor kicks in and the pitch between chips silently shrinks from 52px
 * to `N - saR`, which is a 31px overlap for N=60. This is exactly what shipped
 * before the 844x390 screenshot caught it, and exactly why this helper
 * evaluates the CSS instead of trusting a second, hand-copied pitch table.
 */
function effectiveRight(style: string, saR: number): number {
  const calc = /^calc\(max\(var\(--sa-r\),\s*(\d+)px\)\s*\+\s*(\d+)px\)$/.exec(style);
  if (calc) return Math.max(saR, Number(calc[1])) + Number(calc[2]);
  const max = /^max\(var\(--sa-r\),\s*(\d+)px\)$/.exec(style);
  if (max) return Math.max(saR, Number(max[1]));
  throw new Error(`unrecognised right-offset shape: "${style}"`);
}

describe('chrome cluster — MuteButton / CameraViewButton / FullscreenButton', () => {
  beforeEach(() => {
    // FullscreenButton renders null unless the API is available — give it the
    // same jsdom stub FullscreenButton.test.tsx uses so it renders here too.
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
  });
  afterEach(() => { cleanup(); });

  it('shares one row Y that is the CORNER, and still clears ZoneAct — never a per-button branch', () => {
    const { container: mute } = render(<MuteButton />);
    const { container: cam } = render(<CameraViewButton />);
    const { container: full } = render(<FullscreenButton />);

    const tops = [mute, cam, full].map((c) => padPx((c.firstChild as HTMLElement).style.top));
    expect(new Set(tops).size).toBe(1); // one shared Y, not three independent guesses

    const rowTop = tops[0];
    expect(rowTop).toBe(CHROME_TOP_PAD);
    // Even with a full 20px PWA top inset the row cannot reach the action
    // cluster: max(20, 8) + 44 = 64, against a ZoneAct that starts at 257.
    expect(Math.max(SA_PX.t, rowTop) + TAP_MIN).toBeLessThan(ZONE_ACT_TOP);
    expect(Math.max(20, rowTop) + TAP_MIN).toBeLessThan(ZONE_ACT_TOP);
  });

  it('the toast stack starts below the row, by construction and at any top inset', () => {
    // The bug this replaces: the row and the stack each hardcoded a y, in two
    // files, measured on one device. `BELOW_CHROME_ROW` instead SUBTRACTS the
    // frame difference — the row is fixed to the viewport at max(--sa-t, 8px),
    // the stack is inside `.kit-safe` which starts at var(--sa-t) — so the
    // clearance is the same 8px whether --sa-t is 0 (Safari tab) or 20 (PWA).
    expect(BELOW_CHROME_ROW).toBe('calc(max(var(--sa-t), 8px) - var(--sa-t) + 52px)');

    for (const saT of [0, 20, 47]) {
      const rowBottom = Math.max(saT, CHROME_TOP_PAD) + TAP_MIN;
      // Evaluate the calc() the same way the engine would.
      const stackTop = saT + (Math.max(saT, CHROME_TOP_PAD) - saT + TAP_MIN + TOAST_GAP);
      expect(stackTop - rowBottom, `--sa-t ${saT}`).toBe(TOAST_GAP);
    }
  });

  it('never stacks the safe inset onto a pad, and the real 52px pitch survives the safe-area floor', () => {
    const { container: mute } = render(<MuteButton />);
    const { container: cam } = render(<CameraViewButton />);
    const { container: full } = render(<FullscreenButton />);

    // MuteButton is the one true anchor: `max(var(--sa-r), 8px)`. Camera and
    // Fullscreen must add their pitch ON TOP OF THIS SAME anchor expression,
    // not re-derive their own independent max() — see effectiveRight()'s
    // docblock for why that second shape drifts once the floor exceeds 8px.
    expect((mute.firstChild as HTMLElement).style.right).toBe('max(var(--sa-r), 8px)');
    expect((cam.firstChild as HTMLElement).style.right).toBe('calc(max(var(--sa-r), 8px) + 52px)');
    expect((full.firstChild as HTMLElement).style.right).toBe('calc(max(var(--sa-r), 8px) + 104px)');

    // Evaluate at a REFERENCE DEVICE's real inset (SA_PX.r = 47, iPhone 13 Pro
    // landscape measured; iOS reports the same value on both long edges) and
    // confirm the pitch holds at the ACTUAL rendered offsets, not the raw pads.
    // SA_PX is a measurement, not a floor: --sa-r is pure env() and resolves to
    // 0 on desktop, which is exactly why the pads have to be at the call sites.
    const rights = [mute, cam, full]
      .map((c) => effectiveRight((c.firstChild as HTMLElement).style.right, SA_PX.r))
      .sort((a, b) => a - b);
    expect(rights).toEqual([47, 99, 151]);
    for (let i = 1; i < rights.length; i++) {
      expect(rights[i] - rights[i - 1]).toBeGreaterThanOrEqual(TAP_MIN);
    }
  });

  it('all three sit on the kit HUD layer, strictly below the toast layer', () => {
    const { container: mute } = render(<MuteButton />);
    const { container: cam } = render(<CameraViewButton />);
    const { container: full } = render(<FullscreenButton />);

    for (const c of [mute, cam, full]) {
      const el = c.firstChild as HTMLElement;
      expect(el.style.zIndex).toBe('110'); // Z.hud
      expect(Number(el.style.zIndex)).toBeLessThan(120); // Z.toast
      expect(el.style.width).toBe('44px');
      expect(el.style.height).toBe('44px');
    }
  });
});
