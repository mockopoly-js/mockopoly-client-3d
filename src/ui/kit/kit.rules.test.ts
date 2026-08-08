/**
 * THE FIVE HARD RULES, ENFORCED.
 *
 * Every rule below is a bug that already shipped and cost a debugging session.
 * A comment cannot stop the next person reintroducing one; this can. It parses
 * kit.css and fails the build.
 *
 *   R1  no child may overhang a clipping ancestor  (.kit-fx-clip exists for this)
 *   R2  entrance animations travel inward
 *   R3  never use opacity to de-emphasise text
 *   R4  filled animations animate transform, never opacity
 *   R5  no nested backdrop-filter
 *
 * Plus regression tests for the seven bugs the mockup batches found in the
 * source system, so a future "port the rest of diegetic.css" pass cannot
 * quietly bring them back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const CSS = readFileSync(join(__dirname, 'kit.css'), 'utf8');

interface Rule { prelude: string; body: string }

/** Brace-matching walk. Recurses into @media so nested rules are checked too. */
function parseRules(src: string): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  let start = 0;
  while (i < src.length) {
    if (src[i] === '{') {
      const prelude = src.slice(start, i).trim();
      let depth = 1;
      let j = i + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      const body = src.slice(i + 1, j - 1);
      out.push({ prelude, body });
      if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
        out.push(...parseRules(body));
      }
      i = j;
      start = j;
    } else if (src[i] === '}') {
      i++;
      start = i;
    } else {
      i++;
    }
  }
  return out;
}

const SRC = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = parseRules(SRC);
const STYLE_RULES = RULES.filter((r) => !r.prelude.startsWith('@'));

