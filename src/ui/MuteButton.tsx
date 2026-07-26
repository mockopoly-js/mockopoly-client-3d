import React, { useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { setMuted, isMuted } from '../audio/sfx';
import { useGameStore } from '../state/gameStore';
import { useIsMobile } from './useIsMobile';
import { FONT_FAMILY } from '../constants/fonts';

const FONT = FONT_FAMILY;

const baseStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 16,
  right: 16,
  zIndex: 50,
  pointerEvents: 'auto',
  fontFamily: FONT,
  fontWeight: 800,
  fontSize: 20,
  lineHeight: 1,
  border: 'none',
  borderRadius: 12,
  padding: '10px 14px',
  background: '#12121e',
  color: '#e8e8f0',
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

// In-game on mobile the bottom-right corner is owned by the action cluster
// ([⋯][End turn][ROLL]), so the icon chips move to the TOP-RIGHT safe area as a
// compact round cluster below any modal (z:35 < modal z:40). Mute is the
// rightmost chip; CameraView / Fullscreen step left of it (right +52 each).
const mobileStyle: React.CSSProperties = {
  top: 'calc(8px + env(safe-area-inset-top))',
  right: 'calc(8px + env(safe-area-inset-right))',
  bottom: 'auto',
  zIndex: 35,
  width: 44,
  height: 44,
  padding: 0,
  borderRadius: 999,
};

/**
 * Small HUD toggle button for sound mute/unmute.
 * Persists state via sfx.ts → localStorage.
 */
export function MuteButton() {
  const [muted, setLocalMuted] = useState<boolean>(isMuted);
  const isMobile = useIsMobile();
  const screen = useGameStore((s) => s.screen);
  const inGameMobile = isMobile && screen === 'game';

  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setLocalMuted(next);
  };

  const style = inGameMobile ? { ...baseStyle, ...mobileStyle } : baseStyle;

  return (
    <button style={style} onClick={toggle} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
      {muted ? <VolumeX size={20} aria-hidden /> : <Volume2 size={20} aria-hidden />}
    </button>
  );
}
