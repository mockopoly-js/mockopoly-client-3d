import type { ReactNode } from 'react';
import { cx } from './cx';
import { withVars, type KitStyle } from './tokens';

export interface DeedRow {
  /** "RENT", "WITH COLOUR SET", "1 HOUSE" … TRUNCATED, never wrapped. */
  label: ReactNode;
  /** Usually a <Money size="glance" />. */
  value: ReactNode;
  /** The rent that applies right now: gold inset bar + full-contrast label. */
  current?: boolean;
  /** Unreachable from here (needs houses you cannot build yet). */
  locked?: boolean;
}

export interface DeedMeta {
  label: ReactNode;
  value: ReactNode;
}

export interface DeedProps {
  /** Group colour, e.g. COLOR_GROUP_HEX['dark-blue']. Drives the band. */
  color: string;
  title: ReactNode;
  /** "DARK BLUE · OWNED BY YOU" */
  sub?: ReactNode;
  rows?: DeedRow[];
  meta?: DeedMeta[];
  mortgaged?: boolean;
  /** Renders as a standalone card (padding, fill, shadow) instead of bare. */
  card?: boolean;
  className?: string;
  style?: KitStyle;
  /** Extra content below the meta row. */
  children?: ReactNode;
}

/**
 * Title-deed card: colour band, title, rent ladder, meta pair.
 *
 * SIZED TO FIT. At the rebased 48/44px button sizes a panel body has ~223px of
 * usable height, so a row is 24px: 7 rent rows (168) + meta (~30) + gaps ≈ 206,
 * which clears with slack. Against the old 64/56px buttons the 8th row was
 * clipped mid-text.
 *
 * THREE BUGS FIXED HERE:
 *   B2  `--deed-row` was scoped to `.deed`, so a deed row used anywhere else —
 *       the takeover's CASH row is the same primitive — got `height:` with no
 *       value and collapsed to its 17.2px line box. The token is on `:root`.
 *   B3  `is-locked` was `opacity:.45` on a text row, which violates rule R3 and
 *       smeared the label against its shadow. It is a solid `--text-3` now,
 *       which is exactly what that token is for: disabled glyphs and rows.
 *   B4  the row is fixed-height, so a label long enough to wrap spilled across
 *       the hairlines into the row below. Labels are `white-space:nowrap` with
 *       an ellipsis — the value is the payload, the label can truncate.
 *
 * @example
 * <Deed color={COLOR_GROUP_HEX['dark-blue']} title="Mayfair" sub="Dark blue · owned by you"
 *   rows={[{ label: 'Rent', value: <Money value={2_000_000} size="glance" tone="gold" />, current: true },
 *          { label: 'With colour set', value: <Money value={4_000_000} size="glance" /> },
 *          { label: 'Hotel', value: <Money value={20_000_000} size="glance" />, locked: true }]}
 *   meta={[{ label: 'House cost', value: <Money value={2_000_000} size="label" /> }]} />
 */
export function Deed({
  color,
  title,
  sub,
  rows = [],
  meta = [],
  mortgaged = false,
  card = false,
  className,
  style,
  children,
}: DeedProps) {
  return (
    <div
      className={cx('kit-deed', card && 'kit-deed--card', mortgaged && 'is-mortgaged', className)}
      style={withVars({ '--gc': color }, style)}
    >
      <i className="kit-deed__band" aria-hidden="true" />
      <div className="kit-deed__title">{title}</div>
      {sub !== undefined && <div className="kit-deed__sub">{sub}</div>}

      {rows.length > 0 && (
        <div className="kit-deed__rents">
          {rows.map((row, i) => (
            <DeedRowView key={i} row={row} />
          ))}
        </div>
      )}

      {meta.length > 0 && (
        <div className="kit-deed__meta">
          {meta.map((m, i) => (
            <div className="kit-deed__metaitem" key={i}>
              <span className="kit-deed__metalabel">{m.label}</span>
              {m.value}
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * A single deed row, exported because it is the same primitive the takeover's
 * CASH / RENT rows use. B2 is what makes this safe to use outside a <Deed>.
 */
export function DeedRowView({ row, className }: { row: DeedRow; className?: string }) {
  return (
    <div
      className={cx('kit-deed__row', row.current === true && 'is-current', row.locked === true && 'is-locked', className)}
    >
      <span className="kit-deed__label">{row.label}</span>
      {row.value}
    </div>
  );
}
