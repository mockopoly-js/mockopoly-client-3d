import React, { useState } from 'react';
import { setMuted, isMuted } from '../audio/sfx';

const FONT = "ui-rounded, system-ui, sans-serif";

const style: React.CSSProperties = {
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
};

/**
 * Small HUD toggle button for sound mute/unmute.
 * Persists state via sfx.ts → localStorage.
 */
export function MuteButton() {
  const [muted, setLocalMuted] = useState<boolean>(isMuted);

  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setLocalMuted(next);
  };

  return (
    <button style={style} onClick={toggle} title={muted ? 'Unmute' : 'Mute'}>
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
