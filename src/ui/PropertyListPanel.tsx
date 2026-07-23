import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { BOARD_SPACES } from '../constants/board';
import { COLOR_GROUP_HEX } from '../constants/theme';
import { useIsMobile } from './useIsMobile';
import type { PropertyState, Partnership } from '../types/GameState';

export function PropertyListPanel() {
  const properties: PropertyState[] = useGameStore((s) => s.state?.properties) ?? [];
  const partnerships: Partnership[] = useGameStore((s) => s.state?.partnerships) ?? [];
  const myId = useGameStore((s) => s.myPlayerId);
  const selectProperty = useGameStore((s) => s.selectProperty);
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

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

  if (isMobile) {
    // On mobile: a toggle button pinned to left edge; tapping reveals a drawer above the bottom bar.
    return (
      <>
        {!open && (
          <button style={toggleBtn} onClick={() => setOpen(true)} aria-label="Show properties">
            Prop ({rows.length})
          </button>
        )}
        {open && (
          <div style={drawerWrap}>
            <div style={drawerHdr}>
              <span style={hdrText}>Your properties</span>
              <button style={closeBtn} onClick={() => setOpen(false)} aria-label="Close properties">×</button>
            </div>
            {rows.map((p) => {
              const space = BOARD_SPACES[p.spaceIndex];
              const badges = [
                p.hasHotel ? 'Hotel' : p.houses > 0 ? `${p.houses}h` : null,
                p.isMortgaged ? '[M]' : null,
              ].filter(Boolean).join(' ');
              const accent = space?.colorGroup ? COLOR_GROUP_HEX[space.colorGroup] : '#555570';
              return (
                <div key={p.spaceIndex} style={{ ...row, opacity: p.isMortgaged ? 0.6 : 1, cursor: 'pointer' }} onClick={() => { selectProperty(p.spaceIndex); setOpen(false); }}>
                  <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: accent }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space?.name ?? `#${p.spaceIndex}`}</span>
                  {badges && <span style={{ color: '#8888a0', fontWeight: 700, fontSize: 11 }}>{badges}</span>}
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  }

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
          <div key={p.spaceIndex} style={{ ...row, opacity: p.isMortgaged ? 0.6 : 1, cursor: 'pointer' }} onClick={() => selectProperty(p.spaceIndex)}>
            <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: accent }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space?.name ?? `#${p.spaceIndex}`}</span>
            {badges && <span style={{ color: '#8888a0', fontWeight: 700, fontSize: 11 }}>{badges}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Desktop styles (unchanged) ──
const wrap: React.CSSProperties = {
  position: 'fixed', top: 14, left: 14, width: 190, background: '#12121e', color: '#e8e8f0',
  borderRadius: 12, padding: 12, fontFamily: 'ui-rounded, system-ui, sans-serif', zIndex: 30,
  maxHeight: '55vh', overflowY: 'auto', boxShadow: '0 8px 22px -12px rgba(0,0,0,.6)',
};
const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8888a0', fontWeight: 800, marginBottom: 8 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, padding: '5px 0' };

// ── Mobile styles ──
const F = 'ui-rounded, system-ui, sans-serif';
const toggleBtn: React.CSSProperties = {
  position: 'fixed',
  left: 8,
  // sit between the player pods strip and the HudButtons row
  bottom: 'calc(120px + env(safe-area-inset-bottom))',
  fontFamily: F, fontWeight: 800, fontSize: 12,
  border: 'none', borderRadius: 10, padding: '8px 10px', cursor: 'pointer',
  background: '#12121e', color: '#e8e8f0',
  boxShadow: '0 4px 12px -4px rgba(0,0,0,.6)',
  zIndex: 30, minHeight: 44,
};
const drawerWrap: React.CSSProperties = {
  position: 'fixed',
  left: 0, right: 0,
  bottom: 'calc(120px + env(safe-area-inset-bottom))',
  background: '#12121e', color: '#e8e8f0',
  borderRadius: '12px 12px 0 0',
  padding: 12,
  fontFamily: F, zIndex: 35,
  maxHeight: '40vh', overflowY: 'auto',
  boxShadow: '0 -8px 24px -8px rgba(0,0,0,.5)',
};
const drawerHdr: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
};
const hdrText: React.CSSProperties = { fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8888a0', fontWeight: 800 };
const closeBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#8888a0', fontSize: 20, cursor: 'pointer', lineHeight: 1 };
