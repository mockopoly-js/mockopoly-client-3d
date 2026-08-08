import type { ReactNode } from 'react';
import { cx } from './cx';
import type { KitStyle } from './tokens';

export type ButtonVariant = 'primary' | 'gold' | 'secondary' | 'ghost' | 'danger' | 'icon';
export type ClockState = 'off' | 'warn' | 'urgent';

export interface ButtonProps {
  /**
   * primary   48px / 17px, lit in the active player's colour. THE turn action.
   * gold      48px / 17px, off-board CTA where there is no turn colour to
   *           inherit (menu, lobby start).
   * secondary 44px / 15px, routine actions. The default.
   * ghost     44px / 15px, dismissals and "not now".
   * danger    44px / 15px, pays out, breaks a set, forfeits.
   * icon      44x44 (52x52 with `large`), glyph + optional 11px caption.
   */
  variant?: ButtonVariant;
  /** The button label. Uppercased by CSS. */
  label?: ReactNode;
  /** Icon glyph — a lucide-react icon, or a character. */
  glyph?: ReactNode;
  /** 11px caption under an icon glyph ("DEEDS", "TRADE"). */
  sub?: ReactNode;
  /** 12px secondary line beside the label ("£2.4M"). */
  note?: ReactNode;
  /**
   * Overhanging gold count badge, pinned to the top-right corner.
   * Overhangs by 5px, which is only safe because this button does not clip
   * (rule R1) — put it inside a scroll container and it WILL be sliced. The
   * action cluster reserves BADGE_RESERVE on the right for exactly this.
   */
  badge?: ReactNode;
  /** Bare "something changed" dot, pinned to the corner. No number. */
  dot?: 'gold' | 'danger' | 'good';
  /** Pure-CSS dice glyph, for the roll button. */
  dice?: boolean;
  /** Slow specular sweep. Rendered inside the clip layer for you. */
  sheen?: boolean;
  /** width:100% — inside a panel or takeover column. */
  block?: boolean;
  /** icon only: 52x52 instead of 44x44. */
  large?: boolean;
  /** icon only: no fill, no ring. Close buttons. */
  bare?: boolean;
  /**
   * ICON-ONLY AT THE VARIANT'S OWN TAP HEIGHT — a square with no label slot.
   * `variant="icon"` is the 44px utility chip (glyph + 11px caption, gold glyph,
   * secondary fill); this is the modifier that lets a REAL variant drop its text
   * without dropping its identity, so the turn action can be a bare die or ✕ and
   * still be 48px (--tap-primary) and still lit in the active player's colour.
   *
   * The width tracks `min-height`, so it is 48x48 on primary/gold and 44x44 on
   * everything else — the 176px `--btn-w-primary` floor and the 20px inline
   * padding exist to hold a LABEL and would otherwise float the glyph in the
   * middle of a slab.
   *
   * *** `ariaLabel` IS MANDATORY WITH THIS. *** Dropping the visible text drops
   * the accessible name with it, and a button called "" is a button no screen
   * reader, voice-control user or test can address. Use the same words the
   * label would have carried ("Roll dice", "End turn").
   */
  square?: boolean;
  /** Not my turn. Inert, greyed, but STILL 48px so the layout never jumps. */
  waiting?: boolean;
  disabled?: boolean;
  /**
   * The primary action IS the turn clock. A turn is 75s; for the first 55s this
   * stays 'off' and the button is just a button — no ring, no number, no
   * anxiety. Flip to 'warn' for the final 20s and 'urgent' for the last 5.
   */
  clock?: ClockState;
  /** Seconds remaining, shown as a pill inside the button when the clock runs. */
  clockCount?: number;
  onClick?: () => void;
  type?: 'button' | 'submit';
  /** REQUIRED for icon-only buttons — there is no text to name them. */
  ariaLabel?: string;
  className?: string;
  style?: KitStyle;
  /** Free content, rendered where the label would go. */
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'kit-btn--primary',
  gold: 'kit-btn--gold',
  secondary: 'kit-btn--secondary',
  ghost: 'kit-btn--ghost',
  danger: 'kit-btn--danger',
  icon: 'kit-btn--icon',
};

