import type { ReactNode } from 'react';
import { useBlurScope } from './blurScope';
import { cx } from './cx';
import type { KitStyle } from './tokens';

export type ToastTone = 'neutral' | 'good' | 'bad' | 'warn' | 'info';

export interface ToastProps {
  /** Drives the fade + slide. Keep it mounted for the exit. */
  open?: boolean;
  tone?: ToastTone;
  /** Single glyph in the coloured disc. Defaults per tone. */
  icon?: ReactNode;
  className?: string;
  style?: KitStyle;
  children?: ReactNode;
}

const DEFAULT_ICON: Record<ToastTone, string> = {
  neutral: '•',
  good: '+',
  bad: '−',
  warn: '!',
  info: 'i',
};

/**
 * Transient one-line notice.
 *
 * Read-only. Place it top-centre-left or above the action cluster — NEVER where
 * it can cover the primary button, because a toast that lands on the roll
 * button turns an information event into a mis-tap.
 *
 * Its entrance is a `transition` to a declared end state, not a filled
 * animation (rule R4): a transition cannot freeze off-target, so a backgrounded
 * tab can never leave the text half-visible.
 *
 * RULE R5: a toast blurs, but if it renders inside a <Panel> it detects the
 * ancestor blur through <BlurScope> and swaps to an opaque fill instead.
 *
 * @example <Toast open tone="good">Priya paid you <b>£1.2M</b></Toast>
 */
export function Toast({ open = true, tone = 'neutral', icon, className, style, children }: ToastProps) {
  const nested = useBlurScope();

  return (
    <div
      className={cx(
        'kit-toast',
        tone !== 'neutral' && `kit-toast--${tone}`,
        nested && 'kit-toast--flat',
        open && 'is-on',
        className,
      )}
      style={style}
      role="status"
    >
      <i className="kit-toast__icon" aria-hidden="true">{icon ?? DEFAULT_ICON[tone]}</i>
      <span className="kit-toast__text">{children}</span>
    </div>
  );
}

/** Stack container: 8px gaps, inert, at the toast layer. */
export function ToastStack({ className, style, children }: { className?: string; style?: KitStyle; children?: ReactNode }) {
  return <div className={cx('kit-toasts', className)} style={style}>{children}</div>;
}
