import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';
import type { KitStyle } from './tokens';

export interface ArmProps {
  /** Stage 1 label: "MORTGAGE". */
  face: ReactNode;
  /** Stage 2 label, which must RESTATE THE CONSEQUENCE: "TAP AGAIN · +£1.8M". */
  confirm: ReactNode;
  onConfirm: () => void;
  /** Auto-disarm window. 4s by default. */
  timeoutMs?: number;
  disabled?: boolean;
  /** Fires when the button arms, for a sound cue or analytics. */
  onArm?: () => void;
  ariaLabel?: string;
  className?: string;
  style?: KitStyle;
}

/**
 * ARM-THEN-FIRE — the modal-free confirmation for reversible-but-costly actions
 * (mortgage, sell a house, decline a trade).
 *
 * The first tap arms the button and RESTATES THE CONSEQUENCE in place; the
 * second tap fires. It disarms itself after `timeoutMs`, with a draining bar so
 * the window is visible. This replaces a confirm dialog everywhere except
 * bankruptcy and accept-trade, which use <Hold> instead.
 *
 * Both labels stay mounted so the box never resizes between stages — a button
 * that changes width under your thumb is how you fire the wrong action.
 *
 * BUG B1 FIXED: `.arm[disabled]` was completely unstyled in the source system.
 * A disabled two-stage confirm rendered FULLY LIT and inert, which is the worst
 * possible affordance — it looks like the primary thing to press and does
 * nothing. It now matches a disabled button exactly, and disabling it mid-arm
 * clears both stage-2 layers so it cannot strand a lit warning bar.
 *
 * @example <Arm face="Mortgage" confirm="Tap again · +£1.8M" onConfirm={mortgage} />
 */
export function Arm({
  face,
  confirm,
  onConfirm,
  timeoutMs = 4000,
  disabled = false,
  onArm,
  ariaLabel,
  className,
  style,
}: ArmProps) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Disarm on unmount, and whenever the button is disabled while armed — B1.
  useEffect(() => clear, [clear]);
  useEffect(() => {
    if (disabled) {
      clear();
      setArmed(false);
    }
  }, [disabled, clear]);

  const handle = () => {
    if (armed) {
      clear();
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    onArm?.();
    clear();
    timer.current = setTimeout(() => { setArmed(false); }, timeoutMs);
  };

  return (
    <button
      type="button"
      className={cx('kit-arm', armed && 'is-armed', className)}
      style={style}
      disabled={disabled}
      aria-label={ariaLabel}
      // The accessible name changes with the stage, so a screen reader hears
      // the consequence too rather than "Mortgage" twice.
      aria-pressed={armed}
      onClick={handle}
    >
      <span className="kit-arm__face">{face}</span>
      <span className="kit-arm__confirm">{confirm}</span>
      <i className="kit-arm__timer" aria-hidden="true" />
    </button>
  );
}
