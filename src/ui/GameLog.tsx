import { useGameStore } from '../state/gameStore';
import { useIsMobile } from './useIsMobile';
import type { GameLogEntry } from '../types/GameState';
import { FONT_FAMILY } from '../constants/fonts';

export function GameLog() {
  const log: GameLogEntry[] = useGameStore((s) => s.state?.log) ?? [];
  const isMobile = useIsMobile();

  if (!log.length) return null;
  const recent = log.slice(-6).reverse();

  if (isMobile) {
    // On mobile: a small, low-opacity toast at the bottom-left showing the two
    // most recent entries. Each new entry fades in (keyed by timestamp). It sits
    // clear of the bottom-right action cluster and never covers the board.
    const slim = recent.slice(0, 2);
    return (
      <div style={wrapMobile}>
        {slim.map((e, i) => (
          <div key={`${e.timestamp}-${i}`} data-testid="log-entry" style={entryMobile}>{e.message}</div>
        ))}
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={hdr}>Log</div>
      {recent.map((e, i) => (
        <div key={`${e.timestamp}-${i}`} data-testid="log-entry" style={entry}>{e.message}</div>
      ))}
    </div>
  );
}

// ── Desktop styles (unchanged) ──
const wrap: React.CSSProperties = {
  position: 'fixed', bottom: 14, right: 14, width: 240, background: '#12121e', color: '#8888a0',
  borderRadius: 12, padding: 12, fontFamily: FONT_FAMILY, zIndex: 30,
  boxShadow: '0 8px 22px -12px rgba(0,0,0,.6)',
};
const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#555570', fontWeight: 800, marginBottom: 6 };
const entry: React.CSSProperties = { fontSize: 12, fontWeight: 500, padding: '3px 0', lineHeight: 1.35 };

// ── Mobile styles: low-opacity fading toast, bottom-left, 2 entries max ──
const wrapMobile: React.CSSProperties = {
  position: 'fixed',
  bottom: 'calc(10px + env(safe-area-inset-bottom))',
  left: 'calc(10px + env(safe-area-inset-left))',
  maxWidth: '46vw',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  alignItems: 'flex-start',
  fontFamily: FONT_FAMILY,
  zIndex: 28,
  pointerEvents: 'none',
};
const entryMobile: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#e8e8f0',
  background: 'rgba(8,8,15,0.55)',
  borderRadius: 8,
  padding: '4px 9px',
  lineHeight: 1.25,
  opacity: 0.85,
  animation: 'logToastIn 0.3s ease',
};
