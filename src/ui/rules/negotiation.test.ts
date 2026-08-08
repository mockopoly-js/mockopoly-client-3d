/**
 * The pure half of custom-rule negotiation.
 *
 * The equity allocator gets the exhaustive treatment because its whole design
 * claim is a NEGATIVE one — "this control cannot express an invalid total" —
 * and a negative claim is only worth what its coverage is. Every reachable
 * state for 2 and 3 partners is enumerated, plus a long random walk, and the
 * sum invariant is asserted at every single step.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { BOARD_SPACES } from '../../constants/board';
import type { ColorGroup, PropertyState } from '../../types/GameState';
import {
  EQ_MIN_UNITS, EQ_TOTAL_UNITS, EQ_UNIT_PCT,
  cashStep, eqInitial, eqMaxUnits, eqPercents, eqSet,
  groupCounts, groupLabel, groupOf, groupSize, holdingsAfter, setDiff,
  shortSpaceName, snapCash,
} from './negotiation';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('equity allocator — the sum invariant', () => {
  it('an opening split already sums to the whole', () => {
    for (const n of [2, 3]) {
      const u = eqInitial(n);
      expect(u).toHaveLength(n);
      expect(sum(u)).toBe(EQ_TOTAL_UNITS);
      expect(Math.min(...u)).toBeGreaterThanOrEqual(EQ_MIN_UNITS);
    }
    // 20 units across 3 is 7 / 7 / 6, not 6 / 6 / 6 with 2 left over.
    expect(eqInitial(3)).toEqual([7, 7, 7 - 1]);
    expect(eqInitial(2)).toEqual([10, 10]);
  });

  it('EVERY reachable state of the control sums to 100%, for 2 and 3 partners', () => {
    for (const n of [2, 3]) {
      // Every starting split that is itself valid...
      const starts: number[][] = [];
      if (n === 2) {
        for (let a = EQ_MIN_UNITS; a <= EQ_TOTAL_UNITS - EQ_MIN_UNITS; a++) starts.push([a, EQ_TOTAL_UNITS - a]);
      } else {
        for (let a = EQ_MIN_UNITS; a <= EQ_TOTAL_UNITS - 2 * EQ_MIN_UNITS; a++) {
          for (let b = EQ_MIN_UNITS; b <= EQ_TOTAL_UNITS - a - EQ_MIN_UNITS; b++) {
            starts.push([a, b, EQ_TOTAL_UNITS - a - b]);
          }
        }
      }
      // ...crossed with every index and every value the stepper could ask for,
      // INCLUDING the out-of-range ones a fast double-tap can produce.
      for (const start of starts) {
        for (let i = 0; i < n; i++) {
          for (let want = -3; want <= EQ_TOTAL_UNITS + 3; want++) {
            const out = eqSet(start, i, want);
            expect(out).toHaveLength(n);
            expect(sum(out)).toBe(EQ_TOTAL_UNITS);
            expect(Math.min(...out)).toBeGreaterThanOrEqual(EQ_MIN_UNITS);
            expect(out[i]).toBe(Math.max(EQ_MIN_UNITS, Math.min(eqMaxUnits(n), want)));
            // The percentages the server actually receives.
            const pct = eqPercents(out);
            expect(sum(pct)).toBe(100);
            for (const p of pct) {
              expect(p).toBeGreaterThanOrEqual(1);
              expect(p).toBeLessThanOrEqual(99);
              expect(Number.isInteger(p)).toBe(true);
            }
          }
        }
      }
    }
  });

  it('survives a long random walk without drifting off 100', () => {
    let seed = 0x5eed;
    const rnd = (max: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % max; };
    for (const n of [2, 3]) {
      let u = eqInitial(n);
      for (let step = 0; step < 20_000; step++) {
        const i = rnd(n);
        // Mostly +/- 1, like a thumb on the stepper; sometimes a wild jump.
        const want = rnd(10) === 0 ? rnd(EQ_TOTAL_UNITS + 6) - 3 : u[i] + (rnd(2) === 0 ? 1 : -1);
        u = eqSet(u, i, want);
        expect(sum(u)).toBe(EQ_TOTAL_UNITS);
        expect(Math.min(...u)).toBeGreaterThanOrEqual(EQ_MIN_UNITS);
      }
    }
  });

  it('keeps the untouched partners in proportion', () => {
    // 10 / 6 / 4 -> pull the first down to 4; the other two share 16 in the
    // same 6:4 ratio, which is 9.6 / 6.4 -> 10 / 6 by largest remainder.
    expect(eqSet([10, 6, 4], 0, 4)).toEqual([4, 10, 6]);
    // Give one everything it can have: the others land exactly on the floor.
    expect(eqSet([10, 6, 4], 0, 18)).toEqual([18, 1, 1]);
    // A two-way split is always the complement.
    for (let a = 1; a <= 19; a++) expect(eqSet([10, 10], 0, a)).toEqual([a, 20 - a]);
  });

  it('a unit is 5% and the whole is 100%', () => {
    expect(EQ_UNIT_PCT * EQ_TOTAL_UNITS).toBe(100);
    expect(eqMaxUnits(2)).toBe(19);
    expect(eqMaxUnits(3)).toBe(18);
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe('set maths — the trade verdict', () => {
  const props = (owners: Record<number, string>): PropertyState[] =>
    Object.entries(owners).map(([i, ownerId]) => ({
      spaceIndex: Number(i), ownerId, houses: 0, hasHotel: false, isMortgaged: false,
    }));

  // 16 / 18 / 19 = Bow Street, Marlborough Street, Vine Street: the orange set.
  const orange = props({ 16: 'me', 18: 'me', 19: 'me', 9: 'them' });

  it('knows which group a space belongs to, and how big it is', () => {
    expect(groupOf(19)).toBe('orange');
    expect(groupOf(0)).toBe(null);            // GO
    expect(groupSize('orange')).toBe(3);
    expect(groupSize('railroad')).toBe(4);
    expect(groupLabel('light-blue')).toBe('LIGHT BLUE');
  });

  it('reports a monopoly LOST when a member of a complete set leaves', () => {
    const before = groupCounts(holdingsAfter(orange, 'me'));
    const after = groupCounts(holdingsAfter(orange, 'me', [19]));
    const d = setDiff(before, after);
    expect(d.lost).toHaveLength(1);
    expect(d.lost[0]).toMatchObject({ group: 'orange', before: 3, after: 2, total: 3 });
    expect(d.gained).toHaveLength(0);
  });

  it('reports a monopoly GAINED when the last member arrives', () => {
    const two = props({ 16: 'me', 18: 'me', 19: 'them' });
    const d = setDiff(
      groupCounts(holdingsAfter(two, 'me')),
      groupCounts(holdingsAfter(two, 'me', [], [19])),
    );
    expect(d.gained).toHaveLength(1);
    expect(d.gained[0]).toMatchObject({ group: 'orange', before: 2, after: 3 });
    expect(d.lost).toHaveLength(0);
  });

  it('says nothing when a trade leaves every set intact', () => {
    const d = setDiff(groupCounts(holdingsAfter(orange, 'me')), groupCounts(holdingsAfter(orange, 'me')));
    expect(d.changed).toHaveLength(0);
  });

  it('a swap inside one group can be a wash', () => {
    // Give 19, get 19 back — the same state, so nothing changed.
    const d = setDiff(
      groupCounts(holdingsAfter(orange, 'me')),
      groupCounts(holdingsAfter(orange, 'me', [19], [19])),
    );
    expect(d.lost).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe('presentation helpers', () => {
  it('shortens suffixes so every real board name fits a two-line 11px box', () => {
    expect(shortSpaceName('Marlborough Street')).toBe('Marlborough St');
    expect(shortSpaceName('Northumberland Avenue')).toBe('Northumberland Ave');
    expect(shortSpaceName('Trafalgar Square')).toBe('Trafalgar Sq');
    expect(shortSpaceName('Kings Cross Station')).toBe('Kings Cross Stn');
    expect(shortSpaceName('Fenchurch St. Station')).toBe('Fenchurch Stn');
    expect(shortSpaceName('The Angle Islington')).toBe('The Angle');
    expect(shortSpaceName('Mayfair')).toBe('Mayfair');
  });

  it('no shortened name has a token that will overflow the 92px label', () => {
    // The label box is 92px at 11px/700; measured at ~5.9px per uppercase
    // character that is 15 characters, and the box holds two lines.
    for (const s of BOARD_SPACES) {
      if (s.price === undefined) continue;
      const tokens = shortSpaceName(s.name).toUpperCase().split(' ');
      for (const t of tokens) expect(t.length).toBeLessThanOrEqual(15);
      expect(tokens.length).toBeLessThanOrEqual(3);
    }
  });

  it('the cash stepper reaches its ceiling in about twenty taps', () => {
    for (const cap of [500_000, 2_000_000, 4_200_000, 9_000_000, 15_000_000, 120_000_000]) {
      const step = cashStep(cap);
      expect(step).toBeGreaterThanOrEqual(100_000);
      expect(Math.ceil(cap / step)).toBeLessThanOrEqual(21);
      // A figure a human would say out loud: 1, 2 or 5 x a power of ten.
      const mag = 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5, 10]).toContain(Math.round(step / mag));
    }
  });

  it('snapCash stays on the grid and inside the ceiling', () => {
    expect(snapCash(1_400_000, 1_000_000, 15_000_000)).toBe(1_000_000);
    expect(snapCash(-5, 1_000_000, 15_000_000)).toBe(0);
    expect(snapCash(99_000_000, 1_000_000, 15_000_000)).toBe(15_000_000);
  });

  it('every colour group in the type union is a real group on the board', () => {
    const groups: ColorGroup[] = ['brown', 'light-blue', 'pink', 'orange', 'red', 'yellow', 'green', 'dark-blue', 'railroad', 'utility'];
    for (const g of groups) expect(groupSize(g)).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// THE STYLESHEET CONTRACTS
//
// jsdom does not load CSS and vitest stubs the import, so getComputedStyle in
// a component test returns nothing at all — these four failures are invisible
// to every other kind of test in this repo, and three of them were shipped
// once already and only caught by measuring a screenshot. Asserted against the
// source, exactly the way kit.rules.test.ts asserts the kit's own five rules.
// ────────────────────────────────────────────────────────────────────────────

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'rules.css'), 'utf8');
/** Declarations only. Half this file is prose, and the prose says the words. */
const DECL = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declaration block for a selector, whitespace-collapsed. */
function block(selector: string): string {
  const spaced = CSS.indexOf(`\n${selector} {`);
  const i = spaced === -1 ? CSS.indexOf(`\n${selector}{`) : spaced;
  expect(i, `no rule for ${selector}`).toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf('}', i)).replace(/\s+/g, ' ');
}

