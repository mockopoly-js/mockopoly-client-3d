import { useGameStore } from '../state/gameStore';
import { useIsMobile } from './useIsMobile';
import type { GameLogEntry } from '../types/GameState';

export function GameLog() {
  const log: GameLogEntry[] = useGameStore((s) => s.state?.log) ?? [];
  const isMobile = useIsMobile();

  if (!log.length) return null;
  const recent = log.slice(-6).reverse();

  if (isMobile) {
    // On mobile: show only the most recent 2 entries in a slim strip at the top-right
    // (below PlayerPods strip, above the board), does not overlap the bottom action bar.
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
  borderRadius: 12, padding: 12, fontFamily: 'ui-rounded, system-ui, sans-serif', zIndex: 30,
  boxShadow: '0 8px 22px -12px rgba(0,0,0,.6)',
};
const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#555570', fontWeight: 800, marginBottom: 6 };
const entry: React.CSSProperties = { fontSize: 12, fontWeight: 500, padding: '3px 0', lineHeight: 1.35 };

// ── Mobile styles: slim strip, top-right, 2 entries max ──
const wrapMobile: React.CSSProperties = {
  position: 'fixed',
  top: 90, // below topBarMobile (~36px) + PlayerPods strip (~54px)
  right: 6,
  width: 170,
  background: 'rgba(18,18,30,0.82)',
  color: '#8888a0',
  borderRadius: 8,
  padding: '5px 8px',
  fontFamily: 'ui-rounded, system-ui, sans-serif',
  zIndex: 29,
};
const entryMobile: React.CSSProperties = { fontSize: 11, fontWeight: 500, padding: '2px 0', lineHeight: 1.3 };
