import { useGameStore } from '../state/gameStore';
import { TOKEN_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';
import { useIsMobile } from './useIsMobile';
import type { Player, TokenType } from '../types/GameState';
import { FONT_FAMILY } from '../constants/fonts';

export function PlayerPods() {
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const currentId = useGameStore((s) => s.state?.turn.currentPlayerId);
  const myId = useGameStore((s) => s.myPlayerId);
  const isMobile = useIsMobile();

  if (!players.length) return null;

  if (isMobile) {
    // Slim horizontal strip pinned just below the top status bar (which is ~36px tall).
    return (
      <div style={wrapMobile}>
        {players.map((p) => (
          <div key={p.id} style={{ ...podMobile, outline: p.id === currentId ? '2px solid #d4af37' : 'none', opacity: p.isBankrupt ? 0.5 : 1 }}>
            <span style={{ ...dotMobile, background: TOKEN_HEX[p.token as TokenType] }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.name}{p.id === myId && <span style={{ color: '#8888a0' }}> (you)</span>}
              </div>
              <div style={{ fontWeight: 800, fontSize: 10, fontVariantNumeric: 'tabular-nums', color: p.money < 0 ? '#e5533d' : '#46b16a' }}>
                {formatMoney(p.money)}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={wrap}>
      {players.map((p) => {
        const badges = [
          p.isHost ? 'HOST' : null,
          p.isJailed ? 'JAIL' : null,
          p.isBankrupt ? 'BANKRUPT' : null,
          !p.isConnected ? 'OFFLINE' : null,
        ].filter(Boolean).join(' · ');
        return (
          <div key={p.id} style={{ ...pod, outline: p.id === currentId ? '2px solid #d4af37' : 'none', opacity: p.isBankrupt ? 0.5 : 1 }}>
            <span style={{ ...dot, background: TOKEN_HEX[p.token as TokenType] }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>
                {p.name}{p.id === myId && <span style={{ color: '#8888a0' }}> (you)</span>}
              </div>
              {badges && <div style={{ fontSize: 10, color: '#8888a0', fontWeight: 700 }}>{badges}</div>}
            </div>
            <span style={{ fontWeight: 800, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: p.money < 0 ? '#e5533d' : '#46b16a' }}>
              {formatMoney(p.money)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Desktop styles (unchanged) ──
const wrap: React.CSSProperties = {
  position: 'fixed', top: 14, right: 14, display: 'flex', flexDirection: 'column', gap: 8,
  fontFamily: FONT_FAMILY, zIndex: 30, width: 200,
};
const pod: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, background: '#12121e', color: '#e8e8f0',
  borderRadius: 12, padding: '8px 11px', boxShadow: '0 8px 22px -12px rgba(0,0,0,.6)',
};
const dot: React.CSSProperties = { width: 20, height: 20, borderRadius: '50%', flex: 'none' };

// ── Mobile styles: slim top strip ──
const wrapMobile: React.CSSProperties = {
  position: 'fixed',
  // Sit below TurnHud topBarMobile (~36px) + safe-area-inset-top (notch).
  top: 'calc(36px + env(safe-area-inset-top))',
  left: 0,
  right: 0,
  display: 'flex',
  flexDirection: 'row',
  gap: 6,
  padding: '4px 8px',
  fontFamily: FONT_FAMILY,
  zIndex: 29,
  overflowX: 'auto',
};
const podMobile: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, background: '#12121e', color: '#e8e8f0',
  borderRadius: 10, padding: '5px 8px', boxShadow: '0 4px 12px -6px rgba(0,0,0,.6)',
  flex: '1 1 0', minWidth: 70, maxWidth: 130,
};
const dotMobile: React.CSSProperties = { width: 12, height: 12, borderRadius: '50%', flex: 'none' };
