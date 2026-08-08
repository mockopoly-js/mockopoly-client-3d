/**
 * CUSTOM-RULE NEGOTIATION — the pure half.
 *
 * Everything a trade, partnership, rent deal or GO advance has to WORK OUT
 * before it can be shown: the equity allocator, the "what does this do to my
 * sets" diff, name shortening for the 92px chip label, and the stepper's step
 * size. No React, no store, no sockets — so the invariants below can be tested
 * exhaustively instead of poked at through a rendered button.
 */
import { BOARD_SPACES, COLOR_GROUPS } from '../../constants/board';
import { COLOR_GROUP_HEX } from '../../constants/theme';
import type { ColorGroup, PropertyState } from '../../types/GameState';

// ────────────────────────────────────────────────────────────────────────────
// EQUITY ALLOCATOR
//
// THE CONTROL CANNOT EXPRESS AN INVALID TOTAL. That is the whole design.
// Equity is held as INTEGER 5% UNITS — twenty of them — never as three free
// percentages that a validator has to police afterwards. Moving one partner
// redistributes the remainder across the others by largest remainder with a
// one-unit (5%) floor each, so the sum is 20 units = 100% by construction:
// there is no invalid state, no error message and no "3% left over" nag.
//
// The server's own rule (GameEngine.canProposePartnership) is
// `sum === 100 && every percentage in 1..99`. Twenty 5% units satisfies both
// unconditionally — the floor of one unit is 5%, the ceiling with two other
// partners is 90%.
// ────────────────────────────────────────────────────────────────────────────

/** One equity unit, in percent. 20 units = 100%. */
export const EQ_UNIT_PCT = 5;
/** The whole, in units. */
export const EQ_TOTAL_UNITS = 100 / EQ_UNIT_PCT;
/** Nobody may be allocated less than this, so nobody can be zeroed out. */
export const EQ_MIN_UNITS = 1;

/** The largest number of units one partner may hold, given `n` partners. */
export function eqMaxUnits(n: number): number {
  return EQ_TOTAL_UNITS - EQ_MIN_UNITS * (n - 1);
}

/** An even-as-possible opening split. Always sums to EQ_TOTAL_UNITS. */
export function eqInitial(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(EQ_TOTAL_UNITS / n);
  const units = Array.from({ length: n }, () => Math.max(EQ_MIN_UNITS, base));
  let left = EQ_TOTAL_UNITS - units.reduce((a, b) => a + b, 0);
  // Hand the remainder out one unit at a time from the front, so 3 partners
  // read 7 / 7 / 6 rather than 6 / 6 / 8.
  for (let i = 0; left > 0; i = (i + 1) % n) { units[i] += 1; left -= 1; }
  return units;
}

/**
 * Set partner `index` to `want` units and redistribute the rest.
 *
 * Guarantees, for any input that already sums to EQ_TOTAL_UNITS:
 *   - the result sums to EQ_TOTAL_UNITS
 *   - every entry is >= EQ_MIN_UNITS
 *   - entry `index` is exactly clamp(want, EQ_MIN_UNITS, eqMaxUnits(n))
 *   - the others keep their relative proportions as closely as integers allow
 *
 * The others are shared out by LARGEST REMAINDER: floor each proportional
 * share, then give the leftover units to whoever was cut hardest. A naive
 * `Math.round` on each share can overshoot or undershoot the total by a unit,
 * which is precisely the 99% / 101% bug this control exists to make impossible.
 */
