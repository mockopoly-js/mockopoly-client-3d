import type { ReactNode } from 'react';
import { BlurScopeContext, useBlurScope } from './blurScope';
import { Button } from './Button';
import { cx } from './cx';
import type { KitStyle } from './tokens';

export interface PanelProps {
  /** Drives the slide. The panel stays mounted so the exit animates too. */
  open: boolean;
  title?: ReactNode;
  /** Uppercase gold line under the title ("DARK BLUE · OWNED BY YOU"). */
  sub?: ReactNode;
  /** Renders the close button when provided. */
  onClose?: () => void;
  /** default 392 (incl. the right safe inset) · narrow 312 · wide 472 */
  width?: 'default' | 'narrow' | 'wide';
  /** Dim behind the panel. 'light' by default; false for a non-modal panel. */
  scrim?: false | 'light' | 'heavy';
  /** Sticky footer. Also the panel's bottom safe-inset clearance. */
  footer?: ReactNode;
  /** Replaces the whole title/sub block when a panel needs a custom head. */
  head?: ReactNode;
  /** aria-label for the dialog. Defaults to the title when that is a string. */
  label?: string;
  className?: string;
  style?: KitStyle;
  children?: ReactNode;
}

/**
 * The right slide-in detail panel. NEVER A BOTTOM SHEET.
 *
 * In landscape a bottom sheet eats the only vertical space there is and puts
 * its content under the thumbs. This slides over the RIGHT interactive half and
 * leaves the left read-only half visible, which is the point: you can still see
 * who is doing what while you read a deed.
 *
 * Width is 392px INCLUDING the 47px right safe inset, so content is 311px.
 * Interior gutters are `--panel-fade + --panel-pad` on the left (content must
 * clear the gold hairline) and `max(--sa-r, --panel-pad)` on the right — MAX,
 * NOT SUM. Stacking them gave a 61px gutter and 285px of content, 15.6% dead
 * space, with the deed's colour band visibly stopping short of the edge.
 *
 * RULE R5: this is the one surface allowed a `backdrop-filter`. If it is
 * rendered inside another blurred surface it downgrades itself to an opaque
 * fill automatically.
 *
 * BUG B5 FIXED: the body used to have no bottom padding and relied entirely on
 * the footer for safe-area clearance, so a footer-less panel breached the
 * bottom inset. With no `footer`, the body takes the clearance itself.
 *
 * @example
 * <Panel open={showDeed} title="Mayfair" sub="Dark blue · owned by you"
 *        onClose={close} footer={<Button variant="secondary" block label="Mortgage" />}>
 *   <Deed … />
 * </Panel>
 */
export function Panel({
  open,
  title,
  sub,
  onClose,
  width = 'default',
  scrim = 'light',
  footer,
  head,
  label,
  className,
  style,
  children,
}: PanelProps) {
  const nested = useBlurScope();
  const ariaLabel = label ?? (typeof title === 'string' ? title : undefined);

  return (
    <>
      {scrim !== false && (
        <div
          className={cx('kit-scrim', scrim === 'heavy' && 'kit-scrim--heavy', open && 'is-on')}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={cx(
          'kit-panel',
          width !== 'default' && `kit-panel--${width}`,
          nested && 'kit-panel--flat',
          open && 'is-on',
          className,
        )}
        role="dialog"
        aria-modal={scrim !== false}
        aria-label={ariaLabel}
        aria-hidden={!open}
        style={style}
      >
        <BlurScopeContext.Provider value={true}>
          {(head !== undefined || title !== undefined || onClose !== undefined) && (
            <div className="kit-panel__head">
              {head ?? (
                <div style={{ minWidth: 0 }}>
                  {title !== undefined && <div className="kit-panel__title">{title}</div>}
                  {sub !== undefined && <div className="kit-panel__sub">{sub}</div>}
                </div>
              )}
              {onClose !== undefined && (
                <Button
                  variant="icon"
                  bare
                  glyph="✕"
                  ariaLabel="Close"
                  onClick={onClose}
                  className="kit-panel__close"
                />
              )}
            </div>
          )}
          <div className={cx('kit-panel__body', footer === undefined && 'kit-panel__body--nofoot')}>
            {children}
          </div>
          {footer !== undefined && <div className="kit-panel__foot">{footer}</div>}
        </BlurScopeContext.Provider>
      </aside>
    </>
  );
}
