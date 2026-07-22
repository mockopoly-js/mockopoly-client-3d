import { useGameStore } from '../state/gameStore';
import { BOARD_SPACES } from '../constants/board';
import { COLOR_GROUP_HEX } from '../constants/theme';
import type { PropertyState, Partnership } from '../types/GameState';

export function PropertyListPanel() {
  const properties: PropertyState[] = useGameStore((s) => s.state?.properties) ?? [];
  const partnerships: Partnership[] = useGameStore((s) => s.state?.partnerships) ?? [];
  const myId = useGameStore((s) => s.myPlayerId);
  if (!myId) return null;

  const myPartnerGroups = new Set(
    partnerships
      .filter((pt) => pt.status === 'active' && pt.partners.some((e) => e.playerId === myId))
      .map((pt) => pt.colorGroup),
  );

  const rows = properties.filter((p) => {
    if (p.ownerId === myId) return true;
    if (p.ownerId == null) return false;
    const space = BOARD_SPACES[p.spaceIndex];
    return !!space?.colorGroup && myPartnerGroups.has(space.colorGroup);
  });

  if (!rows.length) return null;

  return (
    <div style={wrap}>
      <div style={hdr}>Your properties</div>
      {rows.map((p) => {
        const space = BOARD_SPACES[p.spaceIndex];
        const badges = [
          p.hasHotel ? 'Hotel' : p.houses > 0 ? `${p.houses}h` : null,
          p.isMortgaged ? '[M]' : null,
        ].filter(Boolean).join(' ');
        const accent = space?.colorGroup ? COLOR_GROUP_HEX[space.colorGroup] : '#555570';
        return (
          <div key={p.spaceIndex} style={{ ...row, opacity: p.isMortgaged ? 0.6 : 1 }}>
            <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: accent }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space?.name ?? `#${p.spaceIndex}`}</span>
            {badges && <span style={{ color: '#8888a0', fontWeight: 700, fontSize: 11 }}>{badges}</span>}
          </div>
        );
      })}
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed', top: 14, left: 14, width: 190, background: '#12121e', color: '#e8e8f0',
  borderRadius: 12, padding: 12, fontFamily: 'ui-rounded, system-ui, sans-serif', zIndex: 30,
  maxHeight: '55vh', overflowY: 'auto', boxShadow: '0 8px 22px -12px rgba(0,0,0,.6)',
};
const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8888a0', fontWeight: 800, marginBottom: 8 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, padding: '5px 0' };
