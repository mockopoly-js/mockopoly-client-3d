import type { ReactNode } from 'react';
import { cx } from './cx';
import type { KitStyle } from './tokens';

export type BadgeTone = 'neutral' | 'jail' | 'out' | 'offline' | 'good' | 'warn' | 'gold';

export interface BadgeProps {
  tone?: BadgeTone;
  /** Prison-bar glyph before the label, for the jail badge. */
  bars?: boolean;
  className?: string;
  style?: KitStyle;
  children?: ReactNode;
}

/**
 * 16px pill at the 11px type floor.
 *
 * Badges are SUPPORTING information and must never be the only carrier of a
 * state — 11px is the floor precisely because a badge is a confirmation of
 * something the layout already said. `out` ships a line-through as well as a
 * colour, because a colour alone is not a state signal.
 *
 * @example <Badge tone="jail" bars>In jail</Badge>
 */
export function Badge({ tone = 'neutral', bars = false, className, style, children }: BadgeProps) {
  return (
    <span className={cx('kit-badge', tone !== 'neutral' && `kit-badge--${tone}`, className)} style={style}>
      {bars && <i className="kit-badge__bars" aria-hidden="true" />}
      {children}
    </span>
  );
}

export interface DotProps {
  tone?: 'gold' | 'danger' | 'good';
  /** Slow breathing loop. An ambient infinite animation, so opacity is safe. */
  pulse?: boolean;
  /**
   * Pin to the top-right corner of a positioned parent. OVERHANGS BY 2px, so
   * the parent must not clip (rule R1) — <Button> is safe, a scroll container
   * is not.
   */
  pin?: boolean;
  className?: string;
  style?: KitStyle;
}

/** Bare "something changed" dot. No number, no label. */
export function Dot({ tone = 'gold', pulse = false, pin = false, className, style }: DotProps) {
  return (
    <i
      className={cx(
        'kit-dot',
        tone !== 'gold' && `kit-dot--${tone}`,
        pulse && 'kit-dot--pulse',
        pin && 'kit-dot--pin',
        className,
      )}
      style={style}
      aria-hidden="true"
    />
  );
}
