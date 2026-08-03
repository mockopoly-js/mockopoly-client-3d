import React from 'react';
import { Compass } from 'lucide-react';
import { useGameStore } from '../state/gameStore';
import { useIsMobile } from './useIsMobile';
import { FONT_FAMILY } from '../constants/fonts';

const FONT = FONT_FAMILY;

/**
 * MOBILE-ONLY HUD toggle for free-look camera aim.
 *
 * Free-look decouples the camera's AIM from the board (see CameraRig): while ON,
 * OrbitControls is disabled and the camera rotates in place — one-finger drag aims
 * the view anywhere, including STRAIGHT UP at the night sky, without orbiting under
 * the terrain. Two-finger pinch/drag still zoom/pan. Tapping OFF returns to the
 * normal board framing for gameplay.
 *
 * Renders ONLY on mobile (returns null on desktop, which keeps the frozen desktop
 * control path). Placement: leftmost chip of the in-game TOP-RIGHT round cluster,
 * one step left of Fullscreen (right:112) at right:164 — Mute (8) / Camera (60) /
 * Fullscreen (112) / FreeLook (164). Sits below modals (z:35 < modal z:40).
 *
 * Look: matches the other HUD chips. When free-look is ACTIVE the chip lights up
 * with a gold border + glow and a gold icon so the pressed state reads at a glance.
 */
export function FreeLookButton() {
  const cameraMode = useGameStore((s) => s.cameraMode);
  const toggleFreeLook = useGameStore((s) => s.toggleFreeLook);
  const isMobile = useIsMobile();

  // Free-look is a mobile-only capability; desktop keeps its frozen control path.
  if (!isMobile) return null;

  const active = cameraMode === 'freeLook';

  const style: React.CSSProperties = {
    position: 'fixed',
    top: 'calc(8px + env(safe-area-inset-top))',
    right: 'calc(164px + env(safe-area-inset-right))',
    zIndex: 35,
    pointerEvents: 'auto',
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: 20,
    lineHeight: 1,
    borderRadius: 999,
    padding: 0,
    width: 44,
    height: 44,
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

  const label = active
    ? 'Free-look camera (on) — drag to aim, tap to return to board view'
    : 'Free-look camera — aim anywhere, including straight up at the sky';

  return (
    <button
      style={style}
      onClick={toggleFreeLook}
      aria-label={label}
      aria-pressed={active}
      title={active ? 'Free-look (on)' : 'Free-look'}
    >
      <Compass size={20} aria-hidden />
    </button>
  );
}
