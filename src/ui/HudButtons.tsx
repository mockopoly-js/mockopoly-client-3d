import type React from 'react';
import { useGameStore } from '../state/gameStore';
import { useIsMobile } from './useIsMobile';
import { FONT_FAMILY } from '../constants/fonts';

export function HudButtons() {
  const trade = useGameStore((s) => s.toggleTradePanel);
  const partnership = useGameStore((s) => s.togglePartnershipPanel);
  const deal = useGameStore((s) => s.toggleDealPanel);
  const isMobile = useIsMobile();

  if (isMobile) {
    // On mobile: row of buttons in the bottom action bar (above the safe area),
    // offset above TurnHud's hotbarMobile which sits at the very bottom.
    return (
      <div style={wrapMobile}>
        <button style={btnMobile} onClick={() => trade(true)}>Trade</button>
        <button style={btnMobile} onClick={() => partnership(true)}>Partnership</button>
        <button style={btnMobile} onClick={() => deal(true)}>Deal</button>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <button style={btn} onClick={() => trade(true)}>Trade</button>
      <button style={btn} onClick={() => partnership(true)}>Partnership</button>
      <button style={btn} onClick={() => deal(true)}>Deal</button>
    </div>
  );
}

const F = FONT_FAMILY;

// ── Desktop styles (unchanged) ──
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
const btn: React.CSSProperties = {
  fontFamily: F,
  fontWeight: 800,
  fontSize: 13,
  border: 'none',
  borderRadius: 12,
  padding: '9px 14px',
  cursor: 'pointer',
  background: '#12121e',
  color: '#e8e8f0',
  boxShadow: '0 8px 22px -12px rgba(0,0,0,.6)',
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
};
const btnMobile: React.CSSProperties = {
  fontFamily: F,
  fontWeight: 800,
  fontSize: 13,
  border: 'none',
  borderRadius: 12,
  padding: '10px 0',
  cursor: 'pointer',
  background: '#12121e',
  color: '#e8e8f0',
  boxShadow: '0 8px 22px -12px rgba(0,0,0,.6)',
  flex: 1,
  minHeight: 44,
};
