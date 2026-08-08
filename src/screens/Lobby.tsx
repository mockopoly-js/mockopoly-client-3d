import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore, selectMyPlayer } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import { TOKEN_HEX } from '../constants/theme';
import type { Player } from '../types/GameState';
import {
  Badge, Button, KIT, Pod, Rule, SafeBox, Switch, ZoneMid, ZoneRead, ZoneTop,
} from '../ui/kit';
import type { KitStyle } from '../ui/kit';
import { CAP_LINE, COL_ACT, NEUTRAL_TURN, SHELL_BACKDROP, SHELL_STAGE } from './shellChrome';

/**
 * LOBBY — who is at the table, who is ready, and the code that gets them here.
 *
 * ONE LAYOUT. Like the menu, this replaced three (desktop / portrait /
 * landscape) that disagreed with each other; the kit's geometry is
 * landscape-first, so there is nothing left to branch on.
 *
 * THE THREE COLUMNS EARN THEIR SPLIT HERE MORE THAN ANYWHERE:
 *   left   — the other seats. Read-only by definition: you cannot ready up on
 *            someone else's behalf, so nothing there is tappable.
 *   centre — the room code. Display-only, and the code is the one place in the
 *            whole system that uses the mono face. During the countdown the
 *            same band becomes the numeral, because nothing is interactive then
 *            either.
 *   right  — MY seat, my ready switch, and the host's controls.
 *
 * WHO IS WHO IS CARRIED THREE WAYS, never by colour alone: the pod's own left
 * bar in the player's token colour, a badge (HOST / READY / OFFLINE), and — for
 * a disconnect — the kit's `is-offline` treatment, which desaturates the chrome
 * without ever putting opacity on the name (rule R3).
 */
