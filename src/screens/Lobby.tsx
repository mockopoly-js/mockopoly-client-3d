import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore, selectMyPlayer } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import { TOKEN_HEX, GOLD } from '../constants/theme';
import type { Player } from '../types/GameState';
import { FONT_FAMILY } from '../constants/fonts';
import { useIsMobile } from '../ui/useIsMobile';
import { useIsLandscape } from '../ui/useIsLandscape';
import { GameButton } from '../ui/GameButton';

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
  // devHacks is typed non-optional on GameState but real server snapshots (and
  // partial lobby states) can arrive without it, so the optional chain guards a
  // genuine runtime path — do NOT collapse it.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- state.devHacks may be absent on early/partial snapshots
  const soloPlay = !!state?.devHacks?.soloPlay;

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
  // navigator.clipboard is typed non-optional but is genuinely absent in
  // insecure contexts / older browsers; guard it, and `void` the returned
  // promise (fire-and-forget; copy failure is non-critical).
  const copyCode = () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- navigator.clipboard can be undefined at runtime (insecure context / old browser)
    if (roomCode && navigator.clipboard) void navigator.clipboard.writeText(roomCode);
  };

  const locked = status === 'starting';
  // config, like devHacks, is typed non-optional but can be absent on partial
  // snapshots; keep the optional chain (falls back to 4 max players).
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- state.config may be absent on early/partial snapshots
  const maxPlayers = state?.config?.maxPlayers ?? 4;
  const isMobile = useIsMobile();
  const isLandscape = useIsLandscape();

  const playerSlots = Array.from({ length: maxPlayers }).map((_, i) => {
    const p = players[i];
    // players[i] is typed non-undefined, but `i` iterates up to maxPlayers which
    // exceeds the seated-players count — empty slots (p === undefined) are real.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- array index past players.length is undefined at runtime
    if (!p) return <div key={i} style={isMobile ? emptySlotMobile : emptySlot}>Empty</div>;
    const tags = [p.isHost ? 'HOST' : null, p.id === myId ? 'YOU' : null].filter(Boolean).join(' • ');
    return (
      <div key={i} style={{ ...(isMobile ? slotMobile : slot), opacity: p.isConnected ? 1 : 0.5 }}>
        <span style={{ ...(isMobile ? dotMobile : dot), background: TOKEN_HEX[p.token] }} />
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

  // ── Mobile LANDSCAPE (wide + short): room-code chip on top, player slots in a
  // 2-column grid, action buttons in a row — fits the short height. Behaviour is
  // shared with the portrait/desktop branches; only the arrangement differs. ──
  if (isMobile && isLandscape) {
    return (
      <div style={wrapLandscape}>
        <div style={panelLandscape}>
          <button onClick={copyCode} style={codeChipMobile}>Room {roomCode ?? '----'}</button>
          <div style={slotsGridLandscape}>
            {playerSlots}
          </div>
          {isHost && status !== 'starting' && (
            <label style={soloToggleMobile}>
              <input
                type="checkbox"
                checked={soloPlay}
                onChange={() => socketManager.emit(EVENTS.DEV_SET_HACK, { hack: 'soloPlay', enabled: !soloPlay })}
                style={{ marginRight: 8, cursor: 'pointer', width: 18, height: 18 }}
              />
              <span style={{ fontSize: 14, fontWeight: 700 }}>Solo play (1 player)</span>
            </label>
          )}
          {countdown !== null && status === 'starting'
            ? <div style={{ fontWeight: 800, fontSize: 20, color: '#e07d0a' }}>Starting in {countdown}...</div>
            : (
              <div style={actionsRowLandscape}>
                <GameButton variant={me?.isReady ? 'success' : 'primary'} onClick={toggleReady} disabled={locked} fullWidth>
                  {me?.isReady ? <><span>Ready</span><Check size={16} aria-hidden style={{ marginLeft: 4 }} /></> : 'Ready'}
                </GameButton>
                {isHost && (
                  <GameButton variant="primary" onClick={start} disabled={locked || players.length < (soloPlay ? 1 : 2)} fullWidth>
                    Start Game
                  </GameButton>
                )}
                <GameButton variant="tertiary" onClick={leave} disabled={locked} fullWidth>Back</GameButton>
              </div>
            )}
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div style={wrapMobile}>
        <div style={panelMobile}>
          <button onClick={copyCode} style={codeChipMobile}>Room {roomCode ?? '----'}</button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 400 }}>
            {playerSlots}
          </div>
          {isHost && status !== 'starting' && (
            <label style={soloToggleMobile}>
              <input
                type="checkbox"
                checked={soloPlay}
                onChange={() => socketManager.emit(EVENTS.DEV_SET_HACK, { hack: 'soloPlay', enabled: !soloPlay })}
                style={{ marginRight: 8, cursor: 'pointer', width: 18, height: 18 }}
              />
              <span style={{ fontSize: 14, fontWeight: 700 }}>Solo play (1 player)</span>
            </label>
          )}
          {countdown !== null && status === 'starting'
            ? <div style={{ fontWeight: 800, fontSize: 20, color: '#e07d0a' }}>Starting in {countdown}...</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 400 }}>
                <GameButton variant={me?.isReady ? 'success' : 'primary'} onClick={toggleReady} disabled={locked} fullWidth>
                  {me?.isReady ? <><span>Ready</span><Check size={16} aria-hidden style={{ marginLeft: 4 }} /></> : 'Ready'}
                </GameButton>
                {isHost && (
                  <GameButton variant="primary" onClick={start} disabled={locked || players.length < (soloPlay ? 1 : 2)} fullWidth>
                    Start Game
                  </GameButton>
                )}
                <GameButton variant="tertiary" onClick={leave} disabled={locked} fullWidth>Back</GameButton>
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

        {isHost && status !== 'starting' && (
          <label style={soloToggle}>
            <input
              type="checkbox"
              checked={soloPlay}
              onChange={() => socketManager.emit(EVENTS.DEV_SET_HACK, { hack: 'soloPlay', enabled: !soloPlay })}
              style={{ marginRight: 8, cursor: 'pointer', width: 16, height: 16 }}
            />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Solo play (1 player)</span>
          </label>
        )}

        {countdown !== null && status === 'starting'
          ? <div style={{ fontWeight: 800, fontSize: 20, color: '#e07d0a' }}>Starting in {countdown}...</div>
          : (
            <div style={{ display: 'flex', gap: 10 }}>
              <GameButton variant={me?.isReady ? 'success' : 'primary'} onClick={toggleReady} disabled={locked} fullWidth>
                {me?.isReady ? 'Ready ✓' : 'Ready'}
              </GameButton>
              {isHost && (
                <GameButton variant="primary" onClick={start} disabled={locked || players.length < (soloPlay ? 1 : 2)} fullWidth>
                  Start Game
                </GameButton>
              )}
              <GameButton variant="tertiary" onClick={leave} disabled={locked} fullWidth>Back</GameButton>
            </div>
          )}
      </div>
    </div>
  );
}

