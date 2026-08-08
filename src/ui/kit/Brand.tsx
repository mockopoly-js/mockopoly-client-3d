import type { ReactNode } from 'react';
import { cx } from './cx';
import { withVars, type KitStyle } from './tokens';

/**
 * The brand wordmark. Gold gradient clipped to the text.
 *
 * This is the ONLY thing allowed to use `--text-display` (32px). That size is
 * brand type; using it for a functional label breaks the four-role scale and
 * makes everything else look like an afterthought.
 *
 * @example <Wordmark>Mockopoly</Wordmark>
 */
export function Wordmark({ className, style, children }: { className?: string; style?: KitStyle; children?: ReactNode }) {
  return <div className={cx('kit-wordmark', className)} style={style}>{children}</div>;
}

/**
 * Live-status dot + caps label. Lobby and menu.
 *
 * @example <LiveDot>3 players online</LiveDot>
 */
export function LiveDot({ className, style, children }: { className?: string; style?: KitStyle; children?: ReactNode }) {
  return (
    <span className={cx('kit-live', className)} style={style}>
      <i className="kit-live__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * A standing token on a plinth — token picker, lobby seat.
 *
 * Textless, so its float loop carries no legibility risk. Pass the player's
 * token colour; the ball, its glow and the ground pool all follow.
 *
 * @example <Plinth color={TOKEN_HEX.blue} />
 */
export function Plinth({ color, className, style }: { color: string; className?: string; style?: KitStyle }) {
  return (
    <div className={cx('kit-plinth', className)} style={withVars({ '--tc': color }, style)}>
      <i className="kit-plinth__ground" aria-hidden="true" />
      <i className="kit-plinth__ball" aria-hidden="true" />
    </div>
  );
}
