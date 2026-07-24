import React from 'react';
import { useGameStore, selectMyPlayer, selectIsMyTurn, selectCurrentPlayer } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { formatMoney } from '../utils/format';
import { useIsMobile } from './useIsMobile';
import { FONT_FAMILY } from '../constants/fonts';

export function TurnHud() {
  const me = useGameStore(selectMyPlayer);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const current = useGameStore(selectCurrentPlayer);
  const turn = useGameStore((s) => s.state?.turn);
  const freeParkingPool = useGameStore((s) => s.state?.freeParkingPool ?? 0);
  const isMobile = useIsMobile();

  if (!turn) return null;

  const isJailed = me?.isJailed ?? false;
  const jailCardCount = me?.jailCardCount ?? 0;

  const canRoll = isMyTurn && turn.phase === 'waiting' && !turn.hasRolled;
  const canEnd = isMyTurn && (turn.phase === 'action' || turn.phase === 'end');
  const showJailActions = isMyTurn && isJailed && turn.phase === 'waiting';

  // Server handles jailed-roll logic internally inside the TURN_ROLL_DICE handler.
  const roll = () => socketManager.emit(EVENTS.TURN_ROLL_DICE);
  const end = () => socketManager.emit(EVENTS.TURN_END);
  const payFine = () => socketManager.emit(EVENTS.JAIL_PAY_FINE);
  const useCard = () => socketManager.emit(EVENTS.JAIL_USE_CARD);

  if (isMobile) {
    return (
      <>
        <div style={topBarMobile}>
          <span style={{ fontWeight: 800, color: isMyTurn ? '#d4af37' : '#e8e8f0' }}>
            {isMyTurn ? 'Your turn' : `${current?.name ?? '…'}'s turn`}
          </span>
          {freeParkingPool > 0 && (
            <span style={fpPill}>
              FP: {formatMoney(freeParkingPool)}
            </span>
          )}
          <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {me ? formatMoney(me.money) : ''}
          </span>
        </div>
        {/* Mobile action buttons are rendered inside the bottom bar — see hotbarMobile */}
        <div style={hotbarMobile}>
          {showJailActions && (
            <button onClick={payFine} style={{ ...btnMobile, ...primary }}>
              Pay Fine (£500K)
            </button>
          )}
          {showJailActions && (
            <button onClick={useCard} disabled={jailCardCount === 0} style={{ ...btnMobile, ...(jailCardCount > 0 ? primary : disabledStyle) }}>
              Use Card
            </button>
          )}
          <button onClick={roll} disabled={!canRoll} style={{ ...btnMobile, ...(canRoll ? primary : disabledStyle) }}>
            Roll
          </button>
          <button onClick={end} disabled={!canEnd} style={{ ...btnMobile, ...(canEnd ? primary : disabledStyle) }}>
            End Turn
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={topBar}>
        <span style={{ fontWeight: 800, color: isMyTurn ? '#d4af37' : '#e8e8f0' }}>
          {isMyTurn ? 'Your turn' : `${current?.name ?? '…'}'s turn`}
        </span>
        {freeParkingPool > 0 && (
          <span style={fpPill}>
            FP: {formatMoney(freeParkingPool)}
          </span>
        )}
        <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {me ? formatMoney(me.money) : ''}
        </span>
      </div>
      <div style={hotbar}>
        {showJailActions && (
          <button onClick={payFine} style={{ ...btn, ...primary }}>
            Pay Fine (£500K)
          </button>
        )}
        {showJailActions && (
          <button onClick={useCard} disabled={jailCardCount === 0} style={{ ...btn, ...(jailCardCount > 0 ? primary : disabledStyle) }}>
            Use Card
          </button>
        )}
        <button onClick={roll} disabled={!canRoll} style={{ ...btn, ...(canRoll ? primary : disabledStyle) }}>
          Roll
        </button>
        <button onClick={end} disabled={!canEnd} style={{ ...btn, ...(canEnd ? primary : disabledStyle) }}>
          End Turn
        </button>
      </div>
    </>
  );
}

const FONT = FONT_FAMILY;

// ── Desktop styles (unchanged) ──
const topBar: React.CSSProperties = {
  position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', gap: 20, alignItems: 'center', fontFamily: FONT,
  background: '#12121e', color: '#e8e8f0', padding: '8px 18px', borderRadius: 999, zIndex: 30,
};
const hotbar: React.CSSProperties = {
  position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', gap: 10, fontFamily: FONT, zIndex: 30,
};
const btn: React.CSSProperties = {
  fontFamily: FONT, fontWeight: 800, fontSize: 15, border: 'none',
  borderRadius: 14, padding: '12px 22px', cursor: 'pointer',
};

// ── Mobile styles ──
const topBarMobile: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0,
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontFamily: FONT, background: '#12121e', color: '#e8e8f0',
  padding: '8px 16px',
  paddingTop: 'calc(8px + env(safe-area-inset-top))',
  zIndex: 30,
};
const hotbarMobile: React.CSSProperties = {
  position: 'fixed', bottom: 0, left: 0, right: 0,
  display: 'flex', gap: 10, fontFamily: FONT, zIndex: 30,
  background: '#12121e',
  padding: '10px 16px',
  paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
};
const btnMobile: React.CSSProperties = {
  fontFamily: FONT, fontWeight: 800, fontSize: 16, border: 'none',
  borderRadius: 14, padding: '14px 0', cursor: 'pointer', flex: 1,
  minHeight: 44,
};

// ── Free Parking pill ──
const fpPill: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, background: '#1a3020', color: '#46b16a',
  border: '1px solid #46b16a', borderRadius: 999, padding: '2px 8px',
  fontVariantNumeric: 'tabular-nums',
};

// ── Shared state styles ──
const primary: React.CSSProperties = { background: '#e07d0a', color: '#fff' };
const disabledStyle: React.CSSProperties = { background: '#2a2a42', color: '#6a6a86', cursor: 'default' };
