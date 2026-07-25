import React from 'react';
import { Camera, User } from 'lucide-react';
import { useGameStore } from '../state/gameStore';
import { useIsMobile } from './useIsMobile';
import { FONT_FAMILY } from '../constants/fonts';

const FONT = FONT_FAMILY;

/**
 * Small HUD toggle for the camera view mode.
 *
 * Placement: right-middle edge, directly above the MuteButton (which sits at
 * bottom:16 / right:16). This corner is otherwise free — Trade/Partnership/Deal
 * live bottom-left, Roll/End-Turn bottom-center, the player pods top-right, the
 * debug overlay top-left, and the GameLog panel (fixed width 240) does not reach
 * the far-right gutter. z-index sits just under MuteButton's 50.
 *
 * Look: matches MuteButton's dark HUD chip. When third-person is ACTIVE the chip
 * lights up with a gold border + glow and a gold icon, so the pressed state reads
 * at a glance. Icon = Camera (free) / User (over-the-shoulder follow).
 */
export function CameraViewButton() {
  const cameraMode = useGameStore((s) => s.cameraMode);
  const toggleCameraMode = useGameStore((s) => s.toggleCameraMode);
  const isMobile = useIsMobile();

  const active = cameraMode === 'thirdPerson';

  const style: React.CSSProperties = {
    position: 'fixed',
    // Desktop: stacked above MuteButton on the right edge. Mobile in-game: middle
    // chip of the horizontal corner cluster that clears the bottom action bars and
    // sits below modals (z:35 < modal z:40).
    bottom: isMobile ? 'calc(116px + env(safe-area-inset-bottom))' : 72,
    right: isMobile ? 'calc(64px + env(safe-area-inset-right))' : 16,
    zIndex: isMobile ? 35 : 49,
    pointerEvents: 'auto',
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: 20,
    lineHeight: 1,
    borderRadius: 12,
    padding: '10px 14px',
    minWidth: isMobile ? 44 : undefined,
    minHeight: isMobile ? 44 : undefined,
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
    transition: 'background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease',
  };

  const label = active ? '3rd Person camera (on) — switch to Free Cam' : 'Switch to 3rd Person camera';

  return (
    <button
      style={style}
      onClick={toggleCameraMode}
      aria-label={label}
      aria-pressed={active}
      title={active ? '3rd Person' : 'Free Cam'}
    >
      {active ? <User size={20} aria-hidden /> : <Camera size={20} aria-hidden />}
    </button>
  );
}
