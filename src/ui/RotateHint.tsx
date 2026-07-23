import { useState } from 'react';
import { useIsMobile } from './useIsMobile';
import { useOrientation } from './useOrientation';
import { FONT_FAMILY } from '../constants/fonts';

/**
 * Non-blocking portrait hint overlay.
 * Shown ONLY when isMobile && orientation === 'portrait'.
 * Auto-hides when the device rotates to landscape.
 * Dismissible: user can tap "Dismiss" to hide for the rest of the session.
 * pointer-events are only on the card (not the full-screen backdrop) so
 * the game underneath remains usable in portrait mode.
 */
export function RotateHint() {
  const isMobile = useIsMobile();
  const orientation = useOrientation();
  const [dismissed, setDismissed] = useState(false);

  // Nothing to show on desktop or landscape.
  if (!isMobile || orientation !== 'portrait' || dismissed) return null;

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={icon}>&#8635;</div>
        <div style={title}>Rotate your device</div>
        <div style={subtitle}>For the best experience, play Mockopoly in landscape mode.</div>
        <button onClick={() => setDismissed(true)} style={btn}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

const F = FONT_FAMILY;

// Full-screen overlay — pointer-events:none so taps pass through to the game.
// The card itself has pointer-events:auto so it can be interacted with.
const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  // Subtle darkening behind the card only via the card's box-shadow; not a full
  // modal backdrop — the hint is non-blocking.
};

const card: React.CSSProperties = {
  pointerEvents: 'auto',
  fontFamily: F,
  background: '#12121e',
  color: '#e8e8f0',
  borderRadius: 20,
  padding: '28px 24px 20px',
  width: 'min(80vw, 300px)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
  textAlign: 'center',
  boxShadow: '0 24px 64px -16px rgba(0,0,0,.8)',
};

const icon: React.CSSProperties = {
  fontSize: 48,
  lineHeight: 1,
  color: '#d4af37',
};

const title: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 18,
};

const subtitle: React.CSSProperties = {
  fontSize: 14,
  color: '#8888a0',
  lineHeight: 1.45,
};

const btn: React.CSSProperties = {
  fontFamily: F,
  fontWeight: 800,
  fontSize: 14,
  border: 'none',
  borderRadius: 14,
  padding: '12px 28px',
  cursor: 'pointer',
  background: '#2a2a42',
  color: '#e8e8f0',
  marginTop: 4,
  minHeight: 44,
  touchAction: 'manipulation',
};
