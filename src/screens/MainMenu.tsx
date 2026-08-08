import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore, getStoredReconnectToken } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import { TOKEN_HEX } from '../constants/theme';
import type { S_RoomCreated, S_RoomJoined, S_RoomRejected } from '../types/SocketEvents';
import { resolveCharacter } from '../constants/characters';
import {
  Button, CodeInput, Field, KIT, Rule, SafeBox, Segs, Toast, Wordmark,
  ZoneMid, ZoneRead,
} from '../ui/kit';
import type { KitStyle } from '../ui/kit';
import { CAP_LINE, COL_ACT, NEUTRAL_TURN, SHELL_BACKDROP, SHELL_STAGE } from './shellChrome';
import { TokenPicker } from './TokenPicker';

/**
 * MAIN MENU — name, board colour, skin, create or join.
 *
 * ONE LAYOUT, LANDSCAPE-FIRST. The old file carried three complete layouts
 * (desktop, mobile portrait, mobile landscape) behind `useIsMobile` /
 * `useIsLandscape`, each with its own copy of the same six controls and its own
 * opinion about where they went. The kit's geometry is landscape-first by
 * construction — SafeBox is a symmetric 47/47/0/21, the columns are 250/250/250,
 * the tap floors are 44/48 — so the branching is gone rather than ported. That
 * branching is what the redesign exists to remove.
 *
 * NO 3D BEHIND IT. GameScene is lazy and only mounts in-game (~1MB gzip); a
 * live board behind the menu would drag that chunk onto the app's first paint.
 * `SHELL_BACKDROP` is the flat treatment that stands in for it.
 *
 * LEFT IS WHO YOU ARE, RIGHT IS WHAT YOU DO. Brand and the equipped-identity
 * readout sit in the read-only left column; every control is in the right
 * third, where a two-thumb landscape grip mis-taps ~9.75% against ~12.85% on
 * the left.
 */
