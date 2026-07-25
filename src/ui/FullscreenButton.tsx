import React, { useEffect, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import { FONT_FAMILY } from '../constants/fonts';

const FONT = FONT_FAMILY;

/**
 * Small HUD toggle for the browser Fullscreen API.
 *
 * Placement: right-middle edge, directly above the CameraViewButton (bottom:72)
 * which itself sits above the MuteButton (bottom:16) — stacking further up the
 * same free right-edge gutter so none of the three chips overlap. z-index sits
 * just under CameraViewButton's 49.
 *
 * iPhone Safari has no Fullscreen API at all (`document.fullscreenEnabled` is
 * false there), so the button renders nothing and those users rely on
 * Add-to-Home-Screen for a chrome-less experience instead. iPad Safari and
 * Android Chrome do support it and get the button.
 */
export function FullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    typeof document !== 'undefined' && !!document.fullscreenElement,
  );

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
    bottom: 128,
    right: 16,
    zIndex: 48,
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

  const label = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';

  return (
    <button style={style} onClick={toggle} aria-label={label} title={label}>
      {isFullscreen ? <Minimize size={20} aria-hidden /> : <Maximize size={20} aria-hidden />}
    </button>
  );
}