/**
 * The one button.
 *
 * GEOMETRY IS NOT NEGOTIABLE, and is carried by the CSS, not by callers:
 *   primary / gold   min-height 48px, 17px label, min-width 176px
 *   everything else  min-height 44px, 15px label
 *   icon             44x44, or 52x52 with `large`
 *   + square         drops the label slot: 48x48 on primary/gold, 44x44 else
 * Adjacent buttons must sit >=12px apart — wrap them in <BtnRow> or <Actions>,
 * which guarantee it.
 *
 * RULE R1 IS ENFORCED BY THE PROP SHAPE. Decorations that must be clipped to
 * the button's rounded corners (`sheen`, the clock fill) are rendered inside
 * <FxClip> automatically; decorations that must overhang (`badge`, `dot`, the
 * clock ring) are rendered as direct children outside it. The button itself
 * never sets `overflow`, so there is no way to compose this wrongly from the
 * outside — which is the whole point, because the failure mode is a silently
 * sliced badge that no test catches.
 *
 * @example
 * <Button variant="primary" label="Roll dice" dice clock="warn" clockCount={18} onClick={roll} />
 * <Button variant="icon" glyph="▤" sub="DEEDS" badge={3} ariaLabel="Title deeds" onClick={open} />
 * <Button variant="primary" square dice ariaLabel="Roll dice" onClick={roll} />
 */
export function Button({
  variant = 'secondary',
  label,
  glyph,
  sub,
  note,
  badge,
  dot,
  dice = false,
  sheen = false,
  block = false,
  large = false,
  bare = false,
  square = false,
  waiting = false,
  disabled = false,
  clock,
  clockCount,
  onClick,
  type = 'button',
  ariaLabel,
  className,
  style,
  children,
}: ButtonProps) {
  const hasClock = clock !== undefined;
  const clockState: ClockState = clock ?? 'off';
  // The clip layer only exists when something needs clipping. A plain button
  // renders no extra element at all.
  const needsClip = sheen || hasClock;

  return (
    <button
      type={type}
      className={cx(
        'kit-btn',
        VARIANT_CLASS[variant],
        hasClock && 'kit-btn--turn',
        large && 'kit-btn--lg',
        bare && 'kit-btn--bare',
        square && 'kit-btn--square',
        block && 'kit-btn--block',
        waiting && 'is-waiting',
        className,
      )}
      data-clock={hasClock ? clockState : undefined}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={waiting ? true : undefined}
      aria-label={ariaLabel}
      style={style}
    >
      {/* CLIPPED decorations. Never put a badge in here. */}
      {needsClip && (
        <i className="kit-fx-clip">
          {hasClock && <i className="kit-turn__fill" />}
          {sheen && <i className="kit-sheen" />}
        </i>
      )}
      {/* The clock ring sits at inset:0, so its radius matches exactly and it
          needs neither a clip nor any reserved overhang. */}
      {hasClock && <i className="kit-turn__ring" />}

      {dice && (
        <span className="kit-dice" aria-hidden="true">
          <i /><i /><i /><i /><i /><i />
        </span>
      )}
      {glyph !== undefined && <i className="kit-btn__glyph" aria-hidden="true">{glyph}</i>}
      {label !== undefined && <span className="kit-btn__label">{label}</span>}
      {children}
      {sub !== undefined && <span className="kit-btn__sub">{sub}</span>}
      {note !== undefined && <span className="kit-btn__note">{note}</span>}
      {clockCount !== undefined && <span className="kit-turn__count">{clockCount}</span>}

      {/* OVERHANGING decorations — outside the clip, on purpose. */}
      {badge !== undefined && <span className="kit-badge kit-badge--count">{badge}</span>}
      {dot !== undefined && (
        <i
          className={cx('kit-dot', 'kit-dot--pin', 'kit-dot--pulse', dot !== 'gold' && `kit-dot--${dot}`)}
          aria-hidden="true"
        />
      )}
    </button>
  );
}
