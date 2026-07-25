import type React from 'react';
import { useGameStore, selectIsMyTurn } from '../state/gameStore';
import { useIsMobile } from './useIsMobile';
import { FONT_FAMILY } from '../constants/fonts';
import { GameButton } from './GameButton';

export function HudButtons() {
  const trade = useGameStore((s) => s.toggleTradePanel);
  const partnership = useGameStore((s) => s.togglePartnershipPanel);
  const deal = useGameStore((s) => s.toggleDealPanel);
  const myId = useGameStore((s) => s.myPlayerId);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const activeTrade = useGameStore((s) => s.state?.activeTrade);
  const proposal = useGameStore((s) => s.state?.activePartnershipProposal);
  const activeRentDeal = useGameStore((s) => s.state?.activeRentDeal);
  const mustPayRent = useGameStore((s) => s.state?.turn.mustPayRent ?? false);
  const isMobile = useIsMobile();

  // Badge derivations (all guarded — only show dot if data is present)
  // Trade: I am the recipient of a pending incoming trade
  const tradeBadge = !!(activeTrade && myId && activeTrade.toPlayerId === myId && activeTrade.status === 'pending');
  // Partnership: a proposal targets me (I'm in the equity list but not the initiator)
  const partnershipBadge = !!(proposal && myId &&
    proposal.status === 'pending' &&
    proposal.initiatorId !== myId &&
    proposal.proposedEquity.some((e) => e.playerId === myId) &&
    !proposal.acceptedPlayerIds.includes(myId));
  // Deal: a deal awaits my response OR mustPayRent on my turn
  const dealBadge = !!(
    (mustPayRent && isMyTurn) ||
    (activeRentDeal && myId && activeRentDeal.status === 'pending' &&
      activeRentDeal.lastOfferBy !== myId &&
      (activeRentDeal.creditorIds.includes(myId) || activeRentDeal.debtorId === myId))
  );

  if (isMobile) {
    // On mobile: row of buttons in the bottom action bar (above the safe area),
    // offset above TurnHud's hotbarMobile which sits at the very bottom.
    return (
      <div style={wrapMobile}>
        <div style={btnWrap}>
          <GameButton variant="dark" onClick={() => trade(true)} style={btnMobileOverride}>Trade</GameButton>
          {tradeBadge && <span style={dot} aria-hidden="true" />}
        </div>
        <div style={btnWrap}>
          <GameButton variant="dark" onClick={() => partnership(true)} style={btnMobileOverride}>Partnership</GameButton>
          {partnershipBadge && <span style={dot} aria-hidden="true" />}
        </div>
        <div style={btnWrap}>
          <GameButton variant="dark" onClick={() => deal(true)} style={btnMobileOverride}>Deal</GameButton>
          {dealBadge && <span style={dot} aria-hidden="true" />}
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={btnWrap}>
        <GameButton variant="dark" onClick={() => trade(true)} style={btnDesktopOverride}>Trade</GameButton>
        {tradeBadge && <span style={dot} aria-hidden="true" />}
      </div>
      <div style={btnWrap}>
        <GameButton variant="dark" onClick={() => partnership(true)} style={btnDesktopOverride}>Partnership</GameButton>
        {partnershipBadge && <span style={dot} aria-hidden="true" />}
      </div>
      <div style={btnWrap}>
        <GameButton variant="dark" onClick={() => deal(true)} style={btnDesktopOverride}>Deal</GameButton>
        {dealBadge && <span style={dot} aria-hidden="true" />}
      </div>
    </div>
  );
}

const F = FONT_FAMILY;

// ── Badge wrapper + dot ──
const btnWrap: React.CSSProperties = { position: 'relative', display: 'inline-flex' };
const dot: React.CSSProperties = {
  position: 'absolute', top: 4, right: 4,
  width: 8, height: 8, borderRadius: '50%',
  background: '#e5533d', pointerEvents: 'none',
};

// ── Desktop styles (unchanged layout) ──
const wrap: React.CSSProperties = {
  position: 'fixed',
  bottom: 14,
  left: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  zIndex: 30,
  fontFamily: F,
};

// Desktop GameButton size override — keep the compact sidebar feel
const btnDesktopOverride: React.CSSProperties = {
  fontSize: 13,
  padding: '9px 14px',
  borderRadius: 12,
};

// ── Mobile styles ──
// Sits above the TurnHud bottom bar; uses a second fixed row just above it.
const wrapMobile: React.CSSProperties = {
  position: 'fixed',
  bottom: 'calc(64px + env(safe-area-inset-bottom))',
  left: 0,
  right: 0,
  display: 'flex',
  flexDirection: 'row',
  gap: 8,
  zIndex: 30,
  fontFamily: F,
  padding: '0 12px',
  paddingLeft: 'calc(12px + env(safe-area-inset-left))',
  paddingRight: 'calc(12px + env(safe-area-inset-right))',
};

const btnMobileOverride: React.CSSProperties = {
  flex: 1,
  minHeight: 44,
  fontSize: 13,
  padding: '10px 0',
  borderRadius: 12,
};
