import { useEffect, useState } from 'react';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore, getStoredReconnectToken } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import { TOKEN_HEX } from '../constants/theme';
import type { TokenType } from '../types/GameState';
import type { S_RoomCreated, S_RoomJoined, S_RoomRejected } from '../types/SocketEvents';
import { FONT_FAMILY } from '../constants/fonts';
import { useIsMobile } from '../ui/useIsMobile';

const TOKENS = Object.keys(TOKEN_HEX) as TokenType[];

export function MainMenu() {
  const [name, setName] = useState('');
  const [token, setToken] = useState<TokenType>('red');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const applyJoined = (state: S_RoomJoined['state']) => {
      const store = useGameStore.getState();
      store.setRoomCode(state.roomCode);
      store.update(state);
      // The server assigns each player a uuid as player.id (NOT socket.id / connect-ack id).
      // The just-added local player is the last entry in the freshly-returned state
      // (the creator when alone; the joiner is appended last) — mirrors the 2D client.
      // NOTE: does not self-identify on a reconnect that re-attaches an existing (non-last)
      // player slot; refine when reconnect UX lands.
      const me = state.players[state.players.length - 1];
      if (me) {
        store.setMyPlayerId(me.id);
        store.setReconnectToken(me.reconnectToken);
      }
    };
    const onCreated = (d: S_RoomCreated) => { applyJoined(d.state); useGameStore.getState().setScreen('lobby'); };
    const onJoined = (d: S_RoomJoined) => {
      applyJoined(d.state);
      useGameStore.getState().setScreen(d.state.status === 'in-progress' ? 'game' : 'lobby');
    };
    const onRejected = (d: S_RoomRejected) => setError(d.reason);
    gameBus.on('room-created', onCreated);
    gameBus.on('room-joined', onJoined);
    gameBus.on('room-rejected', onRejected);
    return () => {
      gameBus.off('room-created', onCreated);
      gameBus.off('room-joined', onJoined);
      gameBus.off('room-rejected', onRejected);
    };
  }, []);

  const trimmedName = name.trim();
  const canCreate = trimmedName.length > 0;
  const normalizedCode = code.trim().toUpperCase();
  const canJoin = canCreate && normalizedCode.length >= 4;

  const create = () => {
    if (!canCreate) return;
    setError(null);
    socketManager.emit(EVENTS.ROOM_CREATE, { playerName: trimmedName, token });
  };
  const join = () => {
    if (!canJoin) return;
    setError(null);
    socketManager.emit(EVENTS.ROOM_JOIN, {
      roomCode: normalizedCode,
      playerName: trimmedName,
      token,
      reconnectToken: getStoredReconnectToken() ?? undefined,
    });
  };

  // Shared control cluster (name / tokens / create / join / error). The only
  // difference between mobile & desktop is sizing, which is passed in via `m`.
  const controls = (m: boolean) => (
    <>
      <style>{PRESS_CSS}</style>
      <input
        className="mm-input"
        placeholder="Enter your name..."
        maxLength={16}
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={m ? inputMobile : input}
      />
      <div style={swatchRow(m)}>
        {TOKENS.map((t) => (
          <button
            key={t}
            className="mm-swatch"
            aria-label={t}
            onClick={() => setToken(t)}
            style={swatch(m, token === t, TOKEN_HEX[t])}
          />
        ))}
      </div>
      <button className="mm-btn mm-btn-create" onClick={create} disabled={!canCreate} style={createBtn(m, canCreate)}>
        Create Room
      </button>
      <div style={joinRow(m)}>
        <input
          className="mm-input"
          placeholder="ABCDEF"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          style={{ ...(m ? inputMobile : input), flex: 1, minWidth: 0, textTransform: 'uppercase', letterSpacing: '0.2em', textAlign: 'center' }}
        />
        <button className="mm-btn mm-btn-join" onClick={join} disabled={!canJoin} style={joinBtn(m, canJoin)}>
          Join
        </button>
      </div>
      {error && <div role="alert" style={errorText(m)}>{error}</div>}
    </>
  );

  if (isMobile) {
    return (
      <div style={heroMobile}>
        <div style={panelMobile}>{controls(true)}</div>
      </div>
    );
  }

  return (
    <div style={hero}>
      <div style={panel}>{controls(false)}</div>
    </div>
  );
}

const FONT = FONT_FAMILY;

// Hover / press feedback that inline styles can't express. Scoped to the
// menu's classes; :disabled buttons are excluded so dimmed states stay put.
const PRESS_CSS = `
.mm-btn:not(:disabled):hover { filter: brightness(1.05); }
.mm-btn:not(:disabled):active { transform: translateY(3px); box-shadow: 0 1px 0 rgba(0,0,0,0.3); }
.mm-swatch:hover { transform: scale(1.12); }
.mm-swatch:active { transform: scale(1.05); }
.mm-input::placeholder { color: #a89a72; }
.mm-input:focus { border-color: #d4af37; box-shadow: 0 0 0 3px rgba(212,175,55,0.28); }
`;

const GOLD = '#d4af37';
const GOLD_BRIGHT = '#f0d060';
const GOLD_DARK = '#9a6b1e';
const RED = '#c53a26';
const HERO_URL = '/images/home-hero.webp';

// ── Backdrop (the baked-in "MOCKOPOLY MANIA" logo + toy city) ──
const heroBase: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundImage: `url(${HERO_URL})`,
  backgroundColor: '#5aa9e6', // sky fallback while the webp loads
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
  fontFamily: FONT,
  display: 'flex',
  boxSizing: 'border-box',
};

// Desktop: cover + centered so the plaza sits mid-screen; panel floats in the
// sandy circle (lower-middle), clear of the top logo.
const hero: React.CSSProperties = {
  ...heroBase,
  backgroundPosition: 'center center',
  alignItems: 'flex-end',
  justifyContent: 'center',
};