export function eqSet(units: number[], index: number, want: number): number[] {
  const n = units.length;
  if (n === 0) return [];
  if (n === 1) return [EQ_TOTAL_UNITS];

  const mine = Math.max(EQ_MIN_UNITS, Math.min(eqMaxUnits(n), Math.round(want)));
  const others = units.map((_, i) => i).filter((i) => i !== index);
  const rest = EQ_TOTAL_UNITS - mine;
  const pool = others.reduce((a, i) => a + units[i], 0);

  // Proportional share of `rest`, or an even split if the others are all zero.
  const raw = others.map((i) => (pool > 0 ? (units[i] / pool) * rest : rest / others.length));
  const share = raw.map((v) => Math.max(EQ_MIN_UNITS, Math.floor(v)));

  let left = rest - share.reduce((a, b) => a + b, 0);

  // Surplus: to the largest fractional remainders first.
  if (left > 0) {
    const order = raw
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; left > 0; k = (k + 1) % order.length) { share[order[k].i] += 1; left -= 1; }
  }

  // Deficit (only possible when the MIN floor lifted somebody): take it back
  // from the largest holder that is still above the floor.
  while (left < 0) {
    let best = -1;
    for (let k = 0; k < share.length; k++) {
      if (share[k] > EQ_MIN_UNITS && (best < 0 || share[k] > share[best])) best = k;
    }
    if (best < 0) break;
    share[best] -= 1;
    left += 1;
  }

  const out = units.slice();
  out[index] = mine;
  others.forEach((i, k) => { out[i] = share[k]; });
  return out;
}

/** Units -> the percentages the server wants. Sums to 100 whenever units do. */
export function eqPercents(units: number[]): number[] {
  return units.map((u) => u * EQ_UNIT_PCT);
}

// ────────────────────────────────────────────────────────────────────────────
// SET MATHS — "what does this offer do to my monopolies"
// ────────────────────────────────────────────────────────────────────────────

const SPACE_GROUP = new Map<number, ColorGroup>(
  BOARD_SPACES.flatMap((s) => (s.colorGroup === undefined ? [] : [[s.index, s.colorGroup] as const])),
);

/**
 * A group's hex, LIFTED where the true value would vanish.
 *
 * Railroad's real colour is #2b2b2b, which is invisible on every dark surface
 * in this system. The kit ships `groupColor(hex, onDark)` for exactly this;
 * this is its data-side twin, taking the group rather than the hex, and
 * answering for `null` too so a non-property space still gets a swatch colour.
 */
export function groupHex(group: ColorGroup | null): string {
  if (group === null) return '#4a4a58';
  const hex = COLOR_GROUP_HEX[group];
  return hex.toLowerCase() === '#2b2b2b' ? '#4a4a58' : hex;
}

/** The colour group a board space belongs to, or null for GO / tax / cards. */
export function groupOf(spaceIndex: number): ColorGroup | null {
  return SPACE_GROUP.get(spaceIndex) ?? null;
}

/** How many spaces are in a colour group (2 or 3 street, 4 rail, 2 utility). */
export function groupSize(group: ColorGroup): number {
  return COLOR_GROUPS[group].length;
}

/** Space indices a player owns once `give` leaves and `get` arrives. */
export function holdingsAfter(
  properties: PropertyState[],
  playerId: string,
  give: readonly number[] = [],
  get: readonly number[] = [],
): number[] {
  const giveSet = new Set(give);
  const getSet = new Set(get);
  const out: number[] = [];
  for (const p of properties) {
    // Applied in the SERVER'S ORDER (GameRoom.executeTrade): the offered side
    // moves first, then the requested side. An index somehow named on both
    // sides therefore leaves and comes straight back, which is what a swap of
    // one property for itself actually does.
    let owned = p.ownerId === playerId;
    if (owned && giveSet.has(p.spaceIndex)) owned = false;
    if (getSet.has(p.spaceIndex)) owned = true;
    if (owned) out.push(p.spaceIndex);
  }
  return out;
}

