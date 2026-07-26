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
import { useIsLandscape } from '../ui/useIsLandscape';
import { GameButton } from '../ui/GameButton';
import { resolveCharacter } from '../constants/characters';

const TOKENS = Object.keys(TOKEN_HEX) as TokenType[];

export function MainMenu() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const isLandscape = useIsLandscape();
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
  // `m` toggles presentation only: `m === true` = the current responsive mobile
  // sizing (fluid clamps), `m === false` = the fixed desktop sizing restored
  // verbatim from `main`. State/handlers/socket calls are shared across both.
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
      <div style={m ? swatchRowMobile : swatchRow}>
        {TOKENS.map((t) => (
          <button
            key={t}
            className="mm-swatch"
            aria-label={t}
            onClick={() => setToken(t)}
            style={m ? swatchMobile(token === t, TOKEN_HEX[t]) : swatch(token === t, TOKEN_HEX[t])}
          />
        ))}
      </div>
      <button
        className="mm-char-btn"
        onClick={() => navigate('/character-select')}
        style={m ? charBtnMobile : charBtn}
        aria-label="Choose character"
      >
        <span style={charBtnIcon}>&#128100;</span>
        <span style={charBtnLabel}>{charDef.name}</span>
        <span style={charBtnArrow}>›</span>
      </button>
      <GameButton variant="primary" fullWidth onClick={create} disabled={!canCreate}>
        Create Room
      </GameButton>
      <div style={m ? joinRowMobile : joinRow}>
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
      {error && <div role="alert" style={errorText}>{error}</div>}
    </>
  );

  // ── Mobile LANDSCAPE (wide + short): two columns so the whole card fits the
  // short height with no vertical overflow. Left = name + character; right =
  // token grid + Create Room + the Join row. State/handlers are shared with the
  // portrait/desktop branches; only the arrangement differs. ──
  if (isMobile && isLandscape) {
    return (
      <div style={heroLandscape}>
        <div style={panelLandscape}>
          <div style={colLandscape}>
            <input
              className="mm-input"
              placeholder="Enter your name..."
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputMobile}
            />
            <button
              className="mm-char-btn"
              onClick={() => navigate('/character-select')}
              style={charBtnMobile}
              aria-label="Choose character"
            >
              <span style={charBtnIcon}>&#128100;</span>
              <span style={charBtnLabel}>{charDef.name}</span>
              <span style={charBtnArrow}>›</span>
            </button>
          </div>
          <div style={colLandscape}>
            <div style={swatchGridLandscape}>
              {TOKENS.map((t) => (
                <button
                  key={t}
                  className="mm-swatch"
                  aria-label={t}
                  onClick={() => setToken(t)}
                  style={swatchLandscape(token === t, TOKEN_HEX[t])}
                />
              ))}
            </div>
            <GameButton variant="primary" fullWidth onClick={create} disabled={!canCreate}>
              Create Room
            </GameButton>
            <div style={joinRowMobile}>
              <input
                className="mm-input"
                placeholder="ABCDEF"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                style={{ ...inputMobile, flex: 1, minWidth: 0, textTransform: 'uppercase', letterSpacing: '0.2em', textAlign: 'center' }}
              />
              <GameButton variant="secondary" onClick={join} disabled={!canJoin} style={{ flexShrink: 0 }}>
                Join
              </GameButton>
            </div>
            {error && <div role="alert" style={errorText}>{error}</div>}
          </div>
        </div>
      </div>
    );
  }

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
// Desktop base restored from `main`: a plain fixed full-screen flex box (no
// scroll / no padding); the panel is bottom-anchored via the wrapper's flex-end.
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

// Mobile base (current responsive layout): center-or-scroll wrapper with
// safe-area padding so the card never clips on short/landscape phones.
const heroBaseMobile: React.CSSProperties = {
  ...heroBase,
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  padding:
    'max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))',
};

// Desktop (from `main`): cover + centered so the plaza sits mid-screen; panel
// floats in the sandy circle (lower-middle), clear of the top logo.
const hero: React.CSSProperties = {
  ...heroBase,
  backgroundPosition: 'center center',
  alignItems: 'flex-end',
  justifyContent: 'center',
};

// Mobile/portrait (current): keep the logo up top (background-position: top center).
const heroMobile: React.CSSProperties = {
  ...heroBaseMobile,
  backgroundPosition: 'top center',
};

