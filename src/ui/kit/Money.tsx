import { cx } from './cx';
import { splitMoney } from './splitMoney';
import { withVars, type KitStyle } from './tokens';

export type MoneySize = 'hero' | 'hero-lg' | 'glance' | 'glance-lg' | 'label' | 'micro';
export type MoneyTone = 'default' | 'gain' | 'loss' | 'gold' | 'low';

export interface MoneyProps {
  /** Raw amount. Split into mark / value / unit by `splitMoney()`. */
  value: number;
  /** hero 24 · hero-lg 26 · glance 15 · glance-lg 17 · label 13 · micro 11 */
  size?: MoneySize;
  tone?: MoneyTone;
  /**
   * Digit slots reserved for the value, so the box never resizes mid-count-up
   * and nothing around it reflows. Default 4.
   */
  digits?: number;
  /** Flash + rise / drop when the value changes. Set for one render. */
  change?: 'up' | 'down';
  /** Adds the black text-shadow required over the bare 3D world. */
  legible?: boolean;
  className?: string;
  style?: KitStyle;
}

const SIZE_CLASS: Record<MoneySize, string> = {
  hero: 'kit-money--hero',
  'hero-lg': 'kit-money--hero-lg',
  glance: 'kit-money--glance',
  'glance-lg': 'kit-money--glance-lg',
  label: 'kit-money--label',
  micro: 'kit-money--micro',
};

/**
 * A money value, in three nodes: currency mark, digits, unit suffix.
 *
 * The split exists so a count-up can replace ONLY the digits without reflowing
 * its neighbours, and so the mark and unit can be sized independently.
 *
 * *** RULE R3 LIVES HERE. *** The mark and unit used to carry `opacity: .82` /
 * `.78` to de-emphasise them. Over a gold gradient with the mandatory 12px
 * black text-shadow underneath, a semi-transparent glyph reads as a faint
 * smeared duplicate — the client reported "a second, semi-transparent text node
 * overlapping" and that is exactly what it was. Both render at full opacity
 * now; the 11px-against-24px size difference already carries the hierarchy.
 *
 * *** THE em TRAP. *** They were also plain `.72em` / `.66em`, correct at hero
 * size and silently illegal below it: on a 13px money the unit rendered at
 * 8.58px, the smallest type anywhere in the system. They are now
 * `max(11px, .72em)` — ratio where there is room, floor where there is not.
 * Never reintroduce a bare `em` font-size on a nested text node.
 *
 * @example <Money value={4_200_000} size="hero" tone="gold" digits={4} />
 */
export function Money({
  value,
  size = 'glance',
  tone = 'default',
  digits = 4,
  change,
  legible = false,
  className,
  style,
}: MoneyProps) {
  const { sign, cur, val, unit } = splitMoney(value);

  return (
    <span
      className={cx(
        'kit-money',
        SIZE_CLASS[size],
        tone !== 'default' && `kit-money--${tone}`,
        change !== undefined && `is-${change}`,
        legible && 'kit-t-legible',
        className,
      )}
      style={withVars({ '--digits': digits }, style)}
    >
      <span className="kit-money__cur">{sign}{cur}</span>
      <span className="kit-money__val">{val}</span>
      {unit !== '' && <span className="kit-money__unit">{unit}</span>}
    </span>
  );
}

/** Delta chip that rides beside a money value. `<Delta value={1.2} />` -> +1.2 */
export function Delta({ value, className, style }: { value: number; className?: string; style?: KitStyle }) {
  const up = value >= 0;
  return (
    <span className={cx('kit-delta', up ? 'kit-delta--up' : 'kit-delta--down', className)} style={style}>
      {up ? '+' : '−'}{Math.abs(value)}
    </span>
  );
}