/** owned-count per colour group for a list of space indices. */
export function groupCounts(spaceIndices: readonly number[]): Map<ColorGroup, number> {
  const m = new Map<ColorGroup, number>();
  for (const i of spaceIndices) {
    const g = groupOf(i);
    if (g !== null) m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export interface SetChange {
  group: ColorGroup;
  /** owned before / after, and how many are in the group. */
  before: number;
  after: number;
  total: number;
}

export interface SetDiff {
  /** Was a complete monopoly, now is not. THE loud one. */
  lost: SetChange[];
  /** Was not complete, now is. */
  gained: SetChange[];
  /** Every group whose count moved at all. */
  changed: SetChange[];
}

/** Compare two group-count maps. Both are produced by `groupCounts`. */
export function setDiff(before: Map<ColorGroup, number>, after: Map<ColorGroup, number>): SetDiff {
  const diff: SetDiff = { lost: [], gained: [], changed: [] };
  const groups = new Set<ColorGroup>([...before.keys(), ...after.keys()]);
  for (const group of groups) {
    const b = before.get(group) ?? 0;
    const a = after.get(group) ?? 0;
    if (b === a) continue;
    const total = groupSize(group);
    const change: SetChange = { group, before: b, after: a, total };
    diff.changed.push(change);
    if (b === total && a < total) diff.lost.push(change);
    if (a === total && b < total) diff.gained.push(change);
  }
  const order = (c: SetChange) => c.group;
  diff.changed.sort((x, y) => order(x).localeCompare(order(y)));
  return diff;
}

/**
 * True when a diff has anything worth calling out, so a caller can substitute
 * the reassuring "nothing of yours breaks" card instead of an empty column.
 */
export function hasConsequences(opts: {
  mine: { lost: SetChange[]; gained: SetChange[] };
  theirs?: { lost: SetChange[] };
}): boolean {
  return opts.mine.lost.length + opts.mine.gained.length + (opts.theirs?.lost.length ?? 0) > 0;
}

// ────────────────────────────────────────────────────────────────────────────
// PRESENTATION HELPERS
// ────────────────────────────────────────────────────────────────────────────

const SUFFIX: [RegExp, string][] = [
  [/\bStreet\b/g, 'St'],
  [/\bRoad\b/g, 'Rd'],
  [/\bAvenue\b/g, 'Ave'],
  [/\bSquare\b/g, 'Sq'],
  [/\bStation\b/g, 'Stn'],
  [/\bSt\. Stn\b/g, 'Stn'],
  [/\bCompany\b/g, 'Co'],
  [/\bThe Angle Islington\b/g, 'The Angle'],
];

/**
 * The name as it appears on a 92px chip label.
 *
 * The chip's label box is a fixed TWO lines at the 11px floor. "Northumberland
 * Avenue" is 21 characters and does not fit; "NORTHUMBERLAND / AVE" does, with
 * the longest single token (NORTHUMBERLAND, ~82px) still inside 92px.
 * THE FULL NAME ALWAYS STAYS IN THE ARIA-LABEL — this is a display shortening,
 * not a rename, and nothing may look a property up by its shortened form.
 */
export function shortSpaceName(name: string): string {
  return SUFFIX.reduce((s, [re, to]) => s.replace(re, to), name);
}

/** A colour group's name as a caps label: 'light-blue' -> 'LIGHT BLUE'. */
export function groupLabel(group: ColorGroup): string {
  return group.replace(/-/g, ' ').toUpperCase();
}

/**
 * A sane increment for a money stepper whose ceiling is `cap`.
 *
 * Starting money is £15M and a stepper is a tap-per-step control, so a fixed
 * £0.2M step is 75 taps to go all-in. This targets ~20 taps across the whole
 * range and then rounds to a 1 / 2 / 5 x 10^n figure so the readout lands on
 * numbers a human would say out loud. £15M -> £1M, £4.2M -> £0.5M.
 */
export function cashStep(cap: number): number {
  const floor = 100_000;
  if (cap <= floor * 20) return floor;
  const target = cap / 20;
  const mag = 10 ** Math.floor(Math.log10(target));
  const n = target / mag;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return Math.max(floor, mult * mag);
}

/** Round a money amount down onto the stepper's grid, so +/- stay on it. */
export function snapCash(value: number, step: number, cap: number): number {
  return Math.max(0, Math.min(cap, Math.round(value / step) * step));
}