const FONT = FONT_FAMILY;
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

// ── Desktop (restored from `main`): cover + centered so the panel lands in the
// mid-frame plaza ──
const wrap: React.CSSProperties = {
  ...backdropBase,
  backgroundPosition: 'center center',
  alignItems: 'center',
  justifyContent: 'center',
};

// ── Desktop control panel (restored from `main`) — floats in the sandy plaza
// (centered both axes) ──
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

const codeChip: React.CSSProperties = { fontFamily: FONT, fontWeight: 800, border: `1px solid ${GOLD}`, background: '#fbf6ec', borderRadius: 999, padding: '8px 16px', cursor: 'pointer' };
const slot: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: '#fbf6ec', borderRadius: 14, padding: '10px 14px' };
const emptySlot: React.CSSProperties = { ...slot, justifyContent: 'center', color: '#9a8f7c', fontWeight: 700 };
const dot: React.CSSProperties = { width: 22, height: 22, borderRadius: '50%' };

// ── Mobile: same fixed bg (top center), center-or-scroll (panel margin:auto).
// No `justify/align center` — those top-clip a scroll container when the panel
// is taller than the viewport; `margin:auto` centers yet keeps the top reachable. ──
const wrapMobile: React.CSSProperties = {
  ...backdropBase,
  backgroundPosition: 'top center',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  padding:
    'max(16px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))',
};

// ── Mobile control panel — near-full-width scrim card, centered ──
const panelMobile: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(10px, 2.5vw, 14px)',
  alignItems: 'center',
  width: '100%',
  maxWidth: 440,
  boxSizing: 'border-box',
  margin: 'auto',
  padding: 'clamp(14px, 3.5vw, 20px)',
  borderRadius: 22,
  background: 'rgba(255, 251, 240, 0.92)',
  border: `3px solid ${GOLD}`,
  boxShadow: '0 12px 36px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.6)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
};
const codeChipMobile: React.CSSProperties = {
  fontFamily: FONT, fontWeight: 800, border: `1px solid ${GOLD}`, background: '#fbf6ec',
  borderRadius: 999, padding: '12px 20px', cursor: 'pointer', fontSize: 16, minHeight: 44,
  touchAction: 'manipulation',
};

// ── Mobile LANDSCAPE (wide + short) ──
const wrapLandscape: React.CSSProperties = {
  ...backdropBase,
  backgroundPosition: 'center center',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  padding:
    'max(8px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left))',
};
const panelLandscape: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(8px, 1.8vh, 12px)',
  alignItems: 'center',
  width: 'min(720px, 94vw)',
  maxWidth: 'min(720px, 94vw)',
  boxSizing: 'border-box',
  margin: 'auto',
  padding: 'clamp(12px, 2.4vh, 18px) clamp(16px, 3vw, 22px)',
  borderRadius: 20,
  background: 'rgba(255, 251, 240, 0.92)',
  border: `3px solid ${GOLD}`,
  boxShadow: '0 12px 36px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.6)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
};
// Player slots two-up so four seats occupy two short rows instead of four tall ones.
const slotsGridLandscape: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 10,
  width: '100%',
};
const actionsRowLandscape: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  width: '100%',
};
const slotMobile: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: '#fbf6ec', borderRadius: 14, padding: '13px 14px' };
const emptySlotMobile: React.CSSProperties = { ...slotMobile, justifyContent: 'center', color: '#9a8f7c', fontWeight: 700 };
const dotMobile: React.CSSProperties = { width: 26, height: 26, borderRadius: '50%', flexShrink: 0 };

const soloToggle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '8px 14px',
  background: '#fbf6ec',
  borderRadius: 12,
  border: `1px solid ${GOLD}`,
  cursor: 'pointer',
  fontFamily: FONT,
  color: '#3b3224',
  touchAction: 'manipulation',
};

const soloToggleMobile: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '10px 14px',
  background: '#fbf6ec',
  borderRadius: 12,
  border: `1px solid ${GOLD}`,
  cursor: 'pointer',
  fontFamily: FONT,
  color: '#3b3224',
  minHeight: 44,
  touchAction: 'manipulation',
};