// Mobile/portrait: keep the logo up top (background-position: top center) and
// pin the controls to the bottom with a scrim.
const heroMobile: React.CSSProperties = {
  ...heroBase,
  backgroundPosition: 'top center',
  alignItems: 'flex-end',
  justifyContent: 'center',
  padding: '0 12px calc(16px + env(safe-area-inset-bottom))',
};

// ── Desktop control panel — floats in the sandy plaza (~52–60% vertical) ──
const panel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  alignItems: 'center',
  width: 'min(420px, 90vw)',
  boxSizing: 'border-box',
  padding: '24px 26px',
  // Sit in the plaza (lower-middle) rather than dead-center — nudged up from
  // the very bottom so the whole card lands inside the sandy circle.
  marginBottom: '9vh',
  borderRadius: 24,
  background: 'rgba(255, 251, 240, 0.9)',
  border: `3px solid ${GOLD}`,
  boxShadow: '0 18px 48px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.6)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
};

// ── Mobile control panel — full-width scrim card pinned to the bottom ──
const panelMobile: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  alignItems: 'center',
  width: '100%',
  maxWidth: 440,
  boxSizing: 'border-box',
  padding: '18px 16px',
  borderRadius: 22,
  background: 'rgba(255, 251, 240, 0.92)',
  border: `3px solid ${GOLD}`,
  boxShadow: '0 -6px 32px rgba(0,0,0,0.4), 0 12px 36px rgba(0,0,0,0.35)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
};

// ── Inputs ──
const inputBase: React.CSSProperties = {
  fontFamily: FONT,
  fontWeight: 600,
  fontSize: 16, // 16px avoids iOS focus zoom
  color: '#3b3224',
  background: 'rgba(255,255,255,0.95)',
  border: '2px solid #e2c98a',
  outline: 'none',
  boxSizing: 'border-box',
  touchAction: 'manipulation',
};
const input: React.CSSProperties = {
  ...inputBase,
  padding: '11px 16px',
  borderRadius: 14,
  width: '100%',
};
const inputMobile: React.CSSProperties = {
  ...inputBase,
  padding: '13px 16px',
  borderRadius: 14,
  width: '100%',
  minHeight: 50,
};

// ── Token swatches ──
const swatchRow = (m: boolean): React.CSSProperties => ({
  display: 'flex',
  gap: m ? 10 : 8,
  flexWrap: 'wrap',
  justifyContent: 'center',
  width: '100%',
});
const swatch = (m: boolean, selected: boolean, hex: string): React.CSSProperties => {
  const size = m ? 44 : 34;
  return {
    width: size,
    height: size,
    borderRadius: '50%',
    cursor: 'pointer',
    padding: 0,
    background: hex,
    border: selected ? `3px solid ${GOLD}` : '3px solid rgba(255,255,255,0.85)',
    boxShadow: selected
      ? `0 0 0 2px rgba(212,175,55,0.4), 0 2px 6px rgba(0,0,0,0.35)`
      : '0 2px 5px rgba(0,0,0,0.3)',
    transform: selected ? 'scale(1.15)' : 'scale(1)',
    transition: 'transform 0.12s ease, box-shadow 0.12s ease',
    touchAction: 'manipulation',
  };
};

// ── Buttons ──
const createBtn = (m: boolean, enabled: boolean): React.CSSProperties => ({
  fontFamily: FONT,
  fontWeight: 800,
  fontSize: m ? 18 : 17,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: enabled ? '#5a3d0a' : 'rgba(90,61,10,0.55)',
  background: enabled
    ? `linear-gradient(180deg, ${GOLD_BRIGHT} 0%, ${GOLD} 100%)`
    : 'linear-gradient(180deg, #d9cfb0 0%, #c3b78f 100%)',
  border: `2px solid ${enabled ? GOLD_DARK : '#a99e78'}`,
  borderRadius: 16,
  padding: m ? '15px 22px' : '13px 22px',
  width: '100%',
  minHeight: m ? 52 : undefined,
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.7,
  boxShadow: enabled
    ? '0 6px 0 rgba(154,107,30,0.55), 0 8px 18px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.6)'
    : '0 3px 0 rgba(0,0,0,0.15)',
  transition: 'transform 0.08s ease, box-shadow 0.08s ease',
  touchAction: 'manipulation',
});

const joinRow = (m: boolean): React.CSSProperties => ({
  display: 'flex',
  gap: m ? 10 : 8,
  width: '100%',
});
const joinBtn = (m: boolean, enabled: boolean): React.CSSProperties => ({
  fontFamily: FONT,
  fontWeight: 800,
  fontSize: m ? 16 : 15,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: enabled ? '#fff' : 'rgba(255,255,255,0.7)',
  background: enabled
    ? 'linear-gradient(180deg, #f0a83c 0%, #e07d0a 100%)'
    : 'linear-gradient(180deg, #d9c9b0 0%, #c3ad8f 100%)',
  border: `2px solid ${enabled ? '#a85a06' : '#a99e78'}`,
  borderRadius: 14,
  padding: m ? '13px 18px' : '11px 18px',
  minHeight: m ? 50 : undefined,
  flexShrink: 0,
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.7,
  boxShadow: enabled
    ? '0 4px 0 rgba(168,90,6,0.55), 0 6px 14px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.4)'
    : '0 3px 0 rgba(0,0,0,0.12)',
  transition: 'transform 0.08s ease, box-shadow 0.08s ease',
  touchAction: 'manipulation',
});

const errorText = (m: boolean): React.CSSProperties => ({
  color: RED,
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: m ? 14 : 14,
  textAlign: 'center',
  width: '100%',
});
