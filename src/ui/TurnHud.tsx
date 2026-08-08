import { useState } from 'react';
import { LayoutList, MoreHorizontal, ScrollText, X } from 'lucide-react';
import { useGameStore, selectMyPlayer, selectIsMyTurn, selectCurrentPlayer } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { EVENTS } from '../types/SocketEvents';
import { TOKEN_HEX } from '../constants/theme';
import type { TurnPhase } from '../types/GameState';
import {
  Badge, BtnRow, Button, KIT, Money, SP_PX, SafeBox, TurnStrip,
  ZoneAct, ZoneMid, ZoneTop, turnStyle,
} from './kit';
import type { KitStyle } from './kit';
import { ActionsSheet } from './ActionsSheet';
import { GoLoanPill } from './GoAdvancePanel';
import { useActionBadges } from './useActionBadges';
import { useHudStandDown } from './takeoverStage';

/**
 * THE IN-GAME HUD SHELL — turn strip, turn edge, centre readout, action cluster.
 * Ported from the approved `s2-hud.html`, built entirely on the kit primitives.
 *
 * WHY THERE IS NO MOBILE BRANCH ANY MORE. The kit's geometry is landscape-first
 * by construction (SafeBox is symmetric 47/47/21, the zones are 250/250/250, the
 * tap floors are 44/48) and none of its primitives call `useIsMobile`. The old
 * file carried two complete layouts — a centred desktop pill bar and a mobile
 * cluster — that disagreed about where every value lived. One layout is now
 * correct on both.
 *
 * CROSS-COMPONENT INTENTS. `PropertyListPanel` and `GameLog` are mounted as
 * separate siblings in App.tsx, so the DEEDS and LOG buttons in this cluster
 * cannot call into them directly. They publish on the existing `gameBus`, which
 * is already the app's channel for one-shot UI intents (GameStateSync emits
 * 'open-negotiation' the same way).
 */
/** Toggle the right-hand deeds panel (owner: PropertyListPanel). */
export const HUD_TOGGLE_DEEDS = 'hud:toggle-deeds';
/** Toggle the bottom-left expanded event log (owner: GameLog). */
export const HUD_TOGGLE_LOG = 'hud:toggle-log';

/** Jail fine, mirroring the server's `rules.ts` JAIL_FINE. */
const JAIL_FINE = 500_000;
/** Third failed attempt forces the fine — the counter the player never saw. */
const JAIL_MAX_TURNS = 3;
/** Third double sends you to jail. */
const DOUBLES_LIMIT = 3;
/** One GO salary. Below this a cash value renders in the `low` tone. */
const LOW_CASH = 2_000_000;

/**
 * PARTIAL on purpose. `TurnState.phase` is required by the contract, but the
 * HUD renders off a snapshot that arrives over a socket: a partial or
 * out-of-contract payload must degrade to a vague phase line, never take the
 * whole app down with it. `phaseWord()` supplies the fallback.
 */
const PHASE_MINE: Partial<Record<TurnPhase, string>> = {
  waiting: 'Roll to move',
  rolling: 'Rolling',
  moving: 'Moving',
  landing: 'Landing',
  action: 'Your move',
  end: 'End your turn',
};
const PHASE_THEIRS: Partial<Record<TurnPhase, string>> = {
  waiting: 'To roll',
  rolling: 'Rolling',
  moving: 'Moving',
  landing: 'Landing',
  action: 'Deciding',
  end: 'Ending turn',
};

function phaseWord(phase: TurnPhase, mine: boolean): string {
  return (mine ? PHASE_MINE : PHASE_THEIRS)[phase] ?? (mine ? 'Your turn' : 'Playing');
}

