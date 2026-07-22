import { useGameStore } from '../state/gameStore';
import type { GameLogEntry } from '../types/GameState';

export function GameLog() {
  const log: GameLogEntry[] = useGameStore((s) => s.state?.log) ?? [];
  if (!log.length) return null;
  const recent = log.slice(-6).reverse();
  return (
    <div style={wrap}>
      <div style={hdr}>Log</div>
      {recent.map((e, i) => (
        <div key={`${e.timestamp}-${i}`} data-testid="log-entry" style={entry}>{e.message}</div>
      ))}
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed', bottom: 14, right: 14, width: 240, background: '#12121e', color: '#8888a0',
  borderRadius: 12, padding: 12, fontFamily: 'ui-rounded, system-ui, sans-serif', zIndex: 30,
  boxShadow: '0 8px 22px -12px rgba(0,0,0,.6)',
};
const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#555570', fontWeight: 800, marginBottom: 6 };
const entry: React.CSSProperties = { fontSize: 12, fontWeight: 500, padding: '3px 0', lineHeight: 1.35 };
