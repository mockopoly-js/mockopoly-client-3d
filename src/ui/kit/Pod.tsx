import type { ReactNode } from 'react';
import { cx } from './cx';
import { withVars, type KitStyle } from './tokens';

export interface PodProps {
  /** Player name. Uppercased, truncated with an ellipsis — never wraps. */
  name: ReactNode;
  /** Player token colour, e.g. TOKEN_HEX[player.token]. Drives the left bar. */
  color: string;
  /** Cash, usually a <Money size="glance" />. */
  value?: ReactNode;
  /** <Badge> elements, right-aligned. */
  badges?: ReactNode;
  /** Small colour swatch before the name (a flat token). */
  swatch?: boolean;
  /** Active player: colour wash, ring, and the name lifts to full contrast. */
  isTurn?: boolean;
  /** Bankrupt. */
  isOut?: boolean;
  /** Disconnected, inside the reconnect window. */
  isOffline?: boolean;
  /** Glass plate behind the row, for use directly over the 3D world. */
  glass?: boolean;
  /** Opts the row in to being tappable and raises it to 44px. */
  onClick?: () => void;
  className?: string;
  style?: KitStyle;
}

/**
 * Opponent row for the read-only LEFT column.
 *
 * Inert by default — this is the read-only half of the screen, and an inert row
 * cannot become a mis-tap trap in the worst quadrant on the device. Passing
 * `onClick` opts in and raises the row to the 44px floor.
 *
 * BUG B6 FIXED (rule R3): `is-out` and `is-offline` used to be `opacity: .6` /
 * `.62` on a box containing text. Opacity multiplies the name's text-shadow
 * into a smear. Out now uses a solid muted colour plus a line-through — the
 * treatment the OUT badge already shipped — with the greyscale filter left on
 * the chrome only; offline desaturates and leans on its badge.
 *
 * @example
 * <Pod name="Priya" color={TOKEN_HEX.red} isTurn
 *      value={<Money value={4_200_000} size="glance" legible />}
 *      badges={<Badge tone="jail" bars>Jail</Badge>} glass />
 */
export function Pod({
  name,
  color,
  value,
  badges,
  swatch = false,
  isTurn = false,
  isOut = false,
  isOffline = false,
  glass = false,
  onClick,
  className,
  style,
}: PodProps) {
  const tappable = onClick !== undefined;

  return (
    <div
      className={cx(
        'kit-pod',
        glass && 'kit-pod--glass',
        tappable && 'kit-pod--tappable',
        isTurn && 'is-turn',
        isOut && 'is-out',
        isOffline && 'is-offline',
        className,
      )}
      style={withVars({ '--pc': color }, style)}
      onClick={onClick}
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
    >
      {swatch && (
        <i
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
            flex: '0 0 auto',
            borderRadius: '50%',
            background: `radial-gradient(circle at 33% 28%, #fff 0%, ${color} 34%, rgba(0,0,0,.62) 118%)`,
            boxShadow: `0 0 14px 2px ${color}, inset 0 -3px 6px rgba(0,0,0,.55)`,
          }}
        />
      )}
      <div className="kit-pod__main">
        <div className="kit-pod__name">{name}</div>
        {value}
      </div>
      {badges !== undefined && <div className="kit-pod__badges">{badges}</div>}
    </div>
  );
}
