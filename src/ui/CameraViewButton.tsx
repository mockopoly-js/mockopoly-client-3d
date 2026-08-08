import React from 'react';
import { Camera, User } from 'lucide-react';
import { useGameStore } from '../state/gameStore';
import { FONT_FAMILY } from '../constants/fonts';
import { Z } from './kit';
import { CHROME_PITCH, CHROME_ROW_H, CHROME_ROW_RIGHT, CHROME_ROW_TOP } from './chromeRow';
import { useHudStandDown } from './takeoverStage';

const FONT = FONT_FAMILY;

/**
 * Small HUD toggle for the camera view mode.
 *
 * ONE LAYOUT, NOT A DESKTOP/MOBILE BRANCH. The redesign is landscape-first (see
 * TurnHud's own note on the same point) and the geometry below is the kit's own
 * safe-area frame, which is identical on desktop review and on device — there is
 * nothing left for a `useIsMobile` branch to disagree about.
 *
 * Placement: middle chip of the TOP-RIGHT utility cluster (Mute is outermost,
 * this steps left by one CHROME_PITCH — 44px chip + 8px dead space). The row's
 * geometry and its safe-area reasoning live in ./chromeRow; see MuteButton for
 * why the row is in the corner and what had to move for it. z-index sits on the
 * kit's HUD layer, under the toast layer (Z.toast).
 *
 * Look: matches MuteButton's dark HUD chip. When third-person is ACTIVE the chip
 * lights up with a gold border + glow and a gold icon, so the pressed state reads
 * at a glance. Icon = Camera (free) / User (over-the-shoulder follow).
 *
 * Stands down under a takeover with the rest of the cluster — the reasoning for
 * the whole row is on <MuteButton>.
 */
/** The pressed-state animation. Passed to `useHudStandDown` rather than left on
 *  the style object: the stand-down owns the `transition` shorthand, so a
 *  second one here would be silently overwritten by the spread below. */
const CHIP_TRANSITION = 'background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease';

export function CameraViewButton() {
  const cameraMode = useGameStore((s) => s.cameraMode);
  const toggleCameraMode = useGameStore((s) => s.toggleCameraMode);
  const standDown = useHudStandDown(CHIP_TRANSITION);

  const active = cameraMode === 'thirdPerson';

  const style: React.CSSProperties = {
    position: 'fixed',
    top: CHROME_ROW_TOP,
    bottom: 'auto',
    // One CHROME_PITCH (44px chip + 8px dead space) added ON TOP of the same
    // anchor MuteButton uses — `calc(max(var(--sa-r), 8px) + 52px)` —
    // NOT `max(var(--sa-r), 60px)`. Those look equivalent until the device's
    // real right inset exceeds the raw 8px pad: at --sa-r 47, max(47,8)=47 for
    // MuteButton but max(47,60)=60 for this button, a 13px gap instead of the
    // intended 52 and a 31px overlap between the two chips. Anchoring the SAME
    // expression and adding pure spacing on top keeps the pitch correct at any
    // inset — 0 on desktop, 47 on an iPhone 13 Pro, 62 on an iPhone 17.
    right: `calc(${CHROME_ROW_RIGHT} + ${CHROME_PITCH}px)`,
    zIndex: Z.hud,
    pointerEvents: 'auto',
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: 20,
    lineHeight: 1,
    borderRadius: 999,
    padding: 0,
    width: CHROME_ROW_H,
    height: CHROME_ROW_H,
    background: active ? '#1c1a12' : '#12121e',
    color: active ? '#f0d060' : '#e8e8f0',
    border: active ? '1px solid #d4af37' : '1px solid transparent',
    cursor: 'pointer',
    boxShadow: active
      ? '0 2px 8px rgba(0,0,0,0.5), 0 0 12px rgba(212,175,55,0.45)'
      : '0 2px 8px rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...standDown.style,
  };

  const label = active ? '3rd Person camera (on) — switch to Free Cam' : 'Switch to 3rd Person camera';

  return (
    <button
      style={style}
      aria-hidden={standDown.ariaHidden}
      onClick={toggleCameraMode}
      aria-label={label}
      aria-pressed={active}
      title={active ? '3rd Person' : 'Free Cam'}
    >
      {active ? <User size={20} aria-hidden /> : <Camera size={20} aria-hidden />}
    </button>
  );
}
