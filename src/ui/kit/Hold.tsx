import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FxClip } from './Layout';
import { cx } from './cx';
import type { KitStyle } from './tokens';

export interface HoldProps {
  label: ReactNode;
  onComplete: () => void;
  /** Fill time. 1200ms by default. */
  durationMs?: number;
  /** danger (default) for destructive, gold for irreversible-but-positive. */
  tone?: 'danger' | 'gold';
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: KitStyle;
}

/**
 * HOLD-TO-CONFIRM — for the two genuinely irreversible actions: declaring
 * bankruptcy and leaving a game in progress.
 *
 * A ring fills over `durationMs`; releasing early cancels and the ring resets.
 * There is no dialog, no "are you sure", and no way to fire it by accident,
 * which is the entire design goal: on a phone held in two hands, a confirm
 * dialog's OK button is one mis-tap away from the thing it is guarding.
 *
 * TWO PROGRESS LAYERS, deliberately. The linear fill is the guaranteed-visible
 * one; the conic ring is the refined one and needs a registered custom property
 * (`--hold-p`) to animate. Where `@property` is unsupported the ring is static
 * and the fill still tells the truth.
 *
 * RULE R1: the fill is full-width and animated with `scaleX`, so it goes inside
 * <FxClip> — a `border-radius:inherit` on it would be squashed into flattened
 * ellipse corners. The ring is at `inset:0`, matching the radius exactly, so it
 * needs no clip and no reserved overhang.
 *
 * Both progress animations survive `prefers-reduced-motion` at full duration:
 * they carry information, not decoration.
 *
 * @example <Hold label="Hold to declare bankruptcy" onComplete={bankrupt} />
 */
export function Hold({
  label,
  onComplete,
  durationMs = 1200,
  tone = 'danger',
  disabled = false,
  ariaLabel,
  className,
  style,
}: HoldProps) {
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const start = () => {
    if (disabled || done) return;
    setHolding(true);
    clear();
    timer.current = setTimeout(() => {
      setHolding(false);
      setDone(true);
      onComplete();
    }, durationMs);
  };

  const cancel = () => {
    if (done) return;
    clear();
    setHolding(false);
  };

  return (
    <button
      type="button"
      className={cx(
        'kit-hold',
        tone === 'gold' && 'kit-hold--gold',
        holding && 'is-holding',
        done && 'is-done',
        className,
      )}
      style={style}
      disabled={disabled}
      aria-label={ariaLabel}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      // Keyboard parity: Space/Enter fire immediately rather than stranding a
      // keyboard user in front of a control they physically cannot hold.
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!disabled && !done) {
            setDone(true);
            onComplete();
          }
        }
      }}
    >
      <FxClip>
        <i className="kit-hold__fill" />
      </FxClip>
      <i className="kit-hold__ring" aria-hidden="true" />
      <span className="kit-hold__label">{label}</span>
    </button>
  );
}
