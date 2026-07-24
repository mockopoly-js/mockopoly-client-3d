import { useEffect, useState } from 'react';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore, selectMyPlayer } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import { TOKEN_HEX } from '../constants/theme';
import type { Player, TokenType } from '../types/GameState';
import { FONT_FAMILY } from '../constants/fonts';
import { useIsMobile } from '../ui/useIsMobile';

export function Lobby() {
  const state = useGameStore((s) => s.state);
  const roomCode = useGameStore((s) => s.roomCode);
  const setScreen = useGameStore((s) => s.setScreen);
  const [countdown, setCountdown] = useState<number | null>(null);

  const players: Player[] = state?.players ?? [];
  const myId = useGameStore((s) => s.myPlayerId);
  const me = selectMyPlayer(useGameStore.getState());
  const isHost = !!me?.isHost;
  const status = state?.status;

  // route into the game once the server flips to in-progress
  useEffect(() => {
    if (status === 'in-progress') setScreen('game');
  }, [status, setScreen]);

  // ephemeral countdown ticks
  useEffect(() => {
    const onTick = (d: { seconds: number }) => setCountdown(d.seconds);
    gameBus.on('countdown', onTick);
    return () => { gameBus.off('countdown', onTick); };
  }, []);

  const toggleReady = () => socketManager.emit(EVENTS.ROOM_READY, { isReady: !me?.isReady });
  const start = () => socketManager.emit(EVENTS.ROOM_START);
  const leave = () => { socketManager.emit(EVENTS.ROOM_LEAVE); useGameStore.getState().reset(); };
  const copyCode = () => { if (roomCode) navigator.clipboard?.writeText(roomCode); };

  const locked = status === 'starting';
  const maxPlayers = state?.config?.maxPlayers ?? 4;
  const isMobile = useIsMobile();

  const playerSlots = Array.from({ length: maxPlayers }).map((_, i) => {
    const p = players[i];
    if (!p) return <div key={i} style={isMobile ? emptySlotMobile : emptySlot}>Empty</div>;
    const tags = [p.isHost ? 'HOST' : null, p.id === myId ? 'YOU' : null].filter(Boolean).join(' • ');
    return (
      <div key={i} style={{ ...(isMobile ? slotMobile : slot), opacity: p.isConnected ? 1 : 0.5 }}>
        <span style={{ ...(isMobile ? dotMobile : dot), background: TOKEN_HEX[p.token as TokenType] }} />
        <span style={{ fontWeight: 800, flex: 1, fontSize: isMobile ? 15 : undefined }}>
          {p.name}{tags && <small style={{ color: '#6d6151', fontWeight: 700 }}> {tags}</small>}
        </span>
        {!p.isConnected && <span style={{ color: '#c53a26', fontWeight: 800, fontSize: 11 }}>DISCONNECTED</span>}
        <span style={{ color: p.isReady ? '#2f9153' : '#9a8f7c', fontWeight: 800, fontSize: 12 }}>
          {p.isReady ? 'READY' : 'NOT READY'}
        </span>
      </div>
    );
  });

  if (isMobile) {
    return (
      <div style={wrapMobile}>
        <div style={panelMobile}>
          <button onClick={copyCode} style={codeChipMobile}>Room {roomCode ?? '----'}</button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 400 }}>
            {playerSlots}
          </div>
          {countdown !== null && status === 'starting'
            ? <div style={{ fontWeight: 800, fontSize: 20, color: '#e07d0a' }}>Starting in {countdown}...</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 400 }}>
                <button onClick={toggleReady} disabled={locked} style={{ ...btnMobile, background: me?.isReady ? '#2a8855' : '#2a2a42', color: '#fff' }}>
                  {me?.isReady ? 'Ready ✓' : 'Ready'}
                </button>
                {isHost && (
                  <button onClick={start} disabled={locked || players.length < 2} style={{ ...btnMobile, background: '#e07d0a', color: '#fff' }}>
                    Start Game
                  </button>
                )}
                <button onClick={leave} disabled={locked} style={{ ...btnMobile, background: '#e7dcbf', color: '#3b3224' }}>Back</button>
              </div>
            )}
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={panel}>
        <button onClick={copyCode} style={codeChip}>Room {roomCode ?? '----'}</button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
          {playerSlots}
        </div>

        {countdown !== null && status === 'starting'
          ? <div style={{ fontWeight: 800, fontSize: 20, color: '#e07d0a' }}>Starting in {countdown}...</div>
          : (
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={toggleReady} disabled={locked} style={{ ...btn, background: me?.isReady ? '#2a8855' : '#2a2a42', color: '#fff' }}>
                {me?.isReady ? 'Ready ✓' : 'Ready'}
              </button>
              {isHost && (
                <button onClick={start} disabled={locked || players.length < 2} style={{ ...btn, background: '#e07d0a', color: '#fff' }}>
                  Start Game
                </button>
              )}
              <button onClick={leave} disabled={locked} style={{ ...btn, background: '#e7dcbf', color: '#3b3224' }}>Back</button>
            </div>
          )}
      </div>
    </div>
  );
}

