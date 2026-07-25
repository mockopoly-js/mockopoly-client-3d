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
  const selectedCharacterColor = useGameStore((s) => s.selectedCharacterColor);
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
      // .at(-1) is Player | undefined — an empty players array is a real runtime
      // possibility, so the guard below is live.
      const me = state.players.at(-1);
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
    socketManager.emit(EVENTS.ROOM_CREATE, {
      playerName: trimmedName,
      token,
      character: selectedCharacter,
      characterColor: selectedCharacterColor ?? undefined,
    });
  };
  const join = () => {
    if (!canJoin) return;
    setError(null);
    socketManager.emit(EVENTS.ROOM_JOIN, {
      roomCode: normalizedCode,
      playerName: trimmedName,
      token,
      character: selectedCharacter,
      characterColor: selectedCharacterColor ?? undefined,
      reconnectToken: getStoredReconnectToken() ?? undefined,
    });
  };

  // Shared control cluster (name / tokens / character / create / join / error).
  // Sizing is fully fluid (clamp), so mobile & desktop render the identical
  // cluster — only the wrapper/panel chrome (background position, width, shadow)
  // differs between the two branches below.
  const controls = () => (
    <>
      <input
        className="mm-input"
        placeholder="Enter your name..."
        maxLength={16}
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={input}
      />
      <div style={swatchRow}>
        {TOKENS.map((t) => (
          <button
            key={t}
            className="mm-swatch"
            aria-label={t}
            onClick={() => setToken(t)}
            style={swatch(token === t, TOKEN_HEX[t])}
          />
        ))}
      </div>
      <button
        className="mm-char-btn"
        onClick={() => navigate('/character-select')}
        style={charBtn}
        aria-label="Choose character"
      >
        <span style={charBtnIcon}>&#128100;</span>
        <span style={charBtnLabel}>{charDef.name}</span>
        <span style={charBtnArrow}>›</span>
      </button>
      <GameButton variant="primary" fullWidth onClick={create} disabled={!canCreate}>
        Create Room
      </GameButton>
      <div style={joinRow}>
        <input
          className="mm-input"
          placeholder="ABCDEF"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          style={{ ...input, flex: 1, minWidth: 0, textTransform: 'uppercase', letterSpacing: '0.2em', textAlign: 'center' }}
        />
        <GameButton variant="secondary" onClick={join} disabled={!canJoin} style={{ flexShrink: 0 }}>
          Join
        </GameButton>
      </div>
      {error && <div role="alert" style={errorText}>{error}</div>}
    </>
  );

  if (isMobile) {
    return (
      <div style={heroMobile}>
        <div style={panelMobile}>{controls()}</div>
      </div>
    );
  }

  return (
    <div style={hero}>
      <div style={panel}>{controls()}</div>
    </div>
  );
}

const FONT = FONT_FAMILY;

const RED = '#c53a26';
const HERO_URL = '/images/home-hero.webp';

// ── Backdrop (the baked-in "MOCKOPOLY MANIA" logo + toy city) ──
// Center-or-scroll wrapper: a fixed, full-screen flex box that CENTERS the panel
// (via the panel's `margin:auto`) when it fits, and SCROLLS (`overflowY:auto`)
// without ever clipping the top when the panel is taller than a short/landscape
// viewport. Safe-area padding keeps it clear of notches/home indicators.
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
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  padding:
    'max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))',
};

// Desktop: cover + plaza centered.
const hero: React.CSSProperties = {
  ...heroBase,
  backgroundPosition: 'center center',
};

// Mobile/portrait: keep the logo up top (background-position: top center).
const heroMobile: React.CSSProperties = {
  ...heroBase,
  backgroundPosition: 'top center',
};

// ── Control panel (shared chrome) ──
// `margin:auto` centers the panel in the flex wrapper when it fits and clamps to
// the top (top stays reachable) + scrolls when it overflows. `maxHeight:100%`
// keeps it from exceeding the scrollable wrapper. All spacing is fluid (clamp)
// so the card scales down gracefully on small screens.
const panelBase: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(8px, 2vw, 14px)',
  alignItems: 'center',
  boxSizing: 'border-box',
  margin: 'auto',
  maxHeight: '100%',
  padding: 'clamp(12px, 3vw, 26px)',
  background: 'rgba(255, 251, 240, 0.92)',
  border: `3px solid ${GOLD}`,
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
};

// ── Desktop control panel — floats in the sandy plaza (centered) ──
const panel: React.CSSProperties = {
  ...panelBase,
  width: 'min(420px, 90vw)',
  borderRadius: 24,
  boxShadow: '0 18px 48px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.6)',
};

// ── Mobile control panel — near-full-width scrim card ──
const panelMobile: React.CSSProperties = {
  ...panelBase,
  width: '100%',
  maxWidth: 440,
  borderRadius: 22,
  boxShadow: '0 -6px 32px rgba(0,0,0,0.4), 0 12px 36px rgba(0,0,0,0.35)',
};

// ── Inputs ──
// fontSize stays at 16px (below that, iOS zooms the page on focus). Padding is
// fluid and minHeight keeps a ≥44px tap target.
const input: React.CSSProperties = {
  fontFamily: FONT,
  fontWeight: 600,
  fontSize: 16,
  color: '#3b3224',
  background: 'rgba(255,255,255,0.95)',
  border: '2px solid #e2c98a',
  outline: 'none',
  boxSizing: 'border-box',
  touchAction: 'manipulation',
  width: '100%',
  borderRadius: 14,
  padding: 'clamp(11px, 2.6vw, 14px) 16px',
  minHeight: 44,
};

// ── Token swatches ──
// Dots are fluid (28→44px) and wrap; on typical phones the 8 tokens fit one row,
// on the narrowest they wrap cleanly to two rows — never clipped.
const swatchRow: React.CSSProperties = {
  display: 'flex',
  gap: 'clamp(6px, 1.5vw, 10px)',
  flexWrap: 'wrap',
  justifyContent: 'center',
  width: '100%',
};
const swatch = (selected: boolean, hex: string): React.CSSProperties => {
  const size = 'clamp(28px, 7vw, 44px)';
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

const joinRow: React.CSSProperties = {
  display: 'flex',
  gap: 'clamp(8px, 2vw, 10px)',
  width: '100%',
};

const errorText: React.CSSProperties = {
  color: RED,
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 14,
  textAlign: 'center',
  width: '100%',
};

// ── Character chooser affordance ──
const charBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: 'clamp(10px, 2.4vw, 13px) 14px',
  minHeight: 44,
  borderRadius: 14,
  border: `2px solid ${GOLD}`,
  background: 'rgba(255,255,255,0.85)',
  cursor: 'pointer',
  fontFamily: FONT,
  fontWeight: 600,
  fontSize: 'clamp(14px, 3.6vw, 15px)',
  color: '#3b3224',
  textAlign: 'left',
  boxSizing: 'border-box',
  touchAction: 'manipulation',
};

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
