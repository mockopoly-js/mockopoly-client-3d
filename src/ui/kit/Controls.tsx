import type { ChangeEvent, ReactNode } from 'react';
import { cx } from './cx';
import { withVars, type KitStyle } from './tokens';

// ────────────────────────────────────────────────────────────────────────────
// STEPPER
// ────────────────────────────────────────────────────────────────────────────
export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Render the value however the screen needs — usually a <Money />. */
  children?: ReactNode;
  ariaLabel?: string;
  className?: string;
  style?: KitStyle;
}

/**
 * −/+ stepper. Both buttons are a full 44x44 with the value between them, so
 * the two tap targets are more than 12px apart by construction.
 *
 * @example
 * <Stepper value={bid} onChange={setBid} min={0} max={cash} step={100_000} ariaLabel="Bid">
 *   <Money value={bid} size="glance-lg" tone="gold" />
 * </Stepper>
 */
export function Stepper({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  children,
  ariaLabel,
  className,
  style,
}: StepperProps) {
  return (
    <div className={cx('kit-stepper', className)} style={style} role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className="kit-stepper__btn"
        aria-label="Less"
        disabled={value - step < min}
        onClick={() => { onChange(Math.max(min, value - step)); }}
      >
        −
      </button>
      <span className="kit-stepper__val">{children}</span>
      <button
        type="button"
        className="kit-stepper__btn"
        aria-label="More"
        disabled={value + step > max}
        onClick={() => { onChange(Math.min(max, value + step)); }}
      >
        +
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SLIDER
// ────────────────────────────────────────────────────────────────────────────
export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
  className?: string;
  style?: KitStyle;
}

/**
 * Range slider.
 *
 * The INPUT is 44px tall, not just its wrapper — the hit area has to be on the
 * interactive element or the top and bottom 19px of the row do nothing. The
 * track stays 6px and the thumb 26px, both centred in the 44px box, so it looks
 * identical and taps correctly.
 *
 * `--fill` is set from the value because a WebKit `runnable-track` cannot read
 * the input's value in CSS.
 *
 * @example <Slider value={pct} onChange={setPct} ariaLabel="Offer share" />
 */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  ariaLabel,
  className,
  style,
}: SliderProps) {
  const span = max - min;
  const fill = span > 0 ? ((value - min) / span) * 100 : 0;

  return (
    <div className={cx('kit-slider', className)} style={style}>
      <input
        type="range"
        className="kit-slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        style={withVars({ '--fill': `${Math.max(0, Math.min(100, fill))}%` })}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange(Number(e.target.value)); }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SWITCH
// ────────────────────────────────────────────────────────────────────────────
export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
  className?: string;
  style?: KitStyle;
}

/**
 * Toggle. The whole row is 44px and the whole row is the label, so the tap
 * target is the text as well as the track.
 *
 * @example <Switch checked={sound} onChange={setSound} label="Sound" />
 */
export function Switch({ checked, onChange, label, ariaLabel, className, style }: SwitchProps) {
  return (
    <label className={cx('kit-switch', className)} style={style}>
      <input
        type="checkbox"
        className="kit-switch__box"
        checked={checked}
        aria-label={ariaLabel}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange(e.target.checked); }}
      />
      <span className="kit-switch__track"><span className="kit-switch__knob" /></span>
      {label !== undefined && <span className="kit-switch__label">{label}</span>}
    </label>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SEGS
// ────────────────────────────────────────────────────────────────────────────
export interface SegOption<T extends string | number> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegsProps<T extends string | number> {
  value: T;
  options: SegOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  style?: KitStyle;
}

/**
 * Segmented choice — player count, token picker, filter.
 *
 * Items are 44px tall. Like the code input this is ONE logical control, so the
 * 12px dead-space rule applies to the group, not to the items inside it.
 *
 * DO NOT EXCEED 4 ITEMS: 4x44 + 3x12 = 212px, which is inside the 250px right
 * column. Five will not fit and will push a control into the middle third.
 *
 * @example
 * <Segs value={players} onChange={setPlayers} ariaLabel="Players"
 *       options={[{value:2,label:'2'},{value:3,label:'3'},{value:4,label:'4'}]} />
 */
export function Segs<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  style,
}: SegsProps<T>) {
  return (
    <div className={cx('kit-segs', className)} style={style} role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          disabled={opt.disabled}
          className={cx('kit-segs__item', opt.value === value && 'is-on')}
          onClick={() => { onChange(opt.value); }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
