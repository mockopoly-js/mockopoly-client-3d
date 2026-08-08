/**
 * Money splitting for the <Money> primitive.
 *
 * <Money> renders currency mark / value / unit as three separate nodes so that
 * a count-up can replace ONLY the value without reflowing anything around it,
 * and so the mark and unit can be sized independently (they clamp to the 11px
 * floor — see the "em trap" note in kit.css §11).
 *
 * This MUST agree with `formatMoney()` in src/utils/format.ts, which the rest of
 * the app already uses. kit.money.test.ts asserts that recombining the parts
 * reproduces `formatMoney()` exactly for a spread of amounts, so the two can
 * never drift apart and show a player two different numbers on one screen.
 */

export interface MoneyParts {
  /** '-' for negative amounts, '' otherwise. */
  sign: string;
  /** Currency mark. */
  cur: string;
  /** The digits, already rounded for the chosen unit. */
  val: string;
  /** 'M', 'K' or '' — the magnitude suffix. */
  unit: string;
}

/** Split an amount into the parts <Money> renders. Mirrors `formatMoney()`. */
export function splitMoney(amount: number): MoneyParts {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (abs >= 1_000_000) {
    return { sign, cur: '£', val: (abs / 1_000_000).toFixed(3), unit: 'M' };
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return { sign, cur: '£', val: k % 1 === 0 ? k.toFixed(0) : k.toFixed(1), unit: 'K' };
  }
  return { sign, cur: '£', val: String(abs), unit: '' };
}
