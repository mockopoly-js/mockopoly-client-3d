import { useState, type ReactNode } from 'react';
import { cx } from './cx';
import type { KitStyle } from './tokens';

export interface EventLogItem {
  id: string;
  /** "21:04". Fixed 34px slot, tabular. */
  time?: string;
  text: ReactNode;
  /** Newest entry: full-contrast, with the inward entrance. */
  fresh?: boolean;
}

export interface EventLogProps {
  items: EventLogItem[];
  /** Collapsed peek line. Defaults to the first item's text. */
  last?: ReactNode;
  /** Controlled open state. Omit to let the component manage it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  style?: KitStyle;
}

/**
 * Collapsed last-event strip that expands to the full history.
 *
 * *** A MANDATED FLAT FALLBACK, NOT AN OPTION. ***
 * "Priya paid you £1.2M rent on Mayfair" carries four facts — actor, action,
 * amount, place. The 3D scene can stage exactly one of them (a coin flying
 * between tokens); it cannot say the sentence. The world animation is the
 * exclamation mark, this strip is the sentence. Never try to render event text
 * on a board surface.
 *
 * It lives in the read-only LEFT column, so its tap is a convenience only — the
 * canonical route to history is an icon button in the bottom-right cluster. The
 * peek row is still a full 44px so the convenience is not a mis-tap trap.
 *
 * RULE R2: fresh items enter from the RIGHT (+8px). The log sits at x=0 of the
 * safe box; a negative X translate slid the row into the 47px bezel inset
 * mid-animation.
 *
 * @example <EventLog items={log.map(e => ({ id: e.id, time: e.at, text: e.text }))} />
 */
export function EventLog({ items, last, open, onOpenChange, className, style }: EventLogProps) {
  const [selfOpen, setSelfOpen] = useState(false);
  const isOpen = open ?? selfOpen;

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setSelfOpen(next);
    onOpenChange?.(next);
  };

  const peek = last ?? items[0]?.text;

  return (
    <div className={cx('kit-eventlog', isOpen && 'is-open', className)} style={style}>
      <button
        type="button"
        className="kit-eventlog__peek"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Collapse event log' : 'Expand event log'}
      >
        <i className="kit-eventlog__tick" aria-hidden="true" />
        <span className="kit-eventlog__last">{peek}</span>
        <i className="kit-eventlog__chev" aria-hidden="true" />
      </button>
      <div className="kit-eventlog__list">
        {items.map((item) => (
          <div key={item.id} className={cx('kit-eventlog__item', item.fresh === true && 'is-fresh')}>
            {item.time !== undefined && <time>{item.time}</time>}
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
