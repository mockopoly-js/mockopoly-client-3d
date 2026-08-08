import type { ReactNode } from 'react';
import { cx } from './cx';
import type { KitStyle } from './tokens';

interface BoxProps {
  className?: string;
  style?: KitStyle;
  children?: ReactNode;
}

/**
 * The usable box: the viewport minus the safe-area insets, with a --sp-3 (12px)
 * design gutter as the floor on the sides and the bottom.
 *
 * WHAT THE INSETS ARE. `--sa-*` is pure `env(safe-area-inset-*, 0px)` — device
 * truth, nothing baked in. iOS reports landscape symmetrically on the long
 * edges (47/47 on an iPhone 13 Pro, 62/62 on an iPhone 17); Android does not,
 * so do not write anything that REQUIRES symmetry. A desktop browser reports
 * zero and gets the 12px design gutter instead. The token used to be
 * `max(47px, env(…))`, which spent 47px a side on desktop and made every
 * call-site pad unreachable; see kit.css §2.16 for the full argument.
 *
 * THE TOP EDGE IS UNPADDED ON PURPOSE. The HUD is anchored to the top of the
 * safe area (the turn strip is the first thing in the frame and carries its own
 * offset), and in a Safari tab the landscape top inset is 0. It is NOT always 0
 * though — an installed/fullscreen PWA sees the ~20pt window inset even in
 * landscape — so `var(--sa-t)` tracks it rather than assuming.
 *
 * THE INSETS DO NOT STACK WITH INTERIOR PADDING. If a child needs padding, use
 * `sa('r', 14)` -> `max(var(--sa-r), 14px)`, never `calc(inset + pad)`.
 *
 * SafeBox is `pointer-events:none` so the 3D world stays tappable through the
 * gaps; its direct children get events back. Pass `inert` for a HUD that must
 * not intercept anything at all (e.g. while a takeover is open).
 *
 * @example <SafeBox><ZoneTop><TurnStrip …/></ZoneTop><ZoneAct>…</ZoneAct></SafeBox>
 */
export function SafeBox({ inert = false, className, style, children }: BoxProps & { inert?: boolean }) {
  return (
    <div className={cx('kit-safe', inert && 'kit-safe--inert', className)} style={style}>
      {children}
    </div>
  );
}

/**
 * Left read-only column, 250px.
 *
 * LEFT HALF IS READ-ONLY, RIGHT HALF IS INTERACTIVE. A two-thumb landscape grip
 * mis-taps ~12.85% on the left against ~9.75% on the right, and bottom-left is
 * the worst quadrant on the screen. Opponent pods, the event log and set pips
 * live here. NEVER put a primary action in this column.
 */
export function ZoneRead({ className, style, children }: BoxProps) {
  return <div className={cx('kit-zone-read', className)} style={style}>{children}</div>;
}

/**
 * Right interactive column, bottom-aligned, 12px gaps. ALL primary actions.
 *
 * Held 8px off the right edge (BADGE_RESERVE) so a corner count badge can
 * overhang its button by 5px without crossing the 47px right safe inset.
 */
export function ZoneAct({ className, style, children }: BoxProps) {
  return <div className={cx('kit-zone-act', className)} style={style}>{children}</div>;
}

/**
 * Centre display-only band (x 250..500 of the safe box).
 *
 * A GUARD RAIL, NOT A LAYOUT TOOL. Everything inside is forced
 * `pointer-events:none` — the middle third of a landscape phone is where
 * neither thumb reaches, so nothing interactive may live there. Use it for the
 * free-parking pot, a big read-only value, a status line.
 */
export function ZoneMid({ className, style, children }: BoxProps) {
  return <div className={cx('kit-zone-mid', className)} style={style}>{children}</div>;
}

/** Top strip inside the safe box, left-aligned. Whose-turn lives here. */
export function ZoneTop({ className, style, children }: BoxProps) {
  return <div className={cx('kit-zone-top', className)} style={style}>{children}</div>;
}

/**
 * Horizontal cluster with the mandatory 12px dead space between interactives.
 * Two 44px buttons 6px apart measure as one 94px target to a moving thumb.
 */
export function BtnRow({ className, style, children }: BoxProps) {
  return <div className={cx('kit-btn-row', className)} style={style}>{children}</div>;
}

/** Vertical, right-aligned cluster with the same 12px guarantee. */
export function Actions({ className, style, children }: BoxProps) {
  return <div className={cx('kit-actions', className)} style={style}>{children}</div>;
}

/**
 * RULE R1 — the decoration-clipping layer.
 *
 * A clipping ancestor beats z-index; nothing escapes `overflow:hidden`, and
 * `overflow-y:auto` clips the X axis too. So controls in this system never set
 * `overflow` themselves: anything that must be clipped to a control's rounded
 * shape goes inside <FxClip>, which leaves the control's own overflow visible
 * so badges, pinned dots and progress rings can overhang.
 *
 * <Button>, <Hold> and <Arm> already do this for you. You only need <FxClip>
 * directly if you are building a new control with a full-bleed decoration.
 */
export function FxClip({ className, style, children }: BoxProps) {
  return <i className={cx('kit-fx-clip', className)} style={style}>{children}</i>;
}

/** Horizontal hairline divider inside a panel or takeover. */
export function Rule({ vertical = false, className, style }: { vertical?: boolean } & BoxProps) {
  return <i className={cx('kit-rule', vertical && 'kit-rule--v', className)} style={style} />;
}
