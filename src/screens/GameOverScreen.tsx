import { useGameStore } from '../state/gameStore';
import { TOKEN_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';
import type { Player } from '../types/GameState';
import { FONT_FAMILY } from '../constants/fonts';
import { useIsMobile } from '../ui/useIsMobile';
import { GameButton } from '../ui/GameButton';

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
        <div style={inner}>
          <h1 style={titleMobile}>
            {winner ? (winner.id === myId ? 'You Win!' : `${winner.name} Wins!`) : 'Game Over'}
          </h1>
          <div style={cardMobile}>
            {standings.map((p: Player, i) => (
              <div key={p.id} data-testid="standing" style={{ ...row, opacity: p.isBankrupt ? 0.5 : 1 }}>
                <span style={{ width: 22, color: '#8888a0', fontWeight: 800 }}>{i + 1}</span>
                <span style={{ ...dot, background: TOKEN_HEX[p.token] }} />
                <span style={{ flex: 1, fontWeight: 800, fontSize: 15 }}>{p.name}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: p.isBankrupt ? '#e5533d' : '#e8e8f0', fontSize: 14 }}>
                  {p.isBankrupt ? 'Bankrupt' : formatMoney(p.money)}
                </span>
              </div>
            ))}
          </div>
          <GameButton variant="primary" onClick={reset}>Back to Menu</GameButton>
        </div>
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
            <span style={{ ...dot, background: TOKEN_HEX[p.token] }} />
            <span style={{ flex: 1, fontWeight: 800 }}>{p.name}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: p.isBankrupt ? '#e5533d' : '#e8e8f0' }}>
              {p.isBankrupt ? 'Bankrupt' : formatMoney(p.money)}
            </span>
          </div>
        ))}
      </div>
      <GameButton variant="primary" onClick={reset}>Back to Menu</GameButton>
    </div>
  );
}

// ── Desktop styles (restored from `main`) — fixed full-screen flex COLUMN,
// centered both axes, no scroll; the standings card sits dead-center. ──
const wrap: React.CSSProperties = {
  position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', gap: 22,
  alignItems: 'center', justifyContent: 'center', background: '#08080f', color: '#e8e8f0',
  fontFamily: FONT_FAMILY, zIndex: 60,
};
const card: React.CSSProperties = { background: '#12121e', borderRadius: 16, padding: 20, width: 340, display: 'flex', flexDirection: 'column', gap: 6 };

// ── Mobile styles (current responsive layout) — center-or-scroll wrapper; the
// `inner` group's `margin:auto` centers the block when it fits and scrolls
// (top reachable) on short/landscape viewports. ──
const wrapBase: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  background: '#08080f',
  color: '#e8e8f0',
  fontFamily: FONT_FAMILY,
  zIndex: 60,
  boxSizing: 'border-box',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  padding:
    'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
};
const wrapMobile: React.CSSProperties = { ...wrapBase };

const inner: React.CSSProperties = {
  margin: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(14px, 3.5vw, 22px)',
  alignItems: 'center',
  width: '100%',
};

const titleMobile: React.CSSProperties = { margin: 0, fontSize: 'clamp(24px, 7vw, 30px)', fontWeight: 800, textAlign: 'center' };

const cardBase: React.CSSProperties = {
  background: '#12121e',
  borderRadius: 16,
  width: 'min(92vw, 400px)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const cardMobile: React.CSSProperties = { ...cardBase, padding: 'clamp(14px, 4vw, 18px)' };

// ── Shared row styles ──
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' };
const dot: React.CSSProperties = { width: 18, height: 18, borderRadius: '50%', flexShrink: 0 };