export function TurnHud() {
  const me = useGameStore(selectMyPlayer);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const current = useGameStore(selectCurrentPlayer);
  const myId = useGameStore((s) => s.myPlayerId);
  const turn = useGameStore((s) => s.state?.turn);
  const properties = useGameStore((s) => s.state?.properties);
  const freeParkingPool = useGameStore((s) => s.state?.freeParkingPool ?? 0);
  const actionBadges = useActionBadges();
  const standDown = useHudStandDown();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!turn) return null;

  const isJailed = me?.isJailed ?? false;
  const jailTurns = me?.jailTurns ?? 0;
  const jailCardCount = me?.jailCardCount ?? 0;
  const doubles = turn.doublesCount;
  const isOut = me?.isBankrupt ?? false;
  const myMoney = me?.money ?? 0;

  const canRoll = isMyTurn && turn.phase === 'waiting' && !turn.hasRolled && !isOut;
  const canEnd = isMyTurn && (turn.phase === 'action' || turn.phase === 'end') && !isOut;
  const showJailActions = canRoll && isJailed;

  // Server handles jailed-roll logic internally inside the TURN_ROLL_DICE handler.
  const roll = () => socketManager.emit(EVENTS.TURN_ROLL_DICE);
  const end = () => socketManager.emit(EVENTS.TURN_END);
  const payFine = () => socketManager.emit(EVENTS.JAIL_PAY_FINE);
  const useCard = () => socketManager.emit(EVENTS.JAIL_USE_CARD);

  // ── CUE 1 of 3: the text of record ───────────────────────────────────────
  const who = isOut ? 'Spectating' : isMyTurn ? 'Your turn' : `${current?.name ?? '…'}'s turn`;
  const phase = buildPhase({
    isOut, isMyTurn, isJailed, jailTurns, doubles,
    phase: turn.phase,
    dice: turn.diceValues,
    currentName: current?.name,
  });

  // ── CUE 2 of 3: the pod ring, owned by PlayerPods ────────────────────────
  // ── CUE 3 of 3: a 2px saturated perimeter in the active player's colour ──
  const turnHex = current ? TOKEN_HEX[current.token] : TOKEN_HEX.blue;
  const myPropertyCount = (properties ?? []).filter((p) => p.ownerId === myId).length;

  const primary = buildPrimary({ isOut, isMyTurn, canRoll, canEnd, isJailed, turn, current });

  return (
    <div
      // The stand-down covers <ActionsSheet> too, and by inheritance rather
      // than by a second flag: the sheet is a child of <ZoneAct> inside this
      // stage, so the opacity group and the inherited `visibility:hidden` take
      // it and its fixed full-viewport tap-catcher with them. It stays OPEN
      // underneath and comes back exactly as it was.
      style={{ ...stage, ...standDown.style, ...turnVars(turnHex) }}
      aria-hidden={standDown.ariaHidden}
    >
      <i style={isOut ? edgeOut : edgeLive} aria-hidden="true" />

      <SafeBox>
        {/*
          ONE BADGE, AND BOTH STRIP SLOTS TRUNCATE. MEASURED at 844x390: the
          right column claims x 492..742 of the safe box, and this row starts at
          x 4 — three badges beside a long jail phase ran to x 552 and the third
          was buried under the first toast. The strip's own width is now bounded
          (130 + 230 + its fixed chrome = 414) and only the highest-priority
          state badges, so the row can never reach that column. (The toast stack
          has since dropped to y 60 to clear the chrome row, and the chrome row
          itself now occupies y 8..52 from x 649 — still well right of 465,
          which is where a maximum-width strip ends.)
        */}
        <ZoneTop style={zoneTopPad}>
          <div style={topRow}>
            <TurnStrip
              who={<span style={truncWho}>{who}</span>}
              phase={<span style={truncPhase}>{phase}</span>}
              color={turnHex}
            />
            {isOut
              ? <Badge tone="out">You are out</Badge>
              : isJailed
                ? <Badge tone="jail" bars>Jail</Badge>
                /* GAP 5 — the doubles counter was tracked server-side and never
                   displayed anywhere. The gold phase line is its primary
                   carrier; this is the supporting confirmation. */
                : doubles > 0
                  ? <Badge tone="warn">{`Doubles ${doubles}/${DOUBLES_LIMIT}`}</Badge>
                  : null}
          </div>
        </ZoneTop>

        {/*
          The centre third is display-only by construction (ZoneMid forces
          pointer-events:none on everything inside it). The mockup engraves my
          cash on the board rail; a rail needs the real projection matrix, which
          the kit deliberately does not ship, so the two money values that matter
          read as one stacked block here instead — same information design, no
          faked 3D.
        */}
        <ZoneMid>
          <div style={potSlot}>
            {freeParkingPool > 0 && (
              <div style={metaItem}>
                <span style={metaCap}>Free parking pot</span>
                <Money value={freeParkingPool} size="glance-lg" tone="gold" digits={3} legible />
              </div>
            )}
            {me && (
              <div style={metaItem}>
                {/*
                  GAP 4 — jailCardCount only ever gated a disabled state; the
                  number was never rendered. It lives on MY identity line rather
                  than in the turn strip because a Get Out of Jail Free card is
                  an asset I hold, it belongs beside my cash, and the centre
                  third has room the top strip does not. The USE CARD button
                  carries it again as a count badge at the moment it decides a tap.
                */}
                <span style={metaCap}>
                  {me.name}
                  {isOut ? ' · out' : isJailed ? ' · in jail' : ''}
                  {jailCardCount > 0 && ` · ${jailCardCount} jail card${jailCardCount === 1 ? '' : 's'}`}
                </span>
                <Money
                  value={myMoney}
                  size="hero"
                  tone={myMoney < LOW_CASH ? 'low' : 'gold'}
                  digits={4}
                  legible
                />
              </div>
            )}
          </div>

          {/*
            THE GO-ADVANCE TRACKER, MOUNTED IN THE HUD AT LAST. Until now it
            only appeared inside negotiation takeovers — which is exactly where
            "you have already sold two salaries" is easiest to forget, because
            by then you are reading somebody else's offer. It renders null for
            anyone who has never taken an advance, so it costs an untouched
            player nothing. Full geometry rationale on `goSlot`.
          */}
          <div style={goSlot}>
            <GoLoanPill player={me} />
          </div>
        </ZoneMid>

        {/*
          THE ACTION COLUMN, BOTTOM-UP: the turn pair, then the three utility
          chips, then the jail row when there is one. <ZoneAct> is a
          bottom-anchored flex column, so the LAST child is the closest to the
          thumb and the reading order below is deliberately top-down-in-source,
          bottom-up-on-screen.
        */}
        <ZoneAct>
          <ActionsSheet open={sheetOpen} onClose={() => { setSheetOpen(false); }} />

          {showJailActions && (
            <BtnRow>
              {/*
                GAP 3/4 in the action slot: the fine is spelled out, and the
                card count rides the button as a gold count badge so the number
                is legible at the one moment it decides the tap.

                THESE TWO KEEP THEIR WORDS while the turn pair below loses its.
                "Pay £500K" is a price and "Use card" spends a finite asset —
                neither has a glyph that says it, and getting either wrong costs
                real money. Only an unambiguous, universal mark earns icon-only
                treatment, which is exactly two marks in this HUD: a die and a ✕.
              */}
              <Button
                label={`Pay ${money(JAIL_FINE)}`}
                ariaLabel="Pay fine"
                disabled={myMoney < JAIL_FINE}
                onClick={payFine}
              />
              <Button
                label="Use card"
                badge={jailCardCount > 0 ? jailCardCount : undefined}
                disabled={jailCardCount === 0}
                onClick={useCard}
              />
            </BtnRow>
          )}

          <BtnRow>
            <Button
              variant="icon"
              glyph={<LayoutList size={17} aria-hidden />}
              sub="DEEDS"
              badge={myPropertyCount > 0 ? myPropertyCount : undefined}
              ariaLabel="My properties"
              onClick={() => gameBus.emit(HUD_TOGGLE_DEEDS)}
            />
            <Button
              variant="icon"
              glyph={<MoreHorizontal size={17} aria-hidden />}
              sub="MORE"
              dot={actionBadges.any ? 'danger' : undefined}
              ariaLabel="More actions"
              onClick={() => { setSheetOpen((o) => !o); }}
            />
            <Button
              variant="icon"
              glyph={<ScrollText size={17} aria-hidden />}
              sub="LOG"
              ariaLabel="Event log"
              onClick={() => gameBus.emit(HUD_TOGGLE_LOG)}
            />
          </BtnRow>

          {/*
            THE TURN PAIR — the bottom row, and the only icon-only controls on
            the HUD. Full rationale on `buildPrimary`; in short, both turn
            actions now live side by side in FIXED positions (die left, ✕
            right) with exactly one of them live, instead of the live one
            holding a single slot and the other dropping to a row of its own.
            A control that never moves is a control you can hit without
            looking, and it costs a row of height that the centre readout
            needed at the bottom of the screen.
          */}
          {primary.waiting ? (
            <Button variant="primary" label={primary.label} waiting />
          ) : (
            <BtnRow>
              <Button
                variant="primary"
                square
                dice
                sheen={primary.action === 'roll'}
                // The jail wording survives the loss of the visible label:
                // `primary.label` is "Roll for doubles" in jail, "Roll dice"
                // otherwise, and that string is now the accessible name.
                ariaLabel={primary.action === 'roll' ? primary.label : 'Roll dice'}
                disabled={primary.action !== 'roll'}
                onClick={roll}
              />
              <Button
                variant="primary"
                square
                glyph={<X size={22} strokeWidth={2.75} aria-hidden />}
                sheen={primary.action === 'end'}
                ariaLabel="End turn"
                disabled={primary.action !== 'end'}
                onClick={end}
              />
            </BtnRow>
          )}
        </ZoneAct>
      </SafeBox>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// DERIVATIONS
// ────────────────────────────────────────────────────────────────────────────

/** `£500K` — the same formatter <Money> splits, for use inside a button label. */
function money(v: number): string {
  return `£${(v / 1000).toFixed(0)}K`;
}

interface PhaseArgs {
  isOut: boolean;
  isMyTurn: boolean;
  isJailed: boolean;
  jailTurns: number;
  doubles: number;
  phase: TurnPhase;
  dice: [number, number] | null;
  currentName: string | undefined;
}

/**
 * The gold phase line. Priority is by urgency, not by category:
 * a jail attempt count outranks a doubles count outranks the dice you just saw.
 */
function buildPhase(a: PhaseArgs): string {
  if (a.isOut) return a.currentName === undefined ? 'Watching' : `${a.currentName}'s turn`;
  // GAP 3 — jailTurns existed only in tests. Attempt 3 of 3 is the forced fine,
  // so the count has to be visible BEFORE it is spent, not after.
  if (a.isJailed) {
    const attempt = Math.min(a.jailTurns + 1, JAIL_MAX_TURNS);
    return attempt >= JAIL_MAX_TURNS
      ? `In jail · last attempt · then ${money(JAIL_FINE)}`
      : `In jail · attempt ${attempt} of ${JAIL_MAX_TURNS}`;
  }
  // GAP 5 — doublesCount was never rendered anywhere in either client.
  if (a.doubles > 0) {
    return a.doubles >= DOUBLES_LIMIT - 1
      ? `Doubles ${a.doubles} of ${DOUBLES_LIMIT} · one more is jail`
      : `Doubles ${a.doubles} of ${DOUBLES_LIMIT} · roll again`;
  }
  // Array.isArray, not `!== null`: the pair arrives straight off the wire and a
  // server that has not rolled yet omits the key entirely rather than nulling it.
  if (Array.isArray(a.dice)) {
    const [d1, d2] = a.dice;
    return `Rolled ${d1} + ${d2} · ${d1 + d2}`;
  }
  return phaseWord(a.phase, a.isMyTurn);
}

interface PrimaryArgs {
  isOut: boolean;
  isMyTurn: boolean;
  canRoll: boolean;
  canEnd: boolean;
  isJailed: boolean;
  turn: { phase: TurnPhase };
  current: { name: string } | undefined;
}
interface PrimaryPlan {
  /**
   * The words. Rendered as a visible label ONLY in the `waiting` states; in
   * the two live states it becomes the icon button's `aria-label`, so it is
   * never merely decorative and never allowed to go vague.
   */
  label: string;
  waiting: boolean;
  action: 'roll' | 'end';
}

/**
 * WHICH OF THE TWO TURN CONTROLS IS LIVE — and the words for it.
 *
 * *** BOTH CONTROLS ARE ALWAYS ON SCREEN, IN FIXED POSITIONS. *** This used to
 * be a single primary slot holding the currently-correct action, with the other
 * one dropped to an inert secondary row above it. That kept the hammered corner
 * useful but moved the meaning of a fixed pixel: the same coordinate was Roll
 * on one frame and End turn on the next. Now the die and the ✕ each have a
 * permanent home in one bottom row (die left, ✕ right — the order they happen
 * in) and this function only decides which one lights up. Nothing moves, so
 * nothing has to be re-found, and the pair costs one row instead of two.
 *
 * *** ICON-ONLY IS EARNED, NOT DEFAULT. *** A die and a ✕ are the only two
 * marks in this HUD that need no gloss. Everything else that can occupy the
 * action column keeps its words: the jail row prices its own actions
 * ("Pay £500K", "Use card"), and the waiting states below are whole sentences
 * about somebody else — "Konstantina is rolling" is precisely the thing a
 * glyph cannot say. So when no action is correct (mid-move, another player's
 * turn, spectating) the pair is replaced by the kit's `waiting` primary,
 * carrying that sentence, at the same 48px, so the column never jumps.
 */
function buildPrimary(a: PrimaryArgs): PrimaryPlan {
  if (a.isOut) return { label: 'Spectating · no actions', waiting: true, action: 'end' };
  if (a.canRoll) return { label: a.isJailed ? 'Roll for doubles' : 'Roll dice', waiting: false, action: 'roll' };
  if (a.canEnd) return { label: 'End turn', waiting: false, action: 'end' };
  const name = a.current?.name ?? 'Table';
  return {
    label: a.isMyTurn
      ? `${phaseWord(a.turn.phase, true)}…`
      : `${name} is ${phaseWord(a.turn.phase, false).toLowerCase()}`,
    waiting: true,
    // Mid-move (and while another player rolls) the action that becomes
    // available next is End turn, so that is the one this state resolves to.
    action: 'end',
  };
}

/**
 * `turnStyle()` sets `--turn` only, and that is NOT enough on its own: `--turn-
 * soft` / `--turn-faint` are declared on `:root` as `color-mix(… var(--turn) …)`,
 * and a custom property's var() references are substituted where the property is
 * DECLARED. Re-declaring `--turn` on a subtree therefore leaves the derived pair
 * still resolved against the root blue. Both have to be re-derived here.
 */
function turnVars(hex: string): KitStyle {
  return {
    ...turnStyle(hex),
    '--turn-soft': `color-mix(in srgb, ${hex} 30%, transparent)`,
    '--turn-faint': `color-mix(in srgb, ${hex} 13%, transparent)`,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// GEOMETRY
// ────────────────────────────────────────────────────────────────────────────

/**
 * The kit's surfaces are `position:absolute` and assume a positioned, full-size
 * ancestor; App.tsx mounts every HUD component as a bare sibling, so each one
 * has to supply its own. Inert — SafeBox hands pointer events back to its own
 * direct children.
 */
const stage: KitStyle = {
  position: 'fixed', inset: 0, zIndex: KIT.zHud, pointerEvents: 'none',
};

/*
 * THE STAND-DOWN UNDER A TAKEOVER used to live here as a local pair of style
 * objects. It is now `useHudStandDown()` in `./takeoverStage`, unchanged, with
 * the full rationale on it — because the fix was never a TurnHud fix: standing
 * this stage down alone still left player-pod ghosts behind the takeover's
 * verdict column, and every other HUD-layer surface is its own fixed stage that
 * has to yield for itself. One mechanism, one definition, seven callers.
 */

/** 2468px of saturated line at the screen edge, where peripheral colour
 *  sensitivity is highest. Everything travels INWARD, so nothing overhangs. */
const edgeBase: KitStyle = {
  position: 'absolute', inset: 0, zIndex: KIT.zHudUnder, pointerEvents: 'none',
  transition: `box-shadow ${KIT.durLight} ${KIT.easeIo}, background ${KIT.durLight} ${KIT.easeIo}`,
};
const edgeLive: KitStyle = {
  ...edgeBase,
  boxShadow: `inset 0 0 0 2px ${KIT.turn}`,
  background: [
    `linear-gradient(180deg, ${KIT.turnFaint}, transparent) top left / 100% 22px no-repeat`,
    `linear-gradient(0deg, ${KIT.turnFaint}, transparent) bottom left / 100% 22px no-repeat`,
  ].join(', '),
};
/** Spectating: same line, same place, DASHED. A texture change rather than a
 *  colour change still reports whose turn it is while reading "not your game". */
const edgeOut: KitStyle = {
  ...edgeBase,
  background: [
    `repeating-linear-gradient(90deg, ${KIT.turn} 0 11px, transparent 11px 22px) top left / 100% 2px no-repeat`,
    `repeating-linear-gradient(90deg, ${KIT.turn} 0 11px, transparent 11px 22px) bottom left / 100% 2px no-repeat`,
    `repeating-linear-gradient(180deg, ${KIT.turn} 0 11px, transparent 11px 22px) top left / 2px 100% no-repeat`,
    `repeating-linear-gradient(180deg, ${KIT.turn} 0 11px, transparent 11px 22px) top right / 2px 100% no-repeat`,
  ].join(', '),
};

/** 4px of INTERIOR offset, not stacked onto --sa-l: the turn-strip dot's
 *  10px/2px glow spread crossed the safe line by 2-4px at x=0. */
const zoneTopPad: KitStyle = { padding: '6px 0 0 4px' };
const topRow: KitStyle = { display: 'flex', alignItems: 'center', gap: KIT.sp2 };
/** Hard bounds on the strip, so no player name and no phase string can push the
 *  row into the toast band. Ellipsis, never wrap: the row is 26px tall. */
const truncWho: KitStyle = {
  display: 'block', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const truncPhase: KitStyle = { ...truncWho, maxWidth: 230 };

/**
 * THE BOTTOM-CENTRE BAND, AND THE GO PILL IS STACKED UNDER IT DELIBERATELY.
 *
 * `bottom` used to be 60, which put my cash at y 270..309 of 390 — floating in
 * the lower-middle of the board with a 60px strip of nothing under it, and it
 * read as too high on device. The band it wants is the one the event log
 * (bottom-left) and the action cluster (bottom-right) already occupy, so this
 * now sits on the same bottom line between them.
 *
 * *** WHY 34 AND NOT 0. *** `.rn-golock` is exactly 26px tall (rules.css §10)
 * and <GoLoanPill> sits at `bottom: 0` directly beneath this. 26 + --sp-2 is
 * the band it needs, and this slot RESERVES IT UNCONDITIONALLY — including for
 * the majority of players, who never take a GO advance and for whom the pill
 * renders null. That is the whole point: the alternative (one flex column, or
 * an offset that collapses when the pill is absent) moves my cash 34px up the
 * screen the first time a loan starts, which is the exact moment I am reading
 * it. A 34px strip of empty space below the cash costs nothing; a hero value
 * that jumps under the eye costs the read.
 *
 * MEASURED at 844x390 / 47-21 insets with both values and the pill live: the
 * block runs y 231..335, the pill 343..369, and the cash line's own box is
 * x 372..472 — clear of <GameLog> (ends x 297), clear of the action cluster's
 * leftmost painted control (x 612) and clear of the pill's 296..548 band.
 * Still bottom-anchored, so the pot appearing grows the block UPWARD and the
 * cash line itself never moves.
 */
const GO_PILL_H = 26;
const potSlot: KitStyle = {
  position: 'absolute', left: '50%', bottom: GO_PILL_H + SP_PX[2], transform: 'translateX(-50%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: KIT.sp2,
};
const metaItem: KitStyle = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
};

/**
 * THE GO-ADVANCE PILL'S SLOT — bottom-centre, and every other candidate was
 * MEASURED AND REJECTED at 844x390. The pill is 256px wide (329 with `full`),
 * which is wider than every hole this layout has:
 *
 *   ZoneTop, beside the strip   the strip is bounded at 414 and the toast band
 *                               starts at x 539; a jail phase plus a badge plus
 *                               a 256px pill runs past it. (Requested here, and
 *                               it is where rules.css says the pill was designed
 *                               to sit — but rules.css was written before this
 *                               row had a measured bound.)
 *   ZoneTop, a second row       y 33..59, and the opponent pods start at y 40.
 *                               A tracker printed over the first opponent's row
 *                               trades one overlap bug for another.
 *   top of the centre stack     grows the block UPWARD from y 204 to y 170, and
 *                               <BigMomentOverlay>'s card is at y 100..190.
 *
 * The band under my cash is the only one left, and it is also the right one on
 * the merits: this is a claim on my FUTURE INCOME, it belongs against my cash,
 * and it is display-only — which is what the centre third is for, and what
 * `.rn-golock`'s own `pointer-events:none` already assumes.
 *
 * A SEPARATE SLOT, NOT THE LAST CHILD OF `potSlot`. Appending it to that stack
 * would push the pot and my cash 34px up the screen the moment a loan starts.
 * This is anchored to the bottom independently and `potSlot` reserves this
 * band whether or not the pill renders, so the two money values never move.
 *
 * `bottom: 0` — the FLOOR OF THE SAFE BOX, not of the screen. `.kit-safe`
 * already holds `max(var(--sa-b), --sp-3)` back from the physical edge, so
 * this is 12px clear on desktop and 21px clear on an iPhone 13 Pro with no
 * arithmetic here. It was 20, which stacked a second gutter on top of the
 * first and is the space my cash needed.
 *
 * MEASURED CLEARANCES at 844x390 / 47-21 insets: the pill spans x 296..548 and
 * y 343..369. The read column ends at x 297 (1px, and no pod or log glyph
 * reaches its own right edge) and the action cluster's leftmost painted
 * control starts at x 612. It touches nothing that paints. `full` is NOT
 * passed for exactly this reason: at 329px it starts at x 258 and lands on the
 * event log's expand chevron. The negotiation takeovers still carry the
 * tracker in their heads, which is where the wide treatment has room.
 */
const goSlot: KitStyle = {
  position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)',
  display: 'flex', justifyContent: 'center',
};
const metaCap: KitStyle = {
  font: `600 ${KIT.fsMicro}/1.22 ${KIT.font}`,
  textTransform: 'uppercase', letterSpacing: KIT.lsWider,
  color: KIT.text2, textShadow: KIT.textLegible, whiteSpace: 'nowrap',
};
