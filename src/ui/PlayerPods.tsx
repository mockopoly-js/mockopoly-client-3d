import { useGameStore } from '../state/gameStore';
import { TOKEN_HEX } from '../constants/theme';
import type { Player } from '../types/GameState';
import { Badge, KIT, Money, Pod, SafeBox, ZoneRead } from './kit';
import type { KitStyle } from './kit';
import { useHudStandDown } from './takeoverStage';

/** One GO salary. Below this a pod's cash renders in the `low` tone + LOW badge. */
const LOW_CASH = 2_000_000;

/**
 * Opponent rows, top of the read-only LEFT column.
 *
 * WHO IS IN THE LIST. Opponents only, plus myself if I have gone bankrupt (the
 * mockup's spectate state, where my own OUT row is the point). My name, my cash
 * and my jail state live in the centre readout that TurnHud owns, so a pod for
 * myself would be a second, competing copy of all three — and with four players
 * it is the row that pushes the pod band into the set strip below it.
 *
 * WHOSE-TURN, CUE 2 OF 3. `isTurn` gives the active player's row the colour wash
 * and ring. The other two cues are TurnHud's turn strip and the screen-edge
 * perimeter; a single subtle cue is the documented failure.
 */
export function PlayerPods() {
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const currentId = useGameStore((s) => s.state?.turn.currentPlayerId);
  const myId = useGameStore((s) => s.myPlayerId);
  // THE POD BAND IS THE ONE THIS WAS MEASURED ON. With only TurnHud yielding,
  // the takeover screenshot still showed pod ghosts printing behind the YOU
  // GIVE column at up to 12.9/255 — a swatch, a name and a live cash value are
  // exactly the kind of bright, high-contrast content the 95%-at-top-centre
  // fill leaks. See `useHudStandDown` for the whole rationale.
  const standDown = useHudStandDown();

  const me = players.find((p) => p.id === myId);
  const rows = players.filter((p) => p.id !== myId || (me?.isBankrupt ?? false));

  if (rows.length === 0) return null;

  return (
    <div style={{ ...stage, ...standDown.style }} aria-hidden={standDown.ariaHidden}>
      <SafeBox>
        <ZoneRead style={zonePad}>
          <div style={column}>
            {rows.map((p) => (
              <Pod
                key={p.id}
                name={p.name}
                color={TOKEN_HEX[p.token]}
                swatch
                glass
                isTurn={p.id === currentId && !p.isBankrupt}
                isOut={p.isBankrupt}
                isOffline={!p.isConnected && !p.isBankrupt}
                value={
                  <Money
                    value={p.money}
                    size="glance"
                    tone={p.money < LOW_CASH ? 'low' : 'default'}
                    digits={3}
                    legible
                  />
                }
                badges={badgesFor(p, p.id === myId)}
              />
            ))}
          </div>
        </ZoneRead>
      </SafeBox>
    </div>
  );
}

/**
 * At most two badges per row. A pod is 40px with a 13px name and a 15px cash
 * value already competing for 250px, and a badge is supporting information —
 * bankruptcy and disconnection are also carried by the row's own treatment.
 */
function badgesFor(p: Player, isMe: boolean) {
  const out: React.ReactNode[] = [];
  if (p.isBankrupt) {
    out.push(<Badge key="out" tone="out">Bankrupt</Badge>);
  } else {
    if (!p.isConnected) out.push(<Badge key="off" tone="offline">Offline</Badge>);
    if (p.isJailed) out.push(<Badge key="jail" tone="jail" bars>Jail</Badge>);
    if (out.length < 2 && p.money < LOW_CASH) out.push(<Badge key="low" tone="warn">Low</Badge>);
    if (out.length === 0 && isMe) out.push(<Badge key="you">You</Badge>);
  }
  return out.length > 0 ? out.slice(0, 2) : undefined;
}

/**
 * The kit's surfaces are `position:absolute` and assume a positioned, full-size
 * ancestor; App.tsx mounts this as a bare sibling, so it supplies its own.
 * Sits at --z-hud-under: the read column must never win against the action
 * cluster or the expanded log.
 */
const stage: KitStyle = {
  position: 'fixed', inset: 0, zIndex: KIT.zHudUnder, pointerEvents: 'none',
};
/**
 * Measured from the mockup: the pod band starts at y 40 inside the safe box.
 * The 4px left offset is INTERIOR, not stacked onto --sa-l — the flat token's
 * 0 0 14px 2px glow crossed the safe line at x=0.
 *
 * The padding does not widen the zone: `index.css` sets border-box globally, so
 * `.kit-zone-read`'s 250px is its OUTER width. Before that reset this style
 * carried its own `boxSizing` because the pods measured 254px and their right
 * edge poked out from under the expanded event log, which is exactly
 * --zone-read-w wide.
 */
const zonePad: KitStyle = { padding: '40px 0 0 4px' };
const column: KitStyle = { display: 'flex', flexDirection: 'column', gap: KIT.sp1 };