describe('rules.css', () => {
  it('the layer is the positioned, inert, z-carrying ancestor the kit needs', () => {
    const layer = block('.rn-layer');
    expect(layer).toContain('position: fixed');
    expect(layer).toContain('inset: 0');
    // It must carry the z-index ITSELF: position:fixed creates a stacking
    // context, so .kit-takeover's own 140 is scoped inside this element.
    expect(layer).toContain('z-index: var(--z-takeover)');
    // Mounted even when closed, so it must never intercept a tap meant for
    // the 3D board. .kit-takeover.is-on takes events back for itself.
    expect(layer).toContain('pointer-events: none');
  });

  it('every override that competes with a kit declaration outranks it', () => {
    // At equal specificity kit.css wins, because it is imported from main.tsx
    // and this file arrives through the component graph. A bare `.rn-mid` lost
    // to `.kit-takeover__col` and the three-slot body silently collapsed to
    // three equal columns.
    for (const sel of [
      '.kit-takeover__col.rn-mid',
      '.kit-takeover__col.rn-tight',
      '.kit-takeover__col.rn-fixed',
      '.kit-takeover__col.rn-fade',
      '.kit-pip.rn-pip-spent',
      '.kit-pip.rn-pip-due',
      '.kit-set-cap.rn-cap0',
      '.kit-stepper.rn-step',
      '.kit-takeover.rn-tk',
    ]) {
      expect(DECL, `${sel} must stay at 0,2,0`).toContain(sel);
    }
  });

  it('kills the UA heading margin that costs every takeover 40.6px of body', () => {
    // .kit-takeover__title is an <h2> and NOTHING in this app resets heading
    // margins, so it carries `margin: .83em 0` — 21.6px above and below at
    // 26px. Measured: head 84.6 instead of 44, columns 192.4 instead of 233.
    expect(block('.rn-tk .kit-takeover__title')).toContain('margin: 0');
  });

  it('the board window is centred on the verdict column and never fully opaque', () => {
    const win = block('.rn-window');
    // Catan Universe's trade screen hides the map. This one does not.
    expect(win).toContain('mask-image');
    expect(win).toMatch(/calc\(50% - 134px\)/);
    expect(win).toMatch(/calc\(50% \+ 134px\)/);
    // R5: dim the world, never nest a backdrop-filter over a takeover.
    expect(DECL).not.toContain('backdrop-filter');
  });

  it('the inline dot is a block, or it renders at zero size inside a text run', () => {
    // .rn-dot is an <i>. In .rn-split it is a flex item and works; in a
    // .kit-deed__row label it is inline, and an inline box ignores width and
    // height — every player dot in the partnership columns vanished.
    expect(block('.rn-dot')).toContain('display: inline-block');
  });

  it('never stacks a safe inset with interior padding', () => {
    // sa() exists because 47px of bezel clearance is already generous padding.
    // `calc(var(--sa-r) + 14px)` gave a 61px gutter and 15.6% dead space.
    expect(DECL).not.toMatch(/calc\(\s*var\(--sa-[lrtb]\)\s*\+/);
    expect(DECL).toContain('max(var(--sa-r), 14px)');
  });
});
