/**
 * TOKEN DRIFT GUARD.
 *
 * The token layer has two halves — the CSS custom properties in kit.css and the
 * numeric constants in tokens.ts — and they must agree, or JS layout maths will
 * silently disagree with what the user sees. This parses kit.css and asserts
 * every number the TypeScript side claims.
 *
 * It also asserts that the `--p-*` / `--grp-*` variables still mirror TOKEN_HEX
 * and COLOR_GROUP_HEX in src/constants/theme.ts, which stay the source of truth
 * for colour DATA (they feed three.js materials as well as DOM).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { TOKEN_HEX, COLOR_GROUP_HEX } from '../../constants/theme';
import {
  FS_PX, SP_PX, SA_PX, Z, TAP_MIN, TAP_PRIMARY, TAP_LG, TAP_GAP,
  ROW_PAD, BADGE_RESERVE, PANEL_W, PANEL_W_NARROW, PANEL_W_WIDE,
  BTN_W_PRIMARY, DEED_ROW, TYPE_FLOOR_PX, DUR_MS, KIT,
} from './tokens';

// Comments are stripped first. kit.css documents the forbidden forms by
// quoting them ("NEVER calc(var(--sa-r) + 14px)"), and a scanner that reads the
// prose flags the warning as the offence.
const CSS = readFileSync(join(__dirname, 'kit.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Reads a custom property out of the :root block. */
function token(name: string): string {
  const m = new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm').exec(CSS);
  if (!m) throw new Error(`--${name} is not declared in kit.css`);
  return m[1].trim();
}
const px = (name: string): number => Number(token(name).replace('px', ''));

