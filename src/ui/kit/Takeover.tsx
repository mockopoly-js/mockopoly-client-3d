import type { ReactNode } from 'react';
import { BlurScopeContext } from './blurScope';
import { Button } from './Button';
import { cx } from './cx';
import type { KitStyle } from './tokens';

export interface TakeoverProps {
  open: boolean;
  /** Small gold caps line above the title ("AUCTION · LOT 3"). */
  eyebrow?: ReactNode;
  title?: ReactNode;
  onClose?: () => void;
  /** Right-aligned action row. One primary; escapes belong in the columns. */
  footer?: ReactNode;
  label?: string;
  className?: string;
  style?: KitStyle;
  children?: ReactNode;
}

/**
 * Full-screen takeover — trade, auction, bankruptcy.
 *
 * WHY THESE THREE AND NOTHING ELSE: they are COMPARATIVE, two-sided
 * information. That is a REPRESENTATIONAL failure in world space, not merely a
 * legibility one — the 3D board has no way to show "mine vs theirs, before vs
 * after" side by side. Everything else that is merely detailed goes in a
 * <Panel>. Do not reach for a takeover because a panel felt cramped.
 *
 * RULE R5: NO `backdrop-filter` here, deliberately. A full-viewport blurred
 * layer over already-blurred panels blanks the page in Chrome's software
 * compositor. Dim the 3D scene behind it instead (a filter on the canvas
 * layer); it looks the same and it cannot blank the compositor.
 *
 * BUG B7 FIXED: the mockup entered with `scale(1.015) -> scale(1)`. A scale on
 * a container shrinks every tap target inside it for the duration of the
 * animation — a 44px button measured 42.2px through the entrance, which is a
 * real mis-tap window on a surface whose whole job is confirming money. This
 * fades via a `transition` to a declared end state (permitted by rule R4,
 * because a transition cannot freeze off-target) and never transforms.
 *
 * @example
 * <Takeover open={auction} eyebrow="Auction · Lot 3" title="Mayfair" onClose={cancel}
 *           footer={<Button variant="primary" label="Bid £2.4M" onClick={bid} />}>
 *   <TakeoverCol>…mine…</TakeoverCol>
 *   <TakeoverRule />
 *   <TakeoverCol>…theirs…</TakeoverCol>
 * </Takeover>
 */
export function Takeover({
  open,
  eyebrow,
  title,
  onClose,
  footer,
  label,
  className,
  style,
  children,
}: TakeoverProps) {
  const ariaLabel = label ?? (typeof title === 'string' ? title : undefined);

  return (
    <div
      className={cx('kit-takeover', open && 'is-on', className)}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-hidden={!open}
      style={style}
    >
      {/* Not a blur scope: a takeover never blurs, so a toast inside it may. */}
      <BlurScopeContext.Provider value={false}>
        {(eyebrow !== undefined || title !== undefined || onClose !== undefined) && (
          <header className="kit-takeover__head">
            {eyebrow !== undefined && <span className="kit-takeover__eyebrow">{eyebrow}</span>}
            {title !== undefined && <h2 className="kit-takeover__title">{title}</h2>}
            {onClose !== undefined && (
              <Button
                variant="icon"
                bare
                glyph="✕"
                ariaLabel="Close"
                onClick={onClose}
                className="kit-takeover__close"
              />
            )}
          </header>
        )}
        <div className="kit-takeover__body">{children}</div>
        {footer !== undefined && <footer className="kit-takeover__foot">{footer}</footer>}
      </BlurScopeContext.Provider>
    </div>
  );
}

/**
 * A column inside a takeover body.
 *
 * RULE R1: this is a scroll container, and `overflow-y:auto` clips the X axis
 * too, so it carries 8px of interior padding to give outward `box-shadow` glows
 * room to paint (it was shaving 3px off an 8px swatch glow at x=0). Nothing
 * inside a column may rely on a negative margin or an overhanging decoration.
 *
 * Content is vertically centred by auto margins on the first and last child,
 * which collapse to 0 when it overflows — `justify-content:center` would clip
 * the top of a long list in a scroll container. Pass `top` to opt out.
 */
export function TakeoverCol({
  top = false,
  className,
  style,
  children,
}: { top?: boolean; className?: string; style?: KitStyle; children?: ReactNode }) {
  return (
    <div className={cx('kit-takeover__col', top && 'kit-takeover__col--top', className)} style={style}>
      {children}
    </div>
  );
}

/** Vertical hairline between two comparison columns. */
export function TakeoverRule({ className }: { className?: string }) {
  return <i className={cx('kit-takeover__rule', className)} />;
}
