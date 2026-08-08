import React, { useEffect, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import { FONT_FAMILY } from '../constants/fonts';
import { Z } from './kit';
import { CHROME_PITCH, CHROME_ROW_H, CHROME_ROW_RIGHT, CHROME_ROW_TOP } from './chromeRow';
import { useHudStandDown } from './takeoverStage';

const FONT = FONT_FAMILY;

/**
 * Small HUD toggle for the browser Fullscreen API.
 *
 * ONE LAYOUT, NOT A DESKTOP/MOBILE BRANCH — see CameraViewButton's note; the
 * kit's safe-area frame renders identically on desktop review and on device.
 *
 * Placement: leftmost chip of the TOP-RIGHT utility cluster, two CHROME_PITCHes
 * in from MuteButton. The row's geometry lives in ./chromeRow; see MuteButton
 * for why the row is in the corner and what had to move for it.
 * z-index sits on the kit's HUD layer, under the toast layer (Z.toast).
 *
 * iPhone Safari has no Fullscreen API at all (`document.fullscreenEnabled` is
 * false there), so the button renders nothing and those users rely on
 * Add-to-Home-Screen for a chrome-less experience instead. iPad Safari and
 * Android Chrome do support it and get the button.
 *
 * Stands down under a takeover with the rest of the cluster — the reasoning for
 * the whole row is on <MuteButton>.
 */
export function FullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    typeof document !== 'undefined' && !!document.fullscreenElement,
  );
  // Before the capability guard below: hooks may not sit behind a conditional
  // return, and this one is a store subscription.
  const standDown = useHudStandDown();

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (typeof document === 'undefined' || !document.fullscreenEnabled) return null;

  const toggle = () => {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => { /* ignore */ });
      } else {
        document.documentElement.requestFullscreen().catch(() => { /* ignore */ });
      }
    } catch {
      // Fullscreen API rejected the request (e.g. missing user-gesture context) — ignore.
    }
  };

  const style: React.CSSProperties = {
    position: 'fixed',
    top: CHROME_ROW_TOP,
    bottom: 'auto',
    // Two pitches added ON TOP of the same anchor MuteButton uses — see
    // CameraViewButton's note on why `max(var(--sa-r), 112px)` is wrong once
    // the device's real right inset exceeds a raw pad smaller than it.
    right: `calc(${CHROME_ROW_RIGHT} + ${CHROME_PITCH * 2}px)`,
    zIndex: Z.hud,
    pointerEvents: 'auto',
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: 20,
    lineHeight: 1,
    border: 'none',
    borderRadius: 999,
    padding: 0,
    width: CHROME_ROW_H,
    height: CHROME_ROW_H,
    background: '#12121e',
    color: '#e8e8f0',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...standDown.style,
  };

  const label = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';

  return (
    <button style={style} aria-hidden={standDown.ariaHidden} onClick={toggle} aria-label={label} title={label}>
      {isFullscreen ? <Minimize size={20} aria-hidden /> : <Maximize size={20} aria-hidden />}
    </button>
  );
}
