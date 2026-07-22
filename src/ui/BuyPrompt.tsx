import React from 'react';
import { useGameStore, selectMyPlayer, selectIsMyTurn } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import { COLOR_GROUP_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';

const BUYABLE = ['property', 'railroad', 'utility'];

export function BuyPrompt() {
  const me = useGameStore(selectMyPlayer);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const phase = useGameStore((s) => s.state?.turn.phase);
  const properties = useGameStore((s) => s.state?.properties);

  if (!me || !isMyTurn || phase !== 'action') return null;

  const space = BOARD_SPACES[me.position];
  if (!space || !BUYABLE.includes(space.type)) return null;
  const owned = properties?.find((p) => p.spaceIndex === space.index);
  if (owned?.ownerId != null) return null;   // show unless a real owner exists (dense array today; robust if ever sparse)
  const price = space.price ?? 0;
  if (price <= 0) return null;

  const canAfford = me.money >= price;
  const accent = space.colorGroup ? COLOR_GROUP_HEX[space.colorGroup] : '#d4af37';

  const buy = () => socketManager.emit(EVENTS.TURN_BUY_PROPERTY);
  const decline = () => socketManager.emit(EVENTS.TURN_PASS_BUY);

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ height: 10, borderRadius: 6, background: accent, marginBottom: 12 }} />
        <div style={{ fontWeight: 800, fontSize: 20 }}>{space.name}</div>
        <div style={{ color: '#9a8f7c', margin: '4px 0 16px', fontVariantNumeric: 'tabular-nums' }}>
          Price {formatMoney(price)}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={buy} disabled={!canAfford} style={{ ...btn, ...(canAfford ? buyBtn : disabledBtn) }}>Buy</button>
          <button onClick={decline} style={{ ...btn, ...declineBtn }}>Decline</button>
        </div>
        {!canAfford && <div style={{ color: '#e5533d', marginTop: 8, fontSize: 13 }}>Not enough cash</div>}
      </div>
    </div>
  );
}

const FONT = "ui-rounded, system-ui, sans-serif";
const wrap: React.CSSProperties = {
  position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', fontFamily: FONT, zIndex: 40, pointerEvents: 'none',
};
const card: React.CSSProperties = {
  pointerEvents: 'auto', background: '#fbf6ec', color: '#3b3224', borderRadius: 18,
  padding: 22, minWidth: 260, boxShadow: '0 24px 60px -20px rgba(0,0,0,.6)',
};
const btn: React.CSSProperties = { fontFamily: FONT, fontWeight: 800, border: 'none', borderRadius: 14, padding: '12px 20px', cursor: 'pointer', flex: 1 };
const buyBtn: React.CSSProperties = { background: '#46b16a', color: '#fff' };
const declineBtn: React.CSSProperties = { background: '#e7dcbf', color: '#3b3224' };
const disabledBtn: React.CSSProperties = { background: '#d8ccae', color: '#9a8f7c', cursor: 'default' };
