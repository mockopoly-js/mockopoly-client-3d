import type React from 'react';
import { useGameStore } from '../state/gameStore';
import { FONT_FAMILY } from '../constants/fonts';
import { GameButton } from './GameButton';
import { useActionBadges } from './useActionBadges';

interface ActionsSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Mobile-only: a small right-docked sheet holding the three secondary actions
 * (Trade / Partnership / Deal) that used to crowd the board on a full-width bar.
 * Opened by the ⋯ button in TurnHud's bottom-right cluster. Each button calls
 * the SAME existing store panel-open handlers the desktop HudButtons uses, then
 * closes the sheet so the full-screen panel (z:40) takes over. A transparent
 * scrim (z:35) sits behind the sheet (z:36) to catch outside taps to dismiss —
 * both below the panel modals so nothing here can cover an open negotiation.
 */
export function ActionsSheet({ open, onClose }: ActionsSheetProps) {
  const trade = useGameStore((s) => s.toggleTradePanel);
  const partnership = useGameStore((s) => s.togglePartnershipPanel);
  const deal = useGameStore((s) => s.toggleDealPanel);
  const badges = useActionBadges();

  if (!open) return null;

  const pick = (openPanel: (show?: boolean) => void) => () => {
    openPanel(true);
    onClose();
  };

  return (
    <>
      <div style={scrim} onClick={onClose} aria-hidden="true" />
      <div style={sheet} role="menu" aria-label="More actions">
        <div style={btnWrap}>
          <GameButton variant="dark" onClick={pick(trade)} style={sheetBtn}>Trade</GameButton>
          {badges.trade && <span style={dot} aria-hidden="true" />}
        </div>
        <div style={btnWrap}>
          <GameButton variant="dark" onClick={pick(partnership)} style={sheetBtn}>Partnership</GameButton>
          {badges.partnership && <span style={dot} aria-hidden="true" />}
        </div>
        <div style={btnWrap}>
          <GameButton variant="dark" onClick={pick(deal)} style={sheetBtn}>Deal</GameButton>
          {badges.deal && <span style={dot} aria-hidden="true" />}
        </div>
      </div>
    </>
  );
}

// Transparent full-screen tap-catcher — dismisses the sheet on any outside tap.
const scrim: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 35, background: 'transparent',
};

const sheet: React.CSSProperties = {
  position: 'fixed',
  // Docked bottom-right, floating just above the action cluster and clear of the
  // home indicator / side notch.
  bottom: 'calc(74px + env(safe-area-inset-bottom))',
  right: 'calc(12px + env(safe-area-inset-right))',
  zIndex: 36,
  display: 'flex', flexDirection: 'column', gap: 8,
  background: 'rgba(18,18,30,0.96)',
  border: '1px solid #2a2a40',
  borderRadius: 14,
  padding: 10,
  minWidth: 150,
  fontFamily: FONT_FAMILY,
  boxShadow: '0 14px 40px -8px rgba(0,0,0,0.7)',
};

const btnWrap: React.CSSProperties = { position: 'relative', display: 'flex' };
const sheetBtn: React.CSSProperties = {
  flex: 1, minHeight: 44, fontSize: 14, padding: '10px 14px', borderRadius: 12,
};
const dot: React.CSSProperties = {
  position: 'absolute', top: 4, right: 4,
  width: 8, height: 8, borderRadius: '50%',
  background: '#e5533d', pointerEvents: 'none',
};
