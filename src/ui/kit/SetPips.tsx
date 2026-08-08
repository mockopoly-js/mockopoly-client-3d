import { cx } from './cx';
import { withVars, type KitStyle } from './tokens';

export interface SetPipsProps {
  /** Group colour, e.g. COLOR_GROUP_HEX['light-blue']. */
  color: string;
  /** How many of the group you own. */
  owned: number;
  /** How many are in the group (2 or 3 for streets, 4 rail, 2 utility). */
  total: number;
  /** Indices (0-based) of owned properties that are mortgaged — hatched pips. */
  mortgaged?: number[];
  /** Full monopoly: gold pill, hot pips, the word instead of a fraction. */
  complete?: boolean;
  className?: string;
  style?: KitStyle;
}

/**
 * Set-progress index — swatch, pips, count.
 *
 * *** A MANDATED FLAT FALLBACK, NOT AN OPTION. ***
 * The 3D board can light a colour band to say WHICH tiles are yours,
 * brilliantly. It cannot say HOW MANY OF HOW MANY — there is no world object
 * that reads as "2 of 3". Any screen that shows set progress must show BOTH:
 * the board glow is the poetry, these pips are the number. Do not try to render
 * a fraction on a board surface; it has been tested and it fails.
 *
 * RULE R1: the completed pill has NO negative margin. It used to carry
 * `margin-left:-5px` to optically align its swatch with the plain rows, and a
 * scrolling column sliced that 5px off — taking the pill's rounded left cap and
 * its gold ring with it, because `overflow-y:auto` clips X too. Every row is
 * inset 5px instead, so they share one left edge with zero overhang and survive
 * any container.
 *
 * @example <SetPips color={COLOR_GROUP_HEX.orange} owned={3} total={3} complete />
 */
export function SetPips({
  color,
  owned,
  total,
  mortgaged = [],
  complete = false,
  className,
  style,
}: SetPipsProps) {
  const pips = Array.from({ length: total }, (_, i) => i);

  return (
    <div
      className={cx('kit-set', complete && 'is-complete', className)}
      style={withVars({ '--gc': color }, style)}
    >
      <i className="kit-set__swatch" aria-hidden="true" />
      <span className="kit-pips" aria-hidden="true">
        {pips.map((i) => (
          <i
            key={i}
            className={cx(
              'kit-pip',
              i < owned && 'is-on',
              mortgaged.includes(i) && 'is-mortgaged',
            )}
          />
        ))}
      </span>
      {complete
        ? <span className="kit-set__flag">Monopoly</span>
        : <span className="kit-set__count">{owned}/{total}</span>}
    </div>
  );
}

/** Caption above a stack of <SetPips>, aligned to their 5px inset. */
export function SetCap({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cx('kit-set-cap', className)}>{children}</div>;
}
