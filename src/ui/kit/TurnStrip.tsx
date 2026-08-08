import type { ReactNode } from 'react';
import { cx } from './cx';
import { withVars, type KitStyle } from './tokens';

export interface TurnStripProps {
  /** "YOUR TURN" / "PRIYA'S TURN". The most glance-critical string on screen. */
  who: ReactNode;
  /** "ROLL TO MOVE", "BUY OR AUCTION". Gold, optional. */
  phase?: ReactNode;
  /** Active player's token colour. Drives the dot. */
  color?: string;
  className?: string;
  style?: KitStyle;
}

/**
 * The flat, unambiguous statement of whose turn it is.
 *
 * The 3D cues — board-edge glow, token spotlight — are ATMOSPHERE. This strip
 * is the text of record, and it must exist even when the scene is doing its
 * job, because a colour is not a name.
 *
 * Read-only and inert. Lives top-left, inside <ZoneTop>.
 *
 * RULE R2 LIVES HERE. The entrance settles UPWARD from +6px rather than
 * dropping in from -10px: the strip is anchored at the very top of the safe
 * box, so a negative translate pushed it above the frame edge where
 * `overflow:hidden` sliced it for 250ms on every single screen load. An
 * entrance on a top-anchored element must move it INWARD. It also animates
 * transform only (R4) — "YOUR TURN" must never be caught mid-fade.
 *
 * @example <TurnStrip who="Your turn" phase="Roll to move" color={TOKEN_HEX.blue} />
 */
export function TurnStrip({ who, phase, color, className, style }: TurnStripProps) {
  return (
    <div
      className={cx('kit-turnstrip', className)}
      style={color !== undefined ? withVars({ '--pc': color }, style) : style}
      role="status"
    >
      <i className="kit-turnstrip__dot" aria-hidden="true" />
      <span className="kit-turnstrip__who">{who}</span>
      {phase !== undefined && (
        <>
          <i className="kit-turnstrip__sep" aria-hidden="true" />
          <span className="kit-turnstrip__phase">{phase}</span>
        </>
      )}
    </div>
  );
}
