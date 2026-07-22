import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { DevHacks } from '../types/GameState';

const HACKS: { key: keyof DevHacks; label: string }[] = [
  { key: 'unlimitedMoney', label: 'Set all players to £999M' },
  { key: 'soloPlay', label: 'Allow 1-player game start' },
  { key: 'alwaysLandOnMayfair', label: 'Override movement to position 39' },
  { key: 'alwaysLandOnCard', label: 'Cycle Chance / Community Chest spaces' },
  { key: 'sameTurn', label: 'Never advance to next player' },
  { key: 'preAssignProperties', label: 'Give test properties on game start' },
];

export function DevHacksPanel() {
  const open = useGameStore((s) => s.showDevHacks);
  const toggleDevHacks = useGameStore((s) => s.toggleDevHacks);
  const devHacks = useGameStore((s) => s.state?.devHacks);
  if (!open) return null;

  const set = (key: keyof DevHacks, enabled: boolean) =>
    socketManager.emit(EVENTS.DEV_SET_HACK, { hack: key, enabled });

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={hdr}>
          <span>Dev Hacks</span>
          <button onClick={() => toggleDevHacks(false)} aria-label="Close" style={x}>×</button>
        </div>
        {HACKS.map(({ key, label }) => (
          <label key={key} style={rowStyle}>
            <input
              type="checkbox"
              checked={!!devHacks?.[key]}
              onChange={(e) => set(key, e.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
        <div style={foot}>Changes apply immediately to the current game.</div>
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: 'ui-rounded, system-ui, sans-serif' };
const card: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: 16, padding: 20, width: 340, boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)' };
const hdr: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 800, fontSize: 18, marginBottom: 14 };
const x: React.CSSProperties = { background: 'none', border: 'none', color: '#8888a0', fontSize: 22, cursor: 'pointer', lineHeight: 1 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', fontSize: 14, cursor: 'pointer' };
const foot: React.CSSProperties = { marginTop: 12, fontSize: 12, color: '#8888a0' };