// Mobile LANDSCAPE: center-or-scroll wrapper (safety net) with the panel
// centered; bg centered so the card sits mid-frame on a short viewport. Extra
// LEFT padding for the landscape notch.
const heroLandscape: React.CSSProperties = {
  ...heroBase,
  backgroundPosition: 'center center',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  padding:
    'max(8px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left))',
};

// ── Desktop control panel (restored from `main`) — floats in the sandy plaza
// (~52–60% vertical), nudged up 9vh from the very bottom ──
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

// ── Mobile control panel (current) — near-full-width scrim card ──
// `margin:auto` centers the panel in the scroll wrapper when it fits and clamps
// to the top (top stays reachable) + scrolls when it overflows.
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
const panelMobile: React.CSSProperties = {
  ...panelBase,
  width: '100%',
  maxWidth: 440,
  borderRadius: 22,
  boxShadow: '0 -6px 32px rgba(0,0,0,0.4), 0 12px 36px rgba(0,0,0,0.35)',
};

// ── Mobile LANDSCAPE control panel — wider, two-column, compact vertical
// rhythm so it fits a ~360–430px-tall viewport with no vertical overflow. ──
const panelLandscape: React.CSSProperties = {
  ...panelBase,
  flexDirection: 'row',
  alignItems: 'stretch',
  gap: 'clamp(12px, 3vw, 22px)',
  width: 'min(760px, 94vw)',
  maxWidth: 'min(760px, 94vw)',
  borderRadius: 20,
  padding: 'clamp(12px, 2.4vh, 18px) clamp(14px, 3vw, 22px)',
  boxShadow: '0 12px 36px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.6)',
};
// Each landscape column fills half the width; content vertically centered so the
// shorter (2-item) left column aligns with the taller right column.
const colLandscape: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(8px, 1.8vh, 12px)',
  flex: 1,
  minWidth: 0,
  justifyContent: 'center',
};
// Token swatches as a fixed 2-row × 4-col grid (all 8 tokens visible, no wrap).
const swatchGridLandscape: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 'clamp(6px, 1.4vh, 10px)',
  justifyItems: 'center',
  width: '100%',
};
const swatchLandscape = (selected: boolean, hex: string): React.CSSProperties => {
  const size = 'clamp(40px, 6vh, 44px)';
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
    transform: selected ? 'scale(1.12)' : 'scale(1)',
    transition: 'transform 0.12s ease, box-shadow 0.12s ease',
    touchAction: 'manipulation',
  };
};

// ── Inputs ──
// Desktop (from `main`): fixed padding. fontSize stays 16px (below that iOS
// zooms the page on focus).
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
// Mobile (current): fluid padding + ≥44px tap target.
const inputMobile: React.CSSProperties = {
  ...inputBase,
  width: '100%',
  borderRadius: 14,
  padding: 'clamp(11px, 2.6vw, 14px) 16px',
  minHeight: 44,
};

// ── Token swatches ──
// Desktop (from `main`): fixed 34px dots, 8px gap.
const swatchRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  justifyContent: 'center',
  width: '100%',
};
const swatch = (selected: boolean, hex: string): React.CSSProperties => {
  const size = 34;
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
// Mobile (current): fluid 28→44px dots that wrap cleanly on the narrowest phones.
const swatchRowMobile: React.CSSProperties = {
  display: 'flex',
  gap: 'clamp(6px, 1.5vw, 10px)',
  flexWrap: 'wrap',
  justifyContent: 'center',
  width: '100%',
};
const swatchMobile = (selected: boolean, hex: string): React.CSSProperties => {
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

// Desktop (from `main`): 8px gap. Mobile (current): fluid gap.
const joinRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  width: '100%',
};
const joinRowMobile: React.CSSProperties = {
  display: 'flex',
  gap: 'clamp(8px, 2vw, 10px)',
  width: '100%',
};

// Identical for both branches (14px).
const errorText: React.CSSProperties = {
  color: RED,
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 14,
  textAlign: 'center',
  width: '100%',
};

// ── Character chooser affordance ──
// Desktop (from `main`): fixed padding + 14px label. Mobile (current): fluid.
const charBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '9px 14px',
  borderRadius: 14,
  border: `2px solid ${GOLD}`,
  background: 'rgba(255,255,255,0.85)',
  cursor: 'pointer',
  fontFamily: FONT,
  fontWeight: 600,
  fontSize: 14,
  color: '#3b3224',
  textAlign: 'left',
  boxSizing: 'border-box',
  touchAction: 'manipulation',
};
const charBtnMobile: React.CSSProperties = {
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
