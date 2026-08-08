import React, { useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { setMuted, isMuted } from '../audio/sfx';
import { FONT_FAMILY } from '../constants/fonts';
import { Z } from './kit';
import { CHROME_ROW_H, CHROME_ROW_RIGHT, CHROME_ROW_TOP } from './chromeRow';
import { useHudStandDown } from './takeoverStage';

const FONT = FONT_FAMILY;

// The bottom-right corner is owned by the action cluster (menu actions, lobby
// buttons, in-game HUD), so this sits at TOP-RIGHT across all screens, as the
// outermost (rightmost) chip of a 3-button utility cluster shared with
// CameraViewButton and FullscreenButton.
//
// ROW Y — THE CORNER, AND THE TOAST STACK IS THE ONE THAT YIELDS.
// This row sat at y96 for one release, to clear the migrated <ToastLayer>:
// that stack starts at the top of the safe box and, at its MAX_LIVE=2 hard
// cap, bottomed out at y86. Reviewed on device, y96 reads as three buttons
// loose in the middle of the right edge rather than as window chrome, so the
// priority was inverted. Persistent chrome takes the corner; the TRANSIENT
// surface moves. <ToastLayer> now starts below this row and derives its own
// top from `BELOW_CHROME_ROW` instead of carrying a second copy of these
// numbers, so the two cannot drift apart again.
//
// Every value comes from ./chromeRow, which owns the row's geometry and the
// safe-area reasoning behind it (in short: `max(inset, pad)`, never
// `calc(inset + pad)`, and --sa-t is 0 in a Safari tab but ~20 in a PWA).
const topRightStyle: React.CSSProperties = {
  position: 'fixed',
  top: CHROME_ROW_TOP,
  right: CHROME_ROW_RIGHT,
  bottom: 'auto',
  zIndex: Z.hud,
  width: CHROME_ROW_H,
  height: CHROME_ROW_H,
  pointerEvents: 'auto',
  fontFamily: FONT,
  fontWeight: 800,
  fontSize: 16,
  lineHeight: 1,
  border: 'none',
  borderRadius: 999,
  padding: 0,
  background: '#12121e',
  color: '#e8e8f0',
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * Small HUD toggle button for sound mute/unmute.
 * Persists state via sfx.ts → localStorage.
 *
 * *** THE CHROME CLUSTER YIELDS TO A TAKEOVER TOO. ***
 * Judgement call, and it turns on reachability rather than on importance.
 * These three chips are persistent utility, not game state, so there is a real
 * argument for keeping them lit — but they are at Z.hud (110) and a `.is-on`
 * takeover is `inset:0` with `pointer-events:auto` at 140, so they are ALREADY
 * untappable for as long as one is up, whatever they look like. Leaving them
 * lit therefore buys no function and costs two things: three chips that look
 * enabled and do nothing, and three more bright objects leaking through a fill
 * that only reaches 98.5% (95% at the top centre, which is exactly this row's
 * band). Hidden is the honest state, and it is the same state every other
 * HUD-layer surface is in. Nothing is lost that was reachable; the row is back
 * the instant the takeover closes.
 *
 * This button is mounted app-wide, not just in game — `useHudStandDown` reads
 * false on the menu, lobby and game-over screens, where no takeover can exist.
 */
export function MuteButton() {
  const [muted, setLocalMuted] = useState<boolean>(isMuted);
  const standDown = useHudStandDown();

  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setLocalMuted(next);
  };

  return (
    <button
      style={{ ...topRightStyle, ...standDown.style }}
      aria-hidden={standDown.ariaHidden}
      onClick={toggle}
      aria-label={muted ? 'Unmute' : 'Mute'}
      title={muted ? 'Unmute' : 'Mute'}
    >
      {muted ? <VolumeX size={20} aria-hidden /> : <Volume2 size={20} aria-hidden />}
    </button>
  );
}