const FONT = FONT_FAMILY;
const GOLD = '#d4af37';
const BG_URL = '/images/lobby-bg.webp';

// ── Backdrop (toy-city diorama; the empty plaza sits dead-center) ──
const backdropBase: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundImage: `url(${BG_URL})`,
  backgroundColor: '#5aa9e6', // sky fallback while the webp loads
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
  fontFamily: FONT,
  color: '#3b3224',
  display: 'flex',
  boxSizing: 'border-box',
};

// ── Desktop: cover + centered so the panel lands in the mid-frame plaza ──
const wrap: React.CSSProperties = {
  ...backdropBase,
  backgroundPosition: 'center center',
  alignItems: 'center',
  justifyContent: 'center',
};

// ── Desktop control panel — floats in the sandy plaza (centered both axes) ──
const panel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  alignItems: 'center',
  width: 'min(420px, 90vw)',
  boxSizing: 'border-box',
  padding: '24px 26px',
  borderRadius: 24,
  background: 'rgba(255, 251, 240, 0.9)',
  border: `3px solid ${GOLD}`,
  boxShadow: '0 18px 48px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.6)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
};

const codeChip: React.CSSProperties = { fontFamily: FONT, fontWeight: 800, border: 'none', background: '#fbf6ec', borderRadius: 999, padding: '8px 16px', cursor: 'pointer' };
const slot: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: '#fbf6ec', borderRadius: 14, padding: '10px 14px' };
const emptySlot: React.CSSProperties = { ...slot, justifyContent: 'center', color: '#9a8f7c', fontWeight: 700 };
const dot: React.CSSProperties = { width: 22, height: 22, borderRadius: '50%' };
const btn: React.CSSProperties = { fontFamily: FONT, fontWeight: 800, border: 'none', borderRadius: 14, padding: '12px 20px', cursor: 'pointer' };

// ── Mobile: same fixed bg (top center) with a centered scrim panel ──
const wrapMobile: React.CSSProperties = {
  ...backdropBase,
  backgroundPosition: 'top center',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px 12px',
  paddingTop: 'calc(20px + env(safe-area-inset-top))',
  paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
  overflowY: 'auto',
};

// ── Mobile control panel — near-full-width scrim card, centered ──
const panelMobile: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  alignItems: 'center',
  width: '100%',
  maxWidth: 440,
  boxSizing: 'border-box',
  padding: '20px 16px',
  borderRadius: 22,
  background: 'rgba(255, 251, 240, 0.92)',
  border: `3px solid ${GOLD}`,
  boxShadow: '0 12px 36px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.6)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
};
const codeChipMobile: React.CSSProperties = {
  fontFamily: FONT, fontWeight: 800, border: 'none', background: '#fbf6ec',
  borderRadius: 999, padding: '12px 20px', cursor: 'pointer', fontSize: 16, minHeight: 44,
  touchAction: 'manipulation',
};
const slotMobile: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: '#fbf6ec', borderRadius: 14, padding: '13px 14px' };
const emptySlotMobile: React.CSSProperties = { ...slotMobile, justifyContent: 'center', color: '#9a8f7c', fontWeight: 700 };
const dotMobile: React.CSSProperties = { width: 26, height: 26, borderRadius: '50%', flexShrink: 0 };
const btnMobile: React.CSSProperties = {
  fontFamily: FONT, fontWeight: 800, border: 'none', borderRadius: 14,
  padding: '14px 20px', cursor: 'pointer', fontSize: 16, minHeight: 50,
  touchAction: 'manipulation',
};
