import { cx } from './cx';
import { withVars, type KitStyle } from './tokens';

export interface MeterProps {
  /** 0..100. Clamped. */
  pct: number;
  tone?: 'gold' | 'good' | 'warn' | 'bad';
  /** Names the ratio for screen readers — the bar itself carries no text. */
  ariaLabel?: string;
  className?: string;
  style?: KitStyle;
}

/**
 * A textless proportional bar.
 *
 * <SetPips> counts DISCRETE items ("2 of 3"). A bid against my cash, or money
 * raised against money needed, is CONTINUOUS, and nothing else in the system
 * covers that. Deliberately textless: the exact figures always sit beside it at
 * >=11px, because a bar cannot be read as a number.
 *
 * `display:block` on the fill is load-bearing. The fill is an `<i>`, and on an
 * inline box neither `height:100%` nor `width` applies — the bar rendered as
 * nothing at 0% AND as nothing at 100%, which a DOM audit happily reported as
 * "no defect".
 *
 * @example <Meter pct={62} tone="warn" ariaLabel="Bid against your cash" />
 */
export function Meter({ pct, tone = 'gold', ariaLabel, className, style }: MeterProps) {
  const clamped = Math.max(0, Math.min(100, pct));

  return (
    <div
      className={cx('kit-meter', tone !== 'gold' && `kit-meter--${tone}`, className)}
      style={style}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i className="kit-meter__fill" style={withVars({ '--pct': clamped })} />
    </div>
  );
}