const decl = (body: string, prop: string): string | null => {
  const m = new RegExp(`(?:^|[;{]|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body);
  return m ? m[1].trim() : null;
};
const isTextBearing = (body: string): boolean =>
  /(?:^|[;{]|\s)(?:font|font-size|font-weight|font-family|color|text-shadow)\s*:/.test(body);

const keyframes = new Map<string, string>();
for (const r of RULES) {
  const m = /^@keyframes\s+([\w-]+)$/.exec(r.prelude);
  if (m) keyframes.set(m[1], r.body);
}

/** Look a rule up by its exact selector, failing loudly if it has been renamed. */
function mustRule(selector: string): Rule {
  const rule = STYLE_RULES.find((r) => r.prelude === selector);
  if (!rule) throw new Error(`${selector} is not declared in kit.css`);
  return rule;
}
function mustKeyframes(name: string): string {
  const body = keyframes.get(name);
  if (body === undefined) throw new Error(`@keyframes ${name} is not declared in kit.css`);
  return body;
}

describe('R1 — nothing overhangs a clipping ancestor', () => {
  it('controls never clip themselves; .kit-fx-clip is the only control clip', () => {
    // A badge overhangs its button by 5px and a pinned dot by 2px. The moment a
    // control sets overflow, both are sliced and no z-index can save them.
    for (const sel of ['.kit-btn', '.kit-hold', '.kit-arm', '.kit-pod', '.kit-set', '.kit-deed']) {
      expect(decl(mustRule(sel).body, 'overflow'), `${sel} must not clip`).toBeNull();
    }
    expect(mustRule('.kit-fx-clip').body).toMatch(/overflow:\s*hidden/);
  });

  it('every scroll container has interior padding >= the glows it must host', () => {
    // overflow-y:auto clips the X axis too — once one axis is non-visible the
    // other computes to auto. A takeover column was shaving 3px off an 8px
    // swatch glow at x=0 until it got padding-inline.
    const col = mustRule('.kit-takeover__col');
    expect(col.body).toMatch(/overflow-y:\s*auto/);
    expect(col.body).toMatch(/padding-inline:\s*var\(--sp-2\)/);
  });

  it('the completed-monopoly pill carries no negative margin', () => {
    // It used to use margin-left:-5px for optical alignment; a scrolling column
    // sliced the overhang and took the pill's rounded cap and gold ring with it.
    expect(mustRule('.kit-set.is-complete').body).not.toMatch(/margin[^:]*:\s*-/);
    expect(mustRule('.kit-set').body).toMatch(/padding-left:\s*5px/);
  });
});

describe('R2 — entrance animations travel inward', () => {
  const ENTRANCES: Record<string, RegExp> = {
    // top-anchored: settle DOWN into the frame (+Y). A negative translate here
    // pushed the turn strip above the frame edge, where overflow:hidden sliced
    // it for 250ms on every screen load.
    'kit-in-top': /translateY\(6px\)/,
    'kit-in-bottom': /translateY\(-6px\)/,
    // left-anchored: enter from the RIGHT (+X). A negative translate slid the
    // event log into the 47px bezel inset.
    'kit-in-left': /translateX\(8px\)/,
    'kit-in-right': /translateX\(-8px\)/,
  };

  it('the four inward entrances exist and move the right way', () => {
    for (const [name, expected] of Object.entries(ENTRANCES)) {
      expect(mustKeyframes(name)).toMatch(expected);
    }
  });

  it('no entrance scales — a scale on a container shrinks its tap targets (B7)', () => {
    for (const name of Object.keys(ENTRANCES)) {
      expect(mustKeyframes(name)).not.toMatch(/scale\(/);
    }
  });

  it('offers no outward entrance to pick by mistake', () => {
    const entranceNames = [...keyframes.keys()].filter((n) => n.startsWith('kit-in-'));
    expect(entranceNames.sort()).toEqual(Object.keys(ENTRANCES).sort());
  });
});

describe('R3 — opacity is never used to de-emphasise text', () => {
  it('no text-bearing rule carries a fractional opacity', () => {
    // 0 and 1 are a full show/hide, which is not de-emphasis. Anything between
    // multiplies the glyph's text-shadow into a smeared duplicate — this shipped
    // as "a second, semi-transparent text node overlapping" on the money mark.
    const offenders: string[] = [];
    for (const rule of STYLE_RULES) {
      if (!isTextBearing(rule.body)) continue;
      const op = decl(rule.body, 'opacity');
      if (op === null || op === '0' || op === '1') continue;
      offenders.push(`${rule.prelude} { opacity: ${op} }`);
    }
    expect(offenders).toEqual([]);
  });

  it('de-emphasis is expressed as a solid colour token', () => {
    expect(CSS).toMatch(/--text-2:\s*#8888a0/);
    expect(CSS).toMatch(/--text-3:\s*#555570/);
  });
});

describe('R4 — filled animations animate transform, never opacity', () => {
  it('every animation with a fill mode is opacity-free', () => {
    // A throttled/backgrounded frame can freeze `animation: … both` mid-flight.
    // A gold wordmark rendered dark olive and stayed there.
    const filled = new Set<string>();
    for (const r of RULES) {
      for (const m of r.body.matchAll(/animation:\s*([^;]+)/g)) {
        const shorthand = m[1];
        if (!/\b(forwards|both)\b/.test(shorthand)) continue;
        for (const name of keyframes.keys()) {
          if (new RegExp(`\\b${name}\\b`).test(shorthand)) filled.add(name);
        }
      }
    }
    expect(filled.size).toBeGreaterThan(0); // the guard must actually be looking
    const offenders = [...filled].filter((n) => /(?:^|[;{]|\s)opacity\s*:/.test(mustKeyframes(n)));
    expect(offenders).toEqual([]);
  });

  it('the progress animations that DO have a fill mode carry information', () => {
    // These are re-enabled at full duration under prefers-reduced-motion,
    // because a turn clock and a hold ring are state, not decoration.
    for (const name of ['kit-clock-drain', 'kit-clock-sweep', 'kit-hold-fill', 'kit-hold-sweep', 'kit-arm-timer']) {
      expect(keyframes.has(name), `${name} missing`).toBe(true);
      expect(CSS).toMatch(new RegExp(`animation:\\s*${name}[^;]*!important`));
    }
  });
});

describe('R5 — no nested backdrop-filter', () => {
  it('exactly two primitives blur, and the takeover is not one of them', () => {
    const blurring = STYLE_RULES
      .filter((r) => /backdrop-filter:\s*blur\(/.test(r.body))
      .map((r) => r.prelude);
    expect(blurring.sort()).toEqual(['.kit-panel', '.kit-toast']);

    expect(mustRule('.kit-takeover').body).not.toMatch(/backdrop-filter/);
  });

  it('guard selectors strip the blur from anything nested', () => {
    expect(CSS).toMatch(/\.kit-panel \.kit-toast[\s\S]*?backdrop-filter:\s*none\s*!important/);
    expect(CSS).toMatch(/\.kit-scrim\s*\{\s*backdrop-filter:\s*none\s*!important/);
  });
});

describe('headings and UA-margin elements declare margin: 0', () => {
  it('.kit-takeover__title resets its heading margin', () => {
    const title = mustRule('.kit-takeover__title');
    expect(decl(title.body, 'margin')).toBe('0');
  });
});

describe('kit root surfaces declare text colour', () => {
  it('.kit-panel sets a text colour so children inherit correctly', () => {
    const panel = mustRule('.kit-panel');
    expect(decl(panel.body, 'color')).toBe('var(--text)');
  });

  it('.kit-takeover sets a text colour so children inherit correctly', () => {
    const takeover = mustRule('.kit-takeover');
    expect(decl(takeover.body, 'color')).toBe('var(--text)');
  });
});

describe('the seven system bugs stay fixed', () => {
  it('B1 — a disabled two-stage confirm reads as disabled', () => {
    const disabled = STYLE_RULES.find((r) => r.prelude.startsWith('.kit-arm[disabled]'));
    if (!disabled) throw new Error('.kit-arm[disabled] is unstyled — it renders fully lit and inert');
    expect(disabled.body).toMatch(/pointer-events:\s*none/);
    expect(disabled.body).toMatch(/color:\s*var\(--text-3\)/);
    // Disabling mid-arm must not strand a lit warning bar.
    expect(CSS).toMatch(/\.kit-arm\[disabled\] \.kit-arm__timer[\s\S]*?animation:\s*none/);
  });

  it('B2 — --deed-row is a root token, not scoped to .kit-deed', () => {
    expect(mustRule(':root').body).toMatch(/--deed-row:\s*24px/);
    expect(mustRule('.kit-deed').body).not.toMatch(/--deed-row/);
  });

  it('B3 — a locked deed row uses a solid colour, not opacity', () => {
    const locked = STYLE_RULES.filter((r) => r.prelude.includes('.kit-deed__row.is-locked'));
    expect(locked.length).toBeGreaterThan(0);
    for (const r of locked) {
      expect(decl(r.body, 'opacity')).toBeNull();
      expect(r.body).toMatch(/color:\s*var\(--text-3\)/);
    }
  });

  it('B4 — a long deed label truncates instead of spilling across the hairlines', () => {
    const label = mustRule('.kit-deed__label');
    expect(label.body).toMatch(/white-space:\s*nowrap/);
    expect(label.body).toMatch(/text-overflow:\s*ellipsis/);
    // The row is still fixed-height, which is what made wrapping fatal.
    expect(mustRule('.kit-deed__row').body).toMatch(/height:\s*var\(--deed-row\)/);
  });

  it('B5 — a footer-less panel clears the bottom safe inset itself, with a MARGIN', () => {
    // MARGIN, not padding, and the distinction is the whole fix. .kit-panel__body
    // is `overflow-y:auto`, and padding on a scroll container is part of the
    // SCROLLABLE CONTENT — it is only visible once you have scrolled to the end.
    // Until then the last visible row still paints to the container's bottom
    // edge, i.e. the physical bottom of the screen: measured at 47/21 insets, a
    // 44px tappable deed row painted y=346..390 with the whole home-indicator
    // strip over it, despite the old padding-bottom. A margin shortens the
    // scroll VIEWPORT so the clip lands above the inset at every scroll offset.
    const body = mustRule('.kit-panel__body--nofoot').body;
    expect(body).toMatch(/margin-bottom:\s*max\(var\(--sa-b\)/);
    expect(body).not.toMatch(/padding-bottom/);
  });

  it('B6 — a bankrupt/offline pod does not fade its own text', () => {
    for (const sel of ['.kit-pod.is-out', '.kit-pod.is-offline']) {
      expect(decl(mustRule(sel).body, 'opacity'), `${sel} must not fade its text`).toBeNull();
    }
    // Out is carried by a solid colour + line-through, not by alpha.
    expect(CSS).toMatch(/\.kit-pod\.is-out \.kit-pod__name[\s\S]*?text-decoration:\s*line-through/);
  });

  it('B7 — the takeover entrance never scales its tap targets', () => {
    const t = mustRule('.kit-takeover');
    expect(t.body).not.toMatch(/transform:/);
    expect(t.body).toMatch(/transition:\s*opacity/);
    expect(mustRule('.kit-takeover.is-on').body).not.toMatch(/scale\(/);
  });
});

describe('.kit-btn--square is icon-only WITHOUT dropping below the tap floor', () => {
  it('beats the primary CTA at its own specificity, or it silently stays 176px', () => {
    // `.kit-btn--primary` declares min-width AND padding at (0,1,0). A lone
    // `.kit-btn--square` ties on specificity and wins only by source order,
    // which is exactly the kind of coupling that breaks the first time these
    // rules are reordered. The compound selector is the guarantee.
    const sq = STYLE_RULES.find((r) => r.prelude
      .split(',')
      .map((s) => s.trim())
      .includes('.kit-btn--primary.kit-btn--square'));
    if (!sq) throw new Error('.kit-btn--primary.kit-btn--square is not declared in kit.css');
    expect(decl(sq.body, 'min-width')).toBe('var(--tap-primary)');
    expect(decl(sq.body, 'width')).toBe('var(--tap-primary)');
    expect(decl(sq.body, 'padding')).toBe('0');
  });

  it('never sizes a square below 44px, whatever the variant', () => {
    // The base square is the routine floor; `.kit-btn` already carries
    // min-height: var(--tap-min), so width == height == a real tap target.
    const base = mustRule('.kit-btn--square');
    expect(decl(base.body, 'width')).toBe('var(--tap-min)');
    expect(decl(base.body, 'min-width')).toBe('var(--tap-min)');
    expect(decl(mustRule('.kit-btn').body, 'min-height')).toBe('var(--tap-min)');
    // ...and no square rule may re-introduce a fixed height smaller than that.
    for (const r of STYLE_RULES.filter((x) => x.prelude.includes('.kit-btn--square'))) {
      const h = decl(r.body, 'height');
      if (h === null || r.prelude.includes('.kit-dice')) continue;
      expect(h, `${r.prelude} sets height: ${h}`).toMatch(/var\(--tap-(min|primary|lg)\)/);
    }
  });
});

/**
 * THE COMPOSITOR BUDGET. Censused at 844x390 against HEAD: 84 compositor layers
 * (was 20), 12 full-viewport DRAWING layers (was 2) and 171 MB of backing store
 * at dpr 3 (was 27). The DOM rasterises at the device's real dpr while the WebGL
 * renderer is capped at 2, so an iPhone 13 Pro pays 2.25x what a dpr-2 harness
 * reports, into a per-tab tile-memory budget iOS Safari enforces. Everything in
 * here is a rule that keeps a surface NOBODY CAN SEE from costing pixels.
 */
describe('a surface that is not on screen does not paint', () => {
  it('a closed panel and its scrim are parked at visibility:hidden', () => {
    // The panel is parked OUTSIDE the viewport at translateX(100%) and was
    // still `visibility: visible; opacity: 1` carrying a live
    // `backdrop-filter: blur(14px)` — a backdrop ROOT, the single most
    // expensive thing a compositor can be handed, and HEAD had none at all on
    // this screen. It stays mounted so its exit can animate, so the only lever
    // is refusing to paint.
    for (const sel of ['.kit-panel', '.kit-scrim']) {
      expect(decl(mustRule(sel).body, 'visibility'), `${sel} must park hidden`).toBe('hidden');
      expect(decl(mustRule(`${sel}.is-on`).body, 'visibility'), `${sel}.is-on must show`).toBe('visible');
    }
  });

  it('the hide is delayed by the full exit, and the show is not delayed at all', () => {
    // Both halves are load-bearing and they fail in opposite directions. Without
    // the delay on the base rule the panel VANISHES instead of sliding out;
    // without an undelayed `.is-on` the entrance plays to an audience of nobody
    // and the surface appears to snap in at the end.
    for (const sel of ['.kit-panel', '.kit-scrim']) {
      const t = decl(mustRule(sel).body, 'transition') ?? '';
      expect(t, `${sel} must delay its hide by --dur-panel`)
        .toMatch(/visibility\s+0s\s+var\(--ease-linear\)\s+var\(--dur-panel\)/);
      const on = decl(mustRule(`${sel}.is-on`).body, 'transition') ?? '';
      expect(on, `${sel}.is-on must not delay its show`).not.toMatch(/visibility/);
    }
  });

  it('.kit-panel still blurs — this is a paint fix, not a redesign', () => {
    // R5 already pins WHICH primitives blur. This pins that the fix above did
    // not quietly delete the blur to make the number go down.
    expect(mustRule('.kit-panel').body).toMatch(/backdrop-filter:\s*blur\(var\(--blur-md\)\)/);
  });
});

describe('perpetual animations stay on the compositor', () => {
  it('no infinite loop animates a property that forces a repaint', () => {
    // `opacity` and `transform` are applied to an already-rasterised layer.
    // Anything else — `filter` was the offender — re-runs a paint or a filter
    // pass every frame, forever, for decoration. Registered custom properties
    // are allowed: they drive a conic gradient that has to repaint anyway, and
    // none of those loops are infinite.
    const COMPOSITABLE = /^(?:opacity|transform|--[\w-]+)$/;
    const infinite = new Set<string>();
    for (const r of RULES) {
      for (const m of r.body.matchAll(/animation:\s*([^;]+)/g)) {
        if (!/\binfinite\b/.test(m[1])) continue;
        for (const name of keyframes.keys()) {
          if (new RegExp(`\\b${name}\\b`).test(m[1])) infinite.add(name);
        }
      }
    }
    expect(infinite.size).toBeGreaterThan(0); // the guard must be looking at something
    const offenders: string[] = [];
    for (const name of infinite) {
      for (const m of mustKeyframes(name).matchAll(/(?:^|[;{]|\s)([-\w]+)\s*:/g)) {
        if (!COMPOSITABLE.test(m[1])) offenders.push(`${name} { ${m[1]} }`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('kit-urgent-pulse is the one that regressed, so it is named here', () => {
    // It shipped as `filter: brightness(1) -> brightness(1.12)`: the only
    // perpetual animation in the kit on a non-compositable property, running
    // for the whole of every urgent turn clock.
    const pulse = mustKeyframes('kit-urgent-pulse');
    expect(pulse).not.toMatch(/filter/);
    expect(pulse).toMatch(/opacity/);
  });
});

describe('the stylesheet cannot restyle un-migrated screens', () => {
  it('contains no bare element selector', () => {
    // The legacy screens are 100% inline styles. A `button{}` or `body{}` rule
    // here would silently restyle every one of them.
    const bare = STYLE_RULES
      .flatMap((r) => r.prelude.split(','))
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('.kit-') && s !== ':root' && !s.startsWith('[data-clock='));
    expect(bare).toEqual([]);
  });
});
