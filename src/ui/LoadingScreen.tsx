import { KIT, Plinth, Wordmark, sa } from './kit';
import type { KitStyle } from './kit';
import { TOKEN_HEX } from '../constants/theme';

/**
 * THE FIRST SURFACE ANYONE SEES — the Suspense fallback for the 3D chunk and
 * for the character locker.
 *
 * NO FAKE PROGRESS BAR. The approved mockup draws a determinate bar because a
 * mockup can invent a number; React's `Suspense` gives none. A bar that fills
 * on a timer is a lie about a ~1MB download on an unknown connection, and it is
 * a lie that is caught every time the network is slow. This is an indeterminate
 * sweep instead: same visual language (a flat fill driven by `transform`,
 * exactly like the kit's turn fill and hold fill), no invented information.
 *
 * IT ANIMATES TRANSFORM, NEVER OPACITY (rule R4) and carries no fill mode, so a
 * backgrounded tab cannot freeze it half-drawn.
 *
 * z-index 9999 IS DELIBERATE and is the one place a raw z-index is correct.
 * The kit's own scale tops out at `--z-dev` (200) and its header states that
 * the loading overlay must WIN against every kit surface — it is what covers
 * the app while the app does not exist yet.
 */
const Z_ABOVE_EVERYTHING = 9999;

/**
 * Page-local CSS. Two things genuinely need a stylesheet rather than an inline
 * style: `@keyframes`, and the per-child float offset — the plinth's bob lives
 * on `.kit-plinth__ball`, a node this component never renders itself, so the
 * delay cannot be an inline style on the element it is passed to.
 */
const KEYFRAMES = `
@keyframes kit-load-sweep {
  0%   { transform: translateX(-100%) scaleX(0.34); }
  50%  { transform: translateX(0%)    scaleX(0.52); }
  100% { transform: translateX(100%)  scaleX(0.34); }
}
.ls-trio > :nth-child(2) .kit-plinth__ball { animation-delay: 160ms; }
.ls-trio > :nth-child(3) .kit-plinth__ball { animation-delay: 320ms; }
@media (prefers-reduced-motion: reduce) {
  .ls-sweep { animation: none; transform: scaleX(1); }
}`;

export function LoadingScreen() {
  return (
    <div style={wrap} role="status" aria-live="polite" aria-label="Loading">
      <style>{KEYFRAMES}</style>

      <Wordmark>Mockopoly</Wordmark>

      {/* Three tokens on plinths — the same object the board uses for a player,
          bobbing out of phase. Textless, so the loop carries no legibility risk. */}
      <div className="ls-trio" style={trio} aria-hidden="true">
        <Plinth color={TOKEN_HEX.blue} />
        <Plinth color={KIT.gold} />
        <Plinth color={TOKEN_HEX.red} />
      </div>

      <div style={track}>
        <i className="ls-sweep" style={sweep} />
      </div>

      <div style={caption}>Loading the board…</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GEOMETRY — non-interactive by construction, so it is exempt from the
// left/centre/right split: there is nothing here to mis-tap.
// ────────────────────────────────────────────────────────────────────────────

const wrap: KitStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: Z_ABOVE_EVERYTHING,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: KIT.sp4,
  // max(inset, pad) — the insets are NOT interior padding and must not stack.
  paddingInline: sa('l', 16),
  fontFamily: KIT.font,
  background: `radial-gradient(120% 90% at 50% 42%, #0d0d1c, ${KIT.surfaceVoid} 74%)`,
};

const trio: KitStyle = { display: 'flex', gap: 14 };

const track: KitStyle = {
  position: 'relative',
  width: 'min(300px, 60vw)',
  height: 6,
  borderRadius: KIT.rPill,
  overflow: 'hidden',
  background: 'rgb(232 232 240 / 14%)',
  boxShadow: KIT.ringHair,
};

const sweep: KitStyle = {
  display: 'block',
  width: '100%',
  height: '100%',
  transformOrigin: 'center',
  background: `linear-gradient(90deg, transparent, ${KIT.gold}, ${KIT.goldBright}, transparent)`,
  animation: `kit-load-sweep 1.25s ${KIT.easeIo} infinite`,
};

const caption: KitStyle = {
  font: `500 ${KIT.fsLabel}/${KIT.lhSnug} ${KIT.font}`,
  letterSpacing: KIT.lsWide,
  color: KIT.text2,
};
