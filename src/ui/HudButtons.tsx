import type React from 'react';
import { useGameStore } from '../state/gameStore';

export function HudButtons() {
  const trade = useGameStore((s) => s.toggleTradePanel);
  const partnership = useGameStore((s) => s.togglePartnershipPanel);
  const deal = useGameStore((s) => s.toggleDealPanel);
  return (
    <div style={wrap}>
      <button style={btn} onClick={() => trade(true)}>Trade</button>
      <button style={btn} onClick={() => partnership(true)}>Partnership</button>
      <button style={btn} onClick={() => deal(true)}>Deal</button>
    </div>
  );
}

const F = 'ui-rounded, system-ui, sans-serif';
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