export function Lobby() {
  const state = useGameStore((s) => s.state);
  const roomCode = useGameStore((s) => s.roomCode);
  const setScreen = useGameStore((s) => s.setScreen);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const players: Player[] = state?.players ?? [];
  const myId = useGameStore((s) => s.myPlayerId);
  const me = useGameStore(selectMyPlayer);
  const isHost = me?.isHost ?? false;
  const status = state?.status;
  // devHacks is typed non-optional on GameState but real server snapshots (and
  // partial lobby states) can arrive without it, so the optional chain guards a
  // genuine runtime path — do NOT collapse it.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- state.devHacks may be absent on early/partial snapshots
  const soloPlay = state?.devHacks?.soloPlay ?? false;

  // route into the game once the server flips to in-progress
  useEffect(() => {
    if (status === 'in-progress') setScreen('game');
  }, [status, setScreen]);

  // ephemeral countdown ticks
  useEffect(() => {
    const onTick = (d: { seconds: number }) => { setCountdown(d.seconds); };
    gameBus.on('countdown', onTick);
    return () => { gameBus.off('countdown', onTick); };
  }, []);

  // The copy confirmation is the only feedback a clipboard write ever gives —
  // it has to time out, or the button lies about the next tap.
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => { setCopied(false); }, 1600);
    return () => { clearTimeout(id); };
  }, [copied]);

  const toggleReady = () => socketManager.emit(EVENTS.ROOM_READY, { isReady: !me?.isReady });
  const start = () => socketManager.emit(EVENTS.ROOM_START);
  const leave = () => { socketManager.emit(EVENTS.ROOM_LEAVE); useGameStore.getState().reset(); };
  // navigator.clipboard is typed non-optional but is genuinely absent in
  // insecure contexts / older browsers; guard it, and `void` the returned
  // promise (fire-and-forget; copy failure is non-critical).
  const copyCode = () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- navigator.clipboard can be undefined at runtime (insecure context / old browser)
    if (roomCode !== null && navigator.clipboard) void navigator.clipboard.writeText(roomCode);
    setCopied(true);
  };

  const locked = status === 'starting';
  // config, like devHacks, is typed non-optional but can be absent on partial
  // snapshots; keep the optional chain (falls back to 4 max players).
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- state.config may be absent on early/partial snapshots
  const maxPlayers = state?.config?.maxPlayers ?? 4;

  const others = players.filter((p) => p.id !== myId);
  const openSeats = Math.max(0, maxPlayers - players.length);
  const readyCount = players.filter((p) => p.isReady).length;
  const minPlayers = soloPlay ? 1 : 2;
  const counting = countdown !== null && status === 'starting';

  return (
    <div style={{ ...SHELL_STAGE, ...NEUTRAL_TURN }}>
      <i style={SHELL_BACKDROP} aria-hidden="true" />

      <SafeBox>
        <ZoneTop style={zoneTopPad}>
          <Button
            variant="icon"
            bare
            glyph={<X size={18} aria-hidden />}
            ariaLabel="Leave lobby"
            disabled={locked}
            onClick={leave}
          />
        </ZoneTop>

        <ZoneRead>
          <div style={seatSlot}>
            <div style={CAP_LINE}>{`Table · ${players.length}/${maxPlayers}`}</div>
            {others.map((p) => (
              <Pod
                key={p.id}
                name={p.name}
                color={TOKEN_HEX[p.token]}
                swatch
                glass
                isOffline={!p.isConnected}
                badges={
                  !p.isConnected
                    ? <Badge tone="offline">Offline</Badge>
                    : p.isHost
                      ? <Badge tone="gold">Host</Badge>
                      : p.isReady
                        ? <Badge tone="good">Ready</Badge>
                        : <Badge>Waiting</Badge>
                }
              />
            ))}
            {Array.from({ length: openSeats }, (_, i) => (
              <div key={`open-${i}`} style={openSeat}>Open seat</div>
            ))}
          </div>
        </ZoneRead>

        <ZoneMid>
          <div style={codeSlot}>
            {counting ? (
              <>
                <div className="kit-eyebrow">Game starting</div>
                <div
                  style={countNumeral}
                  data-testid="countdown"
                  role="status"
                  aria-live="assertive"
                  aria-label={`Starting in ${countdown} seconds`}
                >
                  {countdown}
                </div>
                <div style={codeHint}>Get ready</div>
              </>
            ) : (
              <>
                <div className="kit-eyebrow">Room code</div>
                <div style={codeMark}>{roomCode ?? '——————'}</div>
                <div style={codeHint}>Share this to invite friends</div>
              </>
            )}
          </div>
        </ZoneMid>

        <div style={COL_ACT}>
          {/*
            MY SEAT IS NOT A <Pod>. A pod is a compact 40px READ-ONLY row — right
            for the other players, too small for the one seat that has to hold a
            host badge and a real 44px switch. Same materials, more room.
          */}
          <div style={CAP_LINE}>Your seat</div>
          <div style={mySeat(me ? TOKEN_HEX[me.token] : KIT.text3)}>
            <div style={mySeatTop}>
              <i style={seatDot(me ? TOKEN_HEX[me.token] : KIT.text3)} aria-hidden="true" />
              <span className="kit-trunc" style={mySeatName}>{me?.name ?? 'You'}</span>
              {isHost && <Badge tone="gold">Host</Badge>}
            </div>
            <Switch
              checked={me?.isReady ?? false}
              onChange={toggleReady}
              ariaLabel="Ready"
              label="Ready"
            />
          </div>

          {isHost && !locked && (
            <Switch
              checked={soloPlay}
              ariaLabel="Solo play"
              label="Solo play"
              onChange={(next) => socketManager.emit(EVENTS.DEV_SET_HACK, { hack: 'soloPlay', enabled: next })}
            />
          )}

          <Rule />

          <Button
            variant="secondary"
            block
            label={copied ? 'Code copied' : 'Copy code'}
            disabled={roomCode === null}
            onClick={copyCode}
          />

          {isHost ? (
            <Button
              variant="gold"
              block
              sheen
              label={`Start · ${readyCount}/${players.length} ready`}
              disabled={locked || players.length < minPlayers}
              onClick={start}
            />
          ) : (
            <Button variant="primary" block waiting label={locked ? 'Starting…' : 'Waiting for host'} />
          )}
        </div>
      </SafeBox>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GEOMETRY
// ────────────────────────────────────────────────────────────────────────────

/** 4px of INTERIOR offset, not stacked onto --sa-l: the bare icon button's own
 *  ring would otherwise sit on the safe line. */
const zoneTopPad: KitStyle = { padding: '4px 0 0 2px' };

/** Vertically centred, 4px in from the safe line. Four seats at 40-44px plus a
 *  caption is ~200px in a 369px column, so centring never overflows. */
const seatSlot: KitStyle = {
  position: 'absolute',
  inset: 0,
  paddingLeft: 4,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: KIT.sp1,
};

const openSeat: KitStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 32,
  borderRadius: KIT.rSm,
  border: `1.5px dashed ${KIT.borderSoft}`,
  font: `600 ${KIT.fsMicro}/1.22 ${KIT.font}`,
  textTransform: 'uppercase',
  letterSpacing: KIT.lsWider,
  color: KIT.text2,
};

