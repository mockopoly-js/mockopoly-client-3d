import { useEffect, useState } from 'react';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore, getStoredReconnectToken } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import { TOKEN_HEX } from '../constants/theme';
import type { TokenType } from '../types/GameState';
import type { S_RoomCreated, S_RoomJoined, S_RoomRejected } from '../types/SocketEvents';
import { FONT_FAMILY } from '../constants/fonts';

const TOKENS = Object.keys(TOKEN_HEX) as TokenType[];

export function MainMenu() {
  const [name, setName] = useState('');
  const [token, setToken] = useState<TokenType>('red');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div style={wrap}>
      <h1 style={{ fontFamily: FONT, color: '#3b3224', margin: 0 }}>Mockopoly</h1>
      <input
        placeholder="Enter your name..."
        maxLength={16}
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={input}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {TOKENS.map((t) => (
          <button
            key={t}
            aria-label={t}
            onClick={() => setToken(t)}
            style={{
              width: 34, height: 34, borderRadius: '50%', cursor: 'pointer',
              background: TOKEN_HEX[t],
              border: token === t ? '3px solid #3b3224' : '3px solid transparent',
              transform: token === t ? 'scale(1.15)' : 'scale(1)',
            }}
          />
        ))}
      </div>
      <button onClick={create} disabled={!canCreate} style={primaryBtn}>Create Room</button>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          placeholder="ABCDEF"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          style={{ ...input, textTransform: 'uppercase', letterSpacing: '0.2em' }}
        />
        <button onClick={join} disabled={!canJoin} style={primaryBtn}>Join</button>
      </div>
      {error && <div role="alert" style={{ color: '#c53a26', fontFamily: FONT }}>{error}</div>}
    </div>
  );
}

const FONT = FONT_FAMILY;
const wrap: React.CSSProperties = {
  position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', gap: 16,
  alignItems: 'center', justifyContent: 'center', background: '#eaf7fc', fontFamily: FONT,
};
const input: React.CSSProperties = {
  fontFamily: FONT, fontSize: 16, padding: '10px 14px', borderRadius: 12, border: '2px solid #e7dcbf', outline: 'none',
};
const primaryBtn: React.CSSProperties = {
  fontFamily: FONT, fontWeight: 800, fontSize: 15, color: '#fff', background: '#e07d0a',
  border: 'none', borderRadius: 14, padding: '12px 22px', cursor: 'pointer',
};