export function MainMenu() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const selectedCharacter = useGameStore((s) => s.selectedCharacter);
  const selectedCharacterColor = useGameStore((s) => s.selectedCharacterColor);
  // Board-identity colour persists in the store so the CharacterSelect locker
  // and this menu stay in sync.
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
    const onRejected = (d: S_RoomRejected) => { setError(d.reason); };
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

  return (
    <div style={{ ...SHELL_STAGE, ...NEUTRAL_TURN }}>
      <i style={SHELL_BACKDROP} aria-hidden="true" />

      <SafeBox>
        <ZoneRead>
          <div style={brandSlot}>
            <Wordmark>Mockopoly</Wordmark>
            <p style={tagline}>Buy the board.<br />Bankrupt your friends.</p>
            <Rule style={{ margin: '6px 0' }} />
            {/*
              The equipped skin is READ-ONLY here on purpose. Choosing one is a
              whole screen; naming the current one is a fact, and facts live in
              the read-only column. The button that opens the locker is in the
              right third with the other controls.
            */}
            <div style={CAP_LINE}>Playing as</div>
            <div style={identityRow}>
              <i style={identityDot(TOKEN_HEX[token])} aria-hidden="true" />
              <span className="kit-trunc" style={identityName}>{charDef.name}</span>
            </div>
          </div>
        </ZoneRead>

        {/*
          The centre third is display-only by construction (ZoneMid forces
          pointer-events:none on everything inside it), which is exactly right
          for a rejection notice: it must be impossible to miss and impossible
          to tap. Bottom-anchored so it never lands on the controls.
        */}
        <ZoneMid>
          <div style={noticeSlot}>
            <Toast open={error !== null} tone="bad" style={noticeCap}>{error}</Toast>
          </div>
        </ZoneMid>

        <div style={COL_ACT}>
          <Field
            value={name}
            onChange={setName}
            placeholder="Your name"
            maxLength={16}
            inputProps={{ autoComplete: 'nickname', autoCapitalize: 'words', name: 'playerName' }}
          />

          {/*
            THE PICKER AND THE LOCKER BUTTON SHARE A ROW, and that is a measured
            decision, not a flourish. 194 (picker) + 12 (dead space) + 44 (icon)
            = 250, the column's exact width. Stacked, they cost 56px more, and
            the join pane — name 44, this row 94, mode 50, code 44, join 48 plus
            five 12px gaps — already comes to 340 of the 345 the column has.
          */}
          <div style={pickRow}>
            <TokenPicker value={token} onChange={setToken} />
            <Button
              variant="icon"
              glyph={<UserRound size={17} aria-hidden />}
              sub="SKIN"
              ariaLabel="Choose character"
              onClick={() => { navigate('/character-select'); }}
            />
          </div>

          <div style={segsRow}>
            <Segs
              value={mode}
              onChange={setMode}
              ariaLabel="Create or join a room"
              options={[{ value: 'create', label: 'Create' }, { value: 'join', label: 'Join' }]}
            />
          </div>

          {mode === 'create' ? (
            <Button
              variant="gold"
              block
              sheen
              label="Create room"
              disabled={!canCreate}
              onClick={create}
            />
          ) : (
            <>
              <CodeInput value={code} onChange={setCode} ariaLabel="Room code" style={codeBox} />
              <Button
                variant="gold"
                block
                sheen
                label="Join room"
                disabled={!canJoin}
                onClick={join}
              />
            </>
          )}
        </div>
      </SafeBox>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GEOMETRY
// ────────────────────────────────────────────────────────────────────────────

/** Vertically centred in the 369px column, 4px in from the safe line — the
 *  wordmark's 24px drop-shadow needs interior offset, not more inset. */
const brandSlot: KitStyle = {
  position: 'absolute',
  inset: 0,
  paddingLeft: 4,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: KIT.sp2,
};

const tagline: KitStyle = {
  margin: 0,
  maxWidth: 220,
  font: `400 ${KIT.fsLabelLg}/${KIT.lhBody} ${KIT.font}`,
  color: KIT.text2,
  textShadow: KIT.textLegible,
};

const identityRow: KitStyle = { display: 'flex', alignItems: 'center', gap: KIT.sp2, minWidth: 0 };

function identityDot(hex: string): KitStyle {
  return {
    width: 12,
    height: 12,
    flex: '0 0 auto',
    borderRadius: '50%',
    background: `radial-gradient(circle at 33% 28%, #fff 0%, ${hex} 34%, rgb(0 0 0 / 62%) 118%)`,
    boxShadow: `0 0 12px 2px ${hex}`,
  };
}

const identityName: KitStyle = {
  font: `700 ${KIT.fsGlance}/${KIT.lhTight} ${KIT.font}`,
  color: KIT.text,
  textShadow: KIT.textLegible,
};

/** Bottom-anchored in the display-only centre band, clear of the control column. */
const noticeSlot: KitStyle = {
  position: 'absolute',
  left: '50%',
  bottom: KIT.sp4,
  transform: 'translateX(-50%)',
  display: 'flex',
  justifyContent: 'center',
};

/** `.kit-toast` is 300px wide at most; the display-only band is 250, and a
 *  toast wider than its band would reach under the action column. */
const noticeCap: KitStyle = { maxWidth: 246 };

/** 194 + 12 + 44 = 250. See the note at the call site. */
const pickRow: KitStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: KIT.tapGap,
};

/** `Segs` is inline-flex and its items do not stretch, so it is centred at its
 *  natural width rather than stretched into a wide box of two small buttons. */
const segsRow: KitStyle = { display: 'flex', justifyContent: 'center' };

/** `.kit-code` is inline-flex and left-packed; stretched to the column width by
 *  the flex column, its six cells would hug the left edge. */
const codeBox: KitStyle = { display: 'flex', justifyContent: 'center' };
