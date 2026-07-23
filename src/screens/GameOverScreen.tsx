import { useGameStore } from '../state/gameStore';
import { TOKEN_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';
import type { Player, TokenType } from '../types/GameState';
import { FONT_FAMILY } from '../constants/fonts';
import { useIsMobile } from '../ui/useIsMobile';

export function GameOverScreen() {
  const gameOver = useGameStore((s) => s.gameOver);
  const myId = useGameStore((s) => s.myPlayerId);
  const reset = useGameStore((s) => s.reset);
  const isMobile = useIsMobile();
  if (!gameOver) return null;

  const winner = gameOver.finalStandings.find((p) => p.id === gameOver.winnerId);
  const standings = [...gameOver.finalStandings].sort((a, b) =>
    a.isBankrupt !== b.isBankrupt ? (a.isBankrupt ? 1 : -1) : b.money - a.money,
  );

  if (isMobile) {
    return (
      <div style={wrapMobile}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>
          {winner ? (winner.id === myId ? 'You Win!' : `${winner.name} Wins!`) : 'Game Over'}
        </h1>
        <div style={cardMobile}>
          {standings.map((p: Player, i) => (
            <div key={p.id} data-testid="standing" style={{ ...row, opacity: p.isBankrupt ? 0.5 : 1 }}>
              <span style={{ width: 22, color: '#8888a0', fontWeight: 800 }}>{i + 1}</span>
              <span style={{ ...dot, background: TOKEN_HEX[p.token as TokenType] }} />
              <span style={{ flex: 1, fontWeight: 800, fontSize: 15 }}>{p.name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: p.isBankrupt ? '#e5533d' : '#e8e8f0', fontSize: 14 }}>
                {p.isBankrupt ? 'Bankrupt' : formatMoney(p.money)}
              </span>
            </div>
          ))}
        </div>
        <button onClick={reset} style={btnMobile}>Back to Menu</button>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <h1 style={{ margin: 0, fontSize: 40, fontWeight: 800 }}>
        {winner ? (winner.id === myId ? 'You Win!' : `${winner.name} Wins!`) : 'Game Over'}
      </h1>
      <div style={card}>
        {standings.map((p: Player, i) => (
          <div key={p.id} data-testid="standing" style={{ ...row, opacity: p.isBankrupt ? 0.5 : 1 }}>
            <span style={{ width: 22, color: '#8888a0', fontWeight: 800 }}>{i + 1}</span>
            <span style={{ ...dot, background: TOKEN_HEX[p.token as TokenType] }} />
            <span style={{ flex: 1, fontWeight: 800 }}>{p.name}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: p.isBankrupt ? '#e5533d' : '#e8e8f0' }}>
              {p.isBankrupt ? 'Bankrupt' : formatMoney(p.money)}
            </span>
          </div>
        ))}
      </div>
      <button onClick={reset} style={btn}>Back to Menu</button>
    </div>
  );
}

// ── Desktop styles (unchanged) ──
const wrap: React.CSSProperties = {
  position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', gap: 22,
  alignItems: 'center', justifyContent: 'center', background: '#08080f', color: '#e8e8f0',
  fontFamily: FONT_FAMILY, zIndex: 60,
};
const card: React.CSSProperties = { background: '#12121e', borderRadius: 16, padding: 20, width: 340, display: 'flex', flexDirection: 'column', gap: 6 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' };
const dot: React.CSSProperties = { width: 18, height: 18, borderRadius: '50%', flexShrink: 0 };
const btn: React.CSSProperties = { fontFamily: 'inherit', fontWeight: 800, fontSize: 15, color: '#08080f', background: '#d4af37', border: 'none', borderRadius: 14, padding: '12px 26px', cursor: 'pointer' };

// ── Mobile styles ──
const wrapMobile: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  alignItems: 'center',
  justifyContent: 'center',
  background: '#08080f',
  color: '#e8e8f0',
  fontFamily: FONT_FAMILY,
  zIndex: 60,
  padding: '20px 16px',
  paddingTop: 'calc(20px + env(safe-area-inset-top))',
  paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
  boxSizing: 'border-box',
  overflowY: 'auto',
};
const cardMobile: React.CSSProperties = {
  background: '#12121e',
  borderRadius: 16,
  padding: 18,
  width: 'min(92vw, 400px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const btnMobile: React.CSSProperties = {
  fontFamily: 'inherit',
  fontWeight: 800,
  fontSize: 16,
  color: '#08080f',
  background: '#d4af37',
  border: 'none',
  borderRadius: 14,
  padding: '14px 32px',
  cursor: 'pointer',
  minHeight: 50,
  touchAction: 'manipulation',
};
