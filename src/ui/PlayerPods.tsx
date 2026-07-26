import { useGameStore } from '../state/gameStore';
import { TOKEN_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';
import { useIsMobile } from './useIsMobile';
import type { Player } from '../types/GameState';
import { FONT_FAMILY } from '../constants/fonts';

/** 1–2 char avatar initials from a player name (word initials, else first chars). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] ?? '';
  return (w.slice(0, 2) || '?').toUpperCase();
}

export function PlayerPods() {
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const currentId = useGameStore((s) => s.state?.turn.currentPlayerId);
  const myId = useGameStore((s) => s.myPlayerId);
  const isMobile = useIsMobile();

  if (!players.length) return null;

  if (isMobile) {
    // Compact avatar chips (initials) in the top-left safe area. The current
    // player's chip is ringed gold; bankrupt chips dim. Names/money live in the
    // top-center chip (me) — the board stays uncluttered.
    return (
      <div style={wrapMobile}>
        {players.map((p) => {
          const isCurrent = p.id === currentId;
          return (
            <div
              key={p.id}
              title={`${p.name}${p.id === myId ? ' (you)' : ''} · ${formatMoney(p.money)}`}
              style={{
                ...avatarMobile,
                background: TOKEN_HEX[p.token],
                outline: isCurrent ? '2px solid #f0d060' : '2px solid rgba(0,0,0,0.35)',
                boxShadow: isCurrent ? '0 0 10px rgba(240,208,96,0.7)' : '0 2px 6px rgba(0,0,0,0.5)',
                opacity: p.isBankrupt ? 0.4 : 1,
              }}
            >
              {initials(p.name)}
            </div>
          );
        })}
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
            <span style={{ ...dot, background: TOKEN_HEX[p.token] }} />
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

// ── Mobile styles: top-left avatar chips ──
const wrapMobile: React.CSSProperties = {
  position: 'fixed',
  top: 'calc(8px + env(safe-area-inset-top))',
  left: 'calc(8px + env(safe-area-inset-left))',
  display: 'flex',
  flexDirection: 'row',
  gap: 7,
  fontFamily: FONT_FAMILY,
  zIndex: 30,
};
const avatarMobile: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#fff', fontWeight: 800, fontSize: 13, letterSpacing: '0.02em',
  textShadow: '0 1px 2px rgba(0,0,0,0.55)',
  flex: 'none', boxSizing: 'border-box',
};
