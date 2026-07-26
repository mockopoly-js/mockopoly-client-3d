import React, { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useGameStore, selectMyPlayer, selectIsMyTurn, selectCurrentPlayer } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { formatMoney } from '../utils/format';
import { useIsMobile } from './useIsMobile';
import { FONT_FAMILY } from '../constants/fonts';
import { GameButton } from './GameButton';
import { ActionsSheet } from './ActionsSheet';
import { useActionBadges } from './useActionBadges';

export function TurnHud() {
  const me = useGameStore(selectMyPlayer);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const current = useGameStore(selectCurrentPlayer);
  const turn = useGameStore((s) => s.state?.turn);
  const freeParkingPool = useGameStore((s) => s.state?.freeParkingPool ?? 0);
  const isMobile = useIsMobile();
  const actionBadges = useActionBadges();
  const [sheetOpen, setSheetOpen] = useState(false);

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
    // Landscape mobile HUD: a compact top-center turn/money chip cluster and a
    // right-thumb action cluster [⋯][End turn][ROLL] anchored bottom-right inside
    // the safe area. Secondary actions (Trade/Partnership/Deal) live behind ⋯.
    return (
      <>
        <div style={topCenterMobile}>
          <span style={{ ...turnChip, color: isMyTurn ? '#f0d060' : '#e8e8f0' }}>
            🎲 {isMyTurn ? 'Your turn' : (current?.name ?? '…')}
          </span>
          {freeParkingPool > 0 && (
            <span style={fpPill}>FP {formatMoney(freeParkingPool)}</span>
          )}
          <span style={moneyChip}>{me ? formatMoney(me.money) : ''}</span>
        </div>

        <div style={clusterMobile}>
          <button
            type="button"
            style={moreBtn}
            onClick={() => setSheetOpen((o) => !o)}
            aria-label="More actions"
            aria-expanded={sheetOpen}
          >
            <MoreHorizontal size={22} aria-hidden />
            {actionBadges.any && <span style={moreDot} aria-hidden="true" />}
          </button>
          {showJailActions && (
            <GameButton variant="dark" onClick={payFine} style={jailBtnMobile}>
              Pay Fine (£500K)
            </GameButton>
          )}
          {showJailActions && (
            <GameButton variant="dark" onClick={useCard} disabled={jailCardCount === 0} style={jailBtnMobile}>
              Use Card
            </GameButton>
          )}
          <GameButton variant="dark" onClick={end} disabled={!canEnd} style={endBtnMobile}>
            End Turn
          </GameButton>
          <GameButton variant="primary" onClick={roll} disabled={!canRoll} style={rollBtnMobile}>
            Roll
          </GameButton>
        </div>

        <ActionsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
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
          <GameButton variant="dark" onClick={payFine}>
            Pay Fine (£500K)
          </GameButton>
        )}
        {showJailActions && (
          <GameButton variant="dark" onClick={useCard} disabled={jailCardCount === 0}>
            Use Card
          </GameButton>
        )}
        <GameButton variant="secondary" onClick={roll} disabled={!canRoll}>
          Roll
        </GameButton>
        <GameButton variant="dark" onClick={end} disabled={!canEnd}>
          End Turn
        </GameButton>
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

// ── Mobile styles ──
// Top-center: compact dark-glass turn + money chips. Centered, clears the notch.
const topCenterMobile: React.CSSProperties = {
  position: 'fixed',
  top: 'calc(8px + env(safe-area-inset-top))',
  left: '50%', transform: 'translateX(-50%)',
  display: 'flex', gap: 6, alignItems: 'center',
  fontFamily: FONT, zIndex: 30, pointerEvents: 'none',
  maxWidth: 'calc(100vw - 220px)',
};
const chipBase: React.CSSProperties = {
  fontWeight: 800, fontSize: 12, lineHeight: 1,
  background: 'rgba(18,18,30,0.82)', color: '#e8e8f0',
  border: '1px solid #2a2a40', borderRadius: 999,
  padding: '6px 11px', whiteSpace: 'nowrap',
};
const turnChip: React.CSSProperties = { ...chipBase };
const moneyChip: React.CSSProperties = {
  ...chipBase, fontVariantNumeric: 'tabular-nums', color: '#46b16a',
};

// Bottom-right action cluster: right-thumb reach, inside the safe area, above
// the home indicator. [⋯][End turn][ROLL] — ROLL is the gold primary.
const clusterMobile: React.CSSProperties = {
  position: 'fixed',
  bottom: 'calc(12px + env(safe-area-inset-bottom))',
  right: 'calc(12px + env(safe-area-inset-right))',
  display: 'flex', alignItems: 'center', gap: 8,
  fontFamily: FONT, zIndex: 30,
};
// Round dark ⋯ button — opens the actions sheet.
const moreBtn: React.CSSProperties = {
  position: 'relative',
  width: 46, height: 46, borderRadius: 999,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'linear-gradient(180deg, #2a2a42 0%, #12121e 100%)',
  color: '#e8e8f0', border: '2px solid #3a3a58',
  boxShadow: '0 4px 0 rgba(0,0,0,0.5), 0 6px 14px rgba(0,0,0,0.4)',
  cursor: 'pointer', touchAction: 'manipulation', flex: 'none',
};
const moreDot: React.CSSProperties = {
  position: 'absolute', top: 6, right: 6,
  width: 9, height: 9, borderRadius: '50%',
  background: '#e5533d', border: '1.5px solid #12121e', pointerEvents: 'none',
};
// Shared: flex-center the label so it stays centered when minHeight > content
// and vertical padding is 0.
const clusterBtnBase: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
// ROLL — gold primary, moderate size (NOT full-width).
const rollBtnMobile: React.CSSProperties = {
  ...clusterBtnBase, minHeight: 52, padding: '0 28px', fontSize: 18, borderRadius: 14,
};
// End turn — dark secondary, smaller.
const endBtnMobile: React.CSSProperties = {
  ...clusterBtnBase, minHeight: 44, padding: '0 16px', fontSize: 13, borderRadius: 12,
};
// Jail actions (only shown while jailed & waiting) — compact dark chips.
const jailBtnMobile: React.CSSProperties = {
  ...clusterBtnBase, minHeight: 44, padding: '0 12px', fontSize: 12, borderRadius: 12,
};

// ── Free Parking pill ──
const fpPill: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, background: '#1a3020', color: '#46b16a',
  border: '1px solid #46b16a', borderRadius: 999, padding: '2px 8px',
  fontVariantNumeric: 'tabular-nums',
};
