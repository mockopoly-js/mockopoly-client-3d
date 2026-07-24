import { X } from 'lucide-react';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import { COLOR_GROUP_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';
import { useIsMobile } from './useIsMobile';
import { FONT_FAMILY } from '../constants/fonts';

// Color groups that support building (exclude railroad and utility)
const BUILDABLE_GROUPS = new Set(['brown', 'light-blue', 'pink', 'orange', 'red', 'yellow', 'green', 'dark-blue']);

export function MortgagePanel() {
  const idx = useGameStore((s) => s.selectedPropertyIndex);
  const selectProperty = useGameStore((s) => s.selectProperty);
  const properties = useGameStore((s) => s.state?.properties);
  const players = useGameStore((s) => s.state?.players);
  const currentId = useGameStore((s) => s.state?.turn.currentPlayerId);
  const myId = useGameStore((s) => s.myPlayerId);
  const partnerships = useGameStore((s) => s.state?.partnerships);
  const isMobile = useIsMobile();

  if (idx == null) return null;
  const space = BOARD_SPACES[idx];
  const prop = properties?.find((p) => p.spaceIndex === idx);
  const me = players?.find((p) => p.id === myId);
  if (!space || !prop) return null;

  const mine = prop.ownerId === myId;
  const isMyTurn = currentId === myId;
  const canBuild = space.type === 'property'; // railroads/utilities can't build
  const houseCost = space.houseCost ?? 0;
  const accent = space.colorGroup ? COLOR_GROUP_HEX[space.colorGroup] : '#555570';

  const emit = (ev: string) => socketManager.emit(ev, { spaceIndex: idx });

  // ── Partnership check: is there an ACTIVE partnership for this color group
  // where I am a listed partner?
  const isBuildableGroup = space.colorGroup != null && BUILDABLE_GROUPS.has(space.colorGroup);
  const activePartnershipForGroup = isBuildableGroup && partnerships != null
    ? (partnerships.find(
        (p) =>
          p.status === 'active' &&
          p.colorGroup === space.colorGroup &&
          p.partners.some((pe) => pe.playerId === myId),
      ) ?? null)
    : null;
  const hasPartnershipForGroup = activePartnershipForGroup != null;

  // ── Full color-group ownership check ──
  // For buildable properties: every member of the same colorGroup must be
  // owned by me (ownerId === myId) AND none can be mortgaged.
  // Partnership override: if an active partnership exists for this group and I
  // am a partner, treat it as owning the full group.
  const groupMemberIndices = isBuildableGroup && space.colorGroup != null
    ? BOARD_SPACES
        .filter((s) => s.type === 'property' && s.colorGroup === space.colorGroup)
        .map((s) => s.index)
    : [];
  const ownsFullGroup = hasPartnershipForGroup || (
    groupMemberIndices.length > 0 &&
    groupMemberIndices.every((gi) => {
      const gp = properties?.find((p) => p.spaceIndex === gi);
      return gp != null && gp.ownerId === myId && !gp.isMortgaged;
    })
  );

  // ── canManage: I can interact with build/sell buttons if I own it OR I am a
  // partner in an active partnership for this group.
  // Mortgage apply/lift remain owner-only (mine).
  const canManage = mine || hasPartnershipForGroup;

  const canMortgage = mine && !prop.isMortgaged && prop.houses === 0 && !prop.hasHotel;
  const canLift = mine && prop.isMortgaged;
  const canBuyHouse = canManage && isMyTurn && canBuild && ownsFullGroup && !prop.isMortgaged && !prop.hasHotel && prop.houses < 4 && (me?.money ?? 0) >= houseCost;
  const canBuyHotel = canManage && isMyTurn && canBuild && ownsFullGroup && !prop.isMortgaged && prop.houses === 4 && !prop.hasHotel && (me?.money ?? 0) >= houseCost;
  const canSellHouse = canManage && isMyTurn && canBuild && prop.houses > 0 && !prop.hasHotel;
  const canSellHotel = canManage && isMyTurn && canBuild && prop.hasHotel;

  const inner = (
    <>
      <div style={hdr}>
        <span style={{ ...strip, background: accent }} />
        <span style={{ flex: 1, fontWeight: 800, fontSize: 18 }}>{space.name}</span>
        <button onClick={() => selectProperty(null)} aria-label="Close" style={x}><X size={18} aria-hidden /></button>
      </div>
      <div style={meta}>
        {prop.hasHotel ? 'Hotel' : `${prop.houses} house${prop.houses === 1 ? '' : 's'}`}
        {prop.isMortgaged && ' · Mortgaged'}
        {houseCost > 0 && ` · House ${formatMoney(houseCost)}`}
      </div>
      {!canManage && <div style={{ color: '#8888a0', fontSize: 13 }}>You do not own this property.</div>}
      {mine && (
        <div style={grid}>
          <button style={btn} disabled={!canMortgage} onClick={() => emit(EVENTS.MORTGAGE_APPLY)}>Mortgage</button>
          <button style={btn} disabled={!canLift} onClick={() => emit(EVENTS.MORTGAGE_LIFT)}>Unmortgage</button>
        </div>
      )}
      {canManage && canBuild && (
        <div style={grid}>
          <button style={btn} disabled={!canBuyHouse} onClick={() => emit(EVENTS.BUILD_BUY_HOUSE)}>Buy House</button>
          <button style={btn} disabled={!canSellHouse} onClick={() => emit(EVENTS.BUILD_SELL_HOUSE)}>Sell House</button>
          <button style={btn} disabled={!canBuyHotel} onClick={() => emit(EVENTS.BUILD_BUY_HOTEL)}>Buy Hotel</button>
          <button style={btn} disabled={!canSellHotel} onClick={() => emit(EVENTS.BUILD_SELL_HOTEL)}>Sell Hotel</button>
        </div>
      )}
    </>
  );

  if (isMobile) {
    return (
      <div style={wrapMobile}>
        <div style={sheetMobile}>{inner}</div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={card}>{inner}</div>
    </div>
  );
}

// ── Desktop styles (unchanged) ──
const wrap: React.CSSProperties = { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: FONT_FAMILY };
const card: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: 16, padding: 20, width: 340, boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)' };
const hdr: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 };
const strip: React.CSSProperties = { width: 14, height: 14, borderRadius: 4 };
const x: React.CSSProperties = { background: 'none', border: 'none', color: '#8888a0', cursor: 'pointer', lineHeight: 1, display: 'inline-flex', alignItems: 'center', padding: 0 };
const meta: React.CSSProperties = { color: '#8888a0', fontSize: 13, marginBottom: 16 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const btn: React.CSSProperties = { fontFamily: 'inherit', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 12, padding: '11px 12px', cursor: 'pointer', background: '#2a2a40', color: '#e8e8f0' };

// ── Mobile bottom-sheet styles ──
const wrapMobile: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: FONT_FAMILY, display: 'flex', alignItems: 'flex-end' };
const sheetMobile: React.CSSProperties = {
  background: '#12121e', color: '#e8e8f0',
  borderRadius: '20px 20px 0 0', padding: 20,
  width: '100vw', maxHeight: '85vh', overflowY: 'auto',
  boxShadow: '0 -8px 40px -8px rgba(0,0,0,.7)',
  paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
};