describe('kit tokens: CSS <-> TS', () => {
  it('type scale matches, and nothing is below the 11px floor', () => {
    expect(px('text-micro')).toBe(FS_PX.micro);
    expect(px('text-micro-lg')).toBe(FS_PX.microLg);
    expect(px('text-label')).toBe(FS_PX.label);
    expect(px('text-label-lg')).toBe(FS_PX.labelLg);
    expect(px('text-glance')).toBe(FS_PX.glance);
    expect(px('text-glance-lg')).toBe(FS_PX.glanceLg);
    expect(px('text-hero')).toBe(FS_PX.hero);
    expect(px('text-hero-lg')).toBe(FS_PX.heroLg);
    expect(px('text-display')).toBe(FS_PX.display);

    expect(TYPE_FLOOR_PX).toBe(11);
    for (const size of Object.values(FS_PX)) expect(size).toBeGreaterThanOrEqual(TYPE_FLOOR_PX);
  });

  it('tap geometry matches — 44 routine, 48 primary, 52 lg, 12 gap', () => {
    expect(px('tap-min')).toBe(TAP_MIN);
    expect(px('tap-primary')).toBe(TAP_PRIMARY);
    expect(px('tap-lg')).toBe(TAP_LG);
    expect(px('tap-gap')).toBe(TAP_GAP);
    expect(TAP_MIN).toBe(44);
    expect(TAP_PRIMARY).toBe(48);
    expect(TAP_GAP).toBe(12);
  });

  it('layout geometry matches', () => {
    expect(px('row-pad')).toBe(ROW_PAD);
    expect(px('badge-reserve')).toBe(BADGE_RESERVE);
    expect(px('panel-w')).toBe(PANEL_W);
    expect(px('btn-w-primary')).toBe(BTN_W_PRIMARY);
    expect(px('deed-row')).toBe(DEED_ROW);
    expect(CSS).toContain(`.kit-panel--narrow { width: ${PANEL_W_NARROW}px; }`);
    expect(CSS).toContain(`.kit-panel--wide { width: ${PANEL_W_WIDE}px; }`);
    // --row-pad must exceed the 2px inset accent bar an active row draws, or
    // the label sits on the bar.
    expect(ROW_PAD).toBeGreaterThan(2);
  });

  it('spacing scale matches', () => {
    expect(px('sp-hair')).toBe(SP_PX.hair);
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
      expect(px(`sp-${step}`)).toBe(SP_PX[step]);
    }
    // --sp-3 IS the tap gap. If they diverge, component padding stops
    // guaranteeing the dead-space rule.
    expect(SP_PX[3]).toBe(TAP_GAP);
  });

  it('safe insets are PURE env() — no design value may be baked into the token', () => {
    // A floor here can never lose (every consumer writes max(var(--sa-l), Npx)
    // with N well under 47) and can never help (a bigger real inset already
    // wins that same max()), so all a floor did was spend 47px a side on
    // desktop and make the call-site pads dead code. Device truth in the
    // token; the design gutter at the call site.
    for (const [side, edge] of [['l', 'left'], ['r', 'right'], ['t', 'top'], ['b', 'bottom']]) {
      expect(token(`sa-${side}`)).toBe(`env(safe-area-inset-${edge}, 0px)`);
    }
    // SA_PX is a reference DEVICE MEASUREMENT for tests to evaluate inset
    // expressions against. It must not reappear in the stylesheet as a floor.
    expect(SA_PX.l).toBe(SA_PX.r); // symmetric in landscape
    for (const side of ['l', 'r', 't', 'b']) {
      expect(token(`sa-${side}`)).not.toContain('max(');
    }
  });

  it('never stacks a safe inset onto padding anywhere in the stylesheet', () => {
    // calc(--sa-* + …) is the exact bug that cost 15.6% of the panel width.
    // There is no longer a carve-out for --sa-b: the two places that used
    // calc(var(--sa-b) + var(--sp-1)) — the footer and the footer-less body —
    // are max() like everything else, so all four sides are covered here.
    const bad = [...CSS.matchAll(/calc\([^)]*var\(--sa-[lrtb]\)[^)]*[+][^)]*\)/g)];
    expect(bad.map((m) => m[0])).toEqual([]);
  });

  it('every raw --sa-* consumer pairs the inset with a design pad', () => {
    // Pure env() means a bare var(--sa-r) is 0 on desktop and in headless
    // review, so a call site that forgets its pad goes flush to the edge and
    // nothing catches it in a screenshot. This does.
    //
    // .kit-safe's TOP is the one sanctioned exception: the HUD is deliberately
    // anchored to the top of the safe area (the turn strip is the first thing
    // in the frame and carries its own offset), and in landscape that inset is
    // genuinely 0 on every phone without a Dynamic Island.
    const ALLOWED_BARE = ['inset: var(--sa-t) max('];
    const uses = [...CSS.matchAll(/[\w-]+:[^;{}]*var\(--sa-[lrtb]\)[^;{}]*/g)].map((m) => m[0]);
    const unpadded = uses.filter((u) => {
      if (ALLOWED_BARE.some((a) => u.startsWith(a))) return false;
      // Every var(--sa-x) occurrence must sit inside a max(…) with a companion.
      return [...u.matchAll(/var\(--sa-[lrtb]\)/g)].some((occ) => {
        const before = u.slice(0, occ.index);
        const open = (before.match(/max\(/g) ?? []).length;
        const close = (before.match(/\)/g) ?? []).length - (before.match(/var\(/g) ?? []).length;
        return open <= close;
      });
    });
    expect(unpadded).toEqual([]);
  });

  it('z-index scale matches and preserves the mockup ordering', () => {
    const zNames: [keyof typeof Z, string][] = [
      ['scene', 'z-scene'], ['sceneFx', 'z-scene-fx'], ['world', 'z-world'],
      ['hudUnder', 'z-hud-under'], ['hud', 'z-hud'], ['hudOver', 'z-hud-over'],
      ['toast', 'z-toast'], ['scrim', 'z-scrim'], ['panel', 'z-panel'],
      ['takeover', 'z-takeover'], ['guides', 'z-guides'], ['dev', 'z-dev'],
    ];
    for (const [key, css] of zNames) expect(Number(token(css))).toBe(Z[key]);

    const order = zNames.map(([k]) => Z[k]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Rebased above the legacy inline z-indexes (30..60) this kit replaces, and
    // below the dev/loading overlays (9000+).
    expect(Z.scene).toBeGreaterThan(60);
    expect(Z.dev).toBeLessThan(9000);
  });

  it('motion durations match', () => {
    const ms = (n: string) => Number(token(n).replace('ms', ''));
    expect(ms('dur-instant')).toBe(DUR_MS.instant);
    expect(ms('dur-tap')).toBe(DUR_MS.tap);
    expect(ms('dur-feedback')).toBe(DUR_MS.feedback);
    expect(ms('dur-swap')).toBe(DUR_MS.swap);
    expect(ms('dur-scene')).toBe(DUR_MS.scene);
    expect(ms('dur-panel')).toBe(DUR_MS.panel);
    expect(ms('dur-takeover')).toBe(DUR_MS.takeover);
    expect(ms('dur-light')).toBe(DUR_MS.light);
    expect(ms('dur-hold')).toBe(DUR_MS.hold);
  });

  it('player colours mirror TOKEN_HEX exactly', () => {
    for (const [name, hex] of Object.entries(TOKEN_HEX)) {
      expect(token(`p-${name}`)).toBe(hex);
    }
    expect(Object.keys(KIT.player).sort()).toEqual(Object.keys(TOKEN_HEX).sort());
  });

  it('colour groups mirror COLOR_GROUP_HEX exactly', () => {
    for (const [name, hex] of Object.entries(COLOR_GROUP_HEX)) {
      expect(token(`grp-${name}`)).toBe(hex);
    }
    expect(Object.keys(KIT.group).sort()).toEqual(Object.keys(COLOR_GROUP_HEX).sort());
    // Railroad's true value vanishes on dark surfaces, hence the lift.
    expect(token('grp-railroad-lift')).toBe('#4a4a58');
  });
});