/** The centre band, vertically centred and inert (ZoneMid forces that). */
const codeSlot: KitStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  textAlign: 'center',
};

/** THE ONE MONO USE IN THE SYSTEM. A room code is read aloud and typed back in
 *  character by character, so its glyphs have to be unambiguous and evenly set. */
const codeMark: KitStyle = {
  // Longhands, not the `font` shorthand: a shorthand carrying var() becomes a
  // pending-substitution value that reads back as an empty string, which makes
  // "is the room code actually in the mono face" untestable.
  fontFamily: KIT.fontMono,
  fontSize: KIT.fsHeroLg,
  fontWeight: 800,
  lineHeight: KIT.lhFlat,
  letterSpacing: KIT.lsWidest,
  color: KIT.goldBright,
  textShadow: KIT.textLegible,
};

/**
 * --text-display is the scale's ceiling (32px) and a countdown numeral is one
 * of its named uses. Rather than invent a bigger token, the DECLARED size stays
 * exactly 32 and `transform: scale()` does the rest — the type scale is never
 * violated, and nothing else on the screen learns a new size.
 */
const countNumeral: KitStyle = {
  font: `800 ${KIT.fsDisplay}/${KIT.lhFlat} ${KIT.font}`,
  color: KIT.goldBright,
  textShadow: `0 2px 0 rgb(0 0 0 / 75%), 0 0 32px ${KIT.goldGlow}`,
  transform: 'scale(2.2)',
  margin: '18px 0',
  fontVariantNumeric: 'tabular-nums',
};

const codeHint: KitStyle = {
  font: `500 ${KIT.fsLabel}/${KIT.lhSnug} ${KIT.font}`,
  color: KIT.text2,
  textShadow: KIT.textLegible,
};

/**
 * MY seat: the pod's materials at the size a switch needs.
 *
 * Lit in MY token colour, taken directly rather than through `--turn`. There is
 * no turn in a lobby, and overloading the turn variable to mean "me" here would
 * make the same cue mean two different things in two places.
 */
function mySeat(hex: string): KitStyle {
  return {
    borderRadius: KIT.rLg,
    padding: `${KIT.sp2} ${KIT.rowPad}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    background: 'linear-gradient(180deg, rgb(28 30 48 / 62%), rgb(9 10 18 / 58%))',
    // 8px blur (10px reach), not 20: this sits inside a column with 12px of
    // block padding, and a 22px reach would clip against the stage edge.
    boxShadow: `inset 0 0 0 1px ${hex}, ${KIT.liftTop}, 0 0 8px 2px color-mix(in srgb, ${hex} 34%, transparent)`,
  };
}

const mySeatTop: KitStyle = { display: 'flex', alignItems: 'center', gap: KIT.sp2, minHeight: 22 };

const mySeatName: KitStyle = {
  flex: 1,
  minWidth: 0,
  font: `700 ${KIT.fsLabelLg}/${KIT.lhSnug} ${KIT.font}`,
  textTransform: 'uppercase',
  letterSpacing: KIT.lsWide,
  color: KIT.text,
};

function seatDot(hex: string): KitStyle {
  return {
    width: 14,
    height: 14,
    flex: '0 0 auto',
    borderRadius: '50%',
    background: `radial-gradient(circle at 33% 28%, #fff 0%, ${hex} 34%, rgb(0 0 0 / 62%) 118%)`,
    boxShadow: `0 0 14px 2px ${hex}, inset 0 -3px 6px rgb(0 0 0 / 55%)`,
  };
}
