import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore, getStoredReconnectToken } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import { TOKEN_HEX, GOLD } from '../constants/theme';
import type { TokenType } from '../types/GameState';
import type { S_RoomCreated, S_RoomJoined, S_RoomRejected } from '../types/SocketEvents';
import { FONT_FAMILY } from '../constants/fonts';
import { useIsMobile } from '../ui/useIsMobile';
import { GameButton } from '../ui/GameButton';
import { resolveCharacter } from '../constants/characters';

const TOKENS = Object.keys(TOKEN_HEX) as TokenType[];

export function MainMenu() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const selectedCharacter = useGameStore((s) => s.selectedCharacter);
  // Board-identity color persists in the store so the CharacterSelect "locker"
  // (Equip) and this menu stay in sync. The swatch row still lets you tweak it.
  const token = useGameStore((s) => s.selectedToken);
  const setToken = useGameStore((s) => s.setSelectedToken);
  const charDef = resolveCharacter(selectedCharacter);

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
    socketManager.emit(EVENTS.ROOM_CREATE, { playerName: trimmedName, token, character: selectedCharacter });
  };
  const join = () => {
    if (!canJoin) return;
    setError(null);
    socketManager.emit(EVENTS.ROOM_JOIN, {
      roomCode: normalizedCode,
      playerName: trimmedName,
      token,
      character: selectedCharacter,
      reconnectToken: getStoredReconnectToken() ?? undefined,
    });
  };

  // Shared control cluster (name / tokens / create / join / error). The only
  // difference between mobile & desktop is sizing, which is passed in via `m`.
  const controls = (m: boolean) => (
    <>
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
      <button
        className="mm-char-btn"
        onClick={() => navigate('/character-select')}
        style={charBtn(m)}
        aria-label="Choose character"
      >
        <span style={charBtnIcon}>&#128100;</span>
        <span style={charBtnLabel}>{charDef.name}</span>
        <span style={charBtnArrow}>›</span>
      </button>
      <GameButton variant="primary" fullWidth onClick={create} disabled={!canCreate}>
        Create Room
      </GameButton>
      <div style={joinRow(m)}>
        <input
          className="mm-input"
          placeholder="ABCDEF"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          style={{ ...(m ? inputMobile : input), flex: 1, minWidth: 0, textTransform: 'uppercase', letterSpacing: '0.2em', textAlign: 'center' }}
        />
        <GameButton variant="secondary" onClick={join} disabled={!canJoin} style={{ flexShrink: 0 }}>
          Join
        </GameButton>
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

const joinRow = (m: boolean): React.CSSProperties => ({
  display: 'flex',
  gap: m ? 10 : 8,
  width: '100%',
});

const errorText = (m: boolean): React.CSSProperties => ({
  color: RED,
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: m ? 14 : 14,
  textAlign: 'center',
  width: '100%',
});

// ── Character chooser affordance ──
const charBtn = (m: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: m ? '11px 14px' : '9px 14px',
  borderRadius: 14,
  border: `2px solid ${GOLD}`,
  background: 'rgba(255,255,255,0.85)',
  cursor: 'pointer',
  fontFamily: FONT,
  fontWeight: 600,
  fontSize: m ? 15 : 14,
  color: '#3b3224',
  textAlign: 'left',
  boxSizing: 'border-box',
  touchAction: 'manipulation',
});

const charBtnIcon: React.CSSProperties = {
  fontSize: 18,
  lineHeight: 1,
  flexShrink: 0,
};

const charBtnLabel: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const charBtnArrow: React.CSSProperties = {
  fontSize: 20,
  lineHeight: 1,
  color: GOLD,
  flexShrink: 0,
};
