import { KIT } from './kit';
import type { KitStyle } from './kit';
import { useIsMobile } from './useIsMobile';
import { useOrientation } from './useOrientation';

/**
 * PORTRAIT LOCK — and it is the WHOLE mitigation, not a nicety.
 *
 * iOS Safari cannot lock orientation. `ScreenOrientation.lock()` is
 * unsupported, the Fullscreen API is iPad-only, and the lock call requires
 * fullscreen anyway. There is no code path that turns a portrait phone
 * sideways, so this overlay is the entire answer to "what happens in portrait"
 * — which is why it is full-screen and blocking rather than a dismissible
 * corner card. The previous version had a Dismiss button, and dismissing it
 * left the player in a landscape-first UI on a 390x844 viewport with every
 * three-column layout stacked into an unusable ribbon.
 *
 * IT ALSO HAS TO SAY WHY NOTHING HAPPENS WHEN YOU ROTATE. The single most
 * common cause is iOS's own Portrait Orientation Lock, which the page cannot
 * detect and cannot clear; naming it in Control Centre terms is the difference
 * between a hint and a dead end.
 *
 * NO `sa()` HERE, deliberately. This surface only ever renders in PORTRAIT,
 * where iOS reports NO horizontal inset at all (the notch is on the top edge,
 * not the sides) — so `sa('l', …)` would resolve to the plain pad anyway and
 * only add noise. The 40/24px padding is centred content with nothing near an
 * edge, comfortably clear of the top and bottom insets a portrait phone does
 * report. Verified by measurement at portrait 47/0/34/0 and 59/0/34/0.
 */

/** Below LoadingScreen (9999) and the debug overlays, above every kit surface. */
const Z_OVER_APP = 9000;

const KEYFRAMES = `
@keyframes rh-turn {
  0%, 16%   { transform: rotate(0deg); }
  50%, 100% { transform: rotate(-90deg); }
}
@media (prefers-reduced-motion: reduce) {
  .rh-phone { animation: none; transform: rotate(-90deg); }
}`;

export function RotateHint() {
  const isMobile = useIsMobile();
  const orientation = useOrientation();

  // Nothing to say on a desktop window or when already landscape.
  if (!isMobile || orientation !== 'portrait') return null;

  // `role="alert"`, not a dialog: it blocks, but there is nothing to focus and
  // nothing to dismiss, and a modal dialog with no focusable child strands a
  // screen-reader user inside it. An alert is announced and then read through.
  return (
    <div style={overlay} role="alert">
      <style>{KEYFRAMES}</style>

      <i className="rh-phone" style={phone} aria-hidden="true">
        <i style={phoneDot} />
      </i>

      <h2 style={title}>Rotate your device</h2>
      <p style={body}>
        Mockopoly is a landscape table. Turn your phone sideways to play — the game is
        paused until you do.
      </p>
      <p style={hint}>
        Nothing happening when you rotate? Check that <b style={hintKey}>Portrait Orientation
        Lock</b> is switched off in Control Centre.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GEOMETRY
// ────────────────────────────────────────────────────────────────────────────

const overlay: KitStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: Z_OVER_APP,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: KIT.sp3,
  padding: `${KIT.sp8} ${KIT.sp6}`,
  textAlign: 'center',
  fontFamily: KIT.font,
  // Opaque enough that nothing behind it competes; this is a stop, not a tint.
  background: `radial-gradient(120% 90% at 50% 46%, rgb(18 18 30 / 96%), rgb(6 6 13 / 99%) 76%), ${KIT.surfaceVoid}`,
};

/** A phone outline that turns. 32x52 with a home dot, drawn in borders — no
 *  asset, no icon font, and it reads at a glance from across a room. */
const phone: KitStyle = {
  position: 'relative',
  display: 'block',
  // 38x60 BORDER box = the same 34x56 interior the home dot is positioned
  // against, plus the 2px outline. Written as 34x56 these were content-box
  // measurements that rendered 38x60; index.css now sets border-box globally,
  // so the outer number is the one to declare.
  width: 38,
  height: 60,
  marginBottom: KIT.sp2,
  border: `2px solid ${KIT.text2}`,
  borderRadius: 7,
  animation: `rh-turn 2.6s ${KIT.easeIo} infinite`,
};

const phoneDot: KitStyle = {
  position: 'absolute',
  left: '50%',
  bottom: 5,
  width: 4,
  height: 4,
  borderRadius: '50%',
  background: KIT.text2,
  transform: 'translateX(-50%)',
};

const title: KitStyle = {
  margin: 0,
  font: `700 ${KIT.fsHero}/${KIT.lhTight} ${KIT.font}`,
  letterSpacing: KIT.lsTight,
  color: KIT.text,
};

const body: KitStyle = {
  margin: 0,
  maxWidth: 320,
  font: `400 ${KIT.fsLabelLg}/${KIT.lhBody} ${KIT.font}`,
  color: KIT.text2,
};

const hint: KitStyle = {
  margin: 0,
  maxWidth: 320,
  font: `400 ${KIT.fsLabel}/${KIT.lhBody} ${KIT.font}`,
  color: KIT.text2,
};

const hintKey: KitStyle = { color: KIT.gold, fontWeight: 700 };
