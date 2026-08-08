/**
 * TRADE — TRADE_OFFER / COUNTER / ACCEPT / REJECT / CANCEL.
 *
 * Three-slot body throughout: LEFT what moves toward me · MIDDLE the verdict ·
 * RIGHT the controls, which is the system's left-read-only / right-interactive
 * rule with the decision itself parked in the display-only middle third.
 *
 * WHOSE MOVE IS CARRIED IN FIVE REDUNDANT CHANNELS, because the counter loop
 * is unbounded and "who is waiting on whom" is the single question a player
 * asks every time this surface opens:
 *   1  eyebrow   "TRADE · ROUND 3 · LAST OFFER BY PRIYA"
 *   2  title     "PRIYA COUNTERED" / "AWAITING PRIYA"
 *   3  TurnStrip "YOUR MOVE · ACCEPT · COUNTER · REPLY", lit in their colour
 *   4  primary   a real button when it is mine, `waiting` when it is not —
 *                still 48px, so the layout never jumps between the two
 *   5  --turn    the whole surface lights in the deciding player's colour
 *
 * SERVER TRUTH (tradeHandlers.ts): a counter SWAPS fromPlayerId/toPlayerId and
 * sets status 'countered'. So `toPlayerId` is always whose move it is, and
 * `fromPlayerId` is always the last offerer — the trade's implicit lastOfferBy.
 * Nothing here guesses; every channel is derived from those two fields.
 */
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Arm, Money, Stepper, Segs, Meter } from './kit';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import { TOKEN_HEX } from '../constants/theme';
import type { Player, PropertyState, TradeOffer } from '../types/GameState';
import { GoLoanPill } from './GoAdvancePanel';
import {
  AssetChip, AssetGrid, Cap, ConfirmPlate, Empty, Hdr, JailCardChip, KV, Line,
  Consequences, QuickReply, Row, RuleContext, RuleTakeover, SetChangeRow,
  StepReadout, WarnCard,
} from './rules/RuleSurface';
import {
  cashStep, groupCounts, groupOf, hasConsequences, holdingsAfter, setDiff, snapCash,
} from './rules/negotiation';

/** Tradeable = owned, unmortgaged, unbuilt. Mirrors GameEngine's asset check. */
const tradeable = (props: PropertyState[], ownerId: string) =>
  props.filter((p) => p.ownerId === ownerId && !p.isMortgaged && p.houses === 0 && !p.hasHotel);

const priceOf = (i: number) => BOARD_SPACES.find((s) => s.index === i)?.price ?? 0;
const sumPrice = (idx: readonly number[]) => idx.reduce((t, i) => t + priceOf(i), 0);
const nameOf = (i: number) => BOARD_SPACES.find((s) => s.index === i)?.name ?? `#${String(i)}`;

export function TradePanel() {
  const open = useGameStore((s) => s.showTradePanel);
  const close = useGameStore((s) => s.toggleTradePanel);
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const properties: PropertyState[] = useGameStore((s) => s.state?.properties) ?? [];
  const activeTrade: TradeOffer | null = useGameStore((s) => s.state?.activeTrade) ?? null;
  const myId = useGameStore((s) => s.myPlayerId) ?? '';

  const [opp, setOpp] = useState<string | null>(null);
  const [offer, setOffer] = useState<number[]>([]);
  const [request, setRequest] = useState<number[]>([]);
  const [offerMoney, setOfferMoney] = useState(0);
  const [requestMoney, setRequestMoney] = useState(0);
  const [offerJail, setOfferJail] = useState(0);
  const [requestJail, setRequestJail] = useState(0);
  const [countering, setCountering] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // ROUND NUMBER. The server does not track one — a counter reuses the tradeId
  // and only flips from/to — so it is counted here, per tradeId, from the
  // observed perspective swaps. It resets with the trade and is presentation
  // only: every load-bearing whose-move signal comes from the state itself.
  const round = useRef({ tradeId: '', from: '', n: 1 });
  if (activeTrade) {
    if (round.current.tradeId !== activeTrade.tradeId) {
      round.current = { tradeId: activeTrade.tradeId, from: activeTrade.fromPlayerId, n: 1 };
    } else if (round.current.from !== activeTrade.fromPlayerId) {
      round.current = { ...round.current, from: activeTrade.fromPlayerId, n: round.current.n + 1 };
    }
  }

  const isParty = activeTrade !== null
    && (activeTrade.fromPlayerId === myId || activeTrade.toPlayerId === myId);
  const isOpen = open || isParty;

  // A trade that resolves under an open confirm plate must not leave it up.
  useEffect(() => { if (activeTrade === null) { setConfirming(false); setCountering(false); } }, [activeTrade]);

  const me = players.find((p) => p.id === myId);
  const myHex = me ? TOKEN_HEX[me.token] : TOKEN_HEX.blue;
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const cashOf = (id: string) => players.find((p) => p.id === id)?.money ?? 0;
  const jailOf = (id: string) => players.find((p) => p.id === id)?.jailCardCount ?? 0;

  const dismiss = () => { close(false); setCountering(false); setConfirming(false); };

  const resetDraft = () => {
    setOffer([]); setRequest([]); setOfferMoney(0); setRequestMoney(0);
    setOfferJail(0); setRequestJail(0);
  };

  const send = () => {
    if (opp === null) return;
    socketManager.emit(EVENTS.TRADE_OFFER, {
      toPlayerId: opp,
      offeredProperties: offer, requestedProperties: request,
      offeredMoney: offerMoney, requestedMoney: requestMoney,
      offeredJailCards: offerJail, requestedJailCards: requestJail,
    });
    resetDraft();
    close(false);
  };

  const sendCounter = () => {
    if (!activeTrade) return;
    socketManager.emit(EVENTS.TRADE_COUNTER, {
      tradeId: activeTrade.tradeId,
      offeredProperties: offer, requestedProperties: request,
      offeredMoney: offerMoney, requestedMoney: requestMoney,
      offeredJailCards: offerJail, requestedJailCards: requestJail,
    });
    setCountering(false);
  };

  const act = (ev: string) => { if (activeTrade) socketManager.emit(ev, { tradeId: activeTrade.tradeId }); };

  const startCounter = () => {
    if (!activeTrade) return;
    // Their offer becomes my draft with the sides swapped — nobody should have
    // to retype a proposal to change one line of it.
    setOffer(activeTrade.requestedProperties);
    setRequest(activeTrade.offeredProperties);
    setOfferMoney(activeTrade.requestedMoney);
    setRequestMoney(activeTrade.offeredMoney);
    setOfferJail(activeTrade.requestedJailCards);
    setRequestJail(activeTrade.offeredJailCards);
    setCountering(true);
  };

  // ── review: a live trade I am party to, and I am not re-composing it ──────
  if (isOpen && activeTrade && !countering) {
    return (
      <ReviewTrade
        trade={activeTrade}
        myId={myId}
        me={me}
        players={players}
        properties={properties}
        roundNo={round.current.n}
        confirming={confirming}
        onConfirmOpen={() => { setConfirming(true); }}
        onConfirmBack={() => { setConfirming(false); }}
        onAccept={() => { setConfirming(false); act(EVENTS.TRADE_ACCEPT); }}
        onReject={() => { act(EVENTS.TRADE_REJECT); }}
        onCancel={() => { act(EVENTS.TRADE_CANCEL); }}
        onCounter={startCounter}
        onClose={dismiss}
      />
    );
  }

  // ── compose / counter ────────────────────────────────────────────────────
  const targetId = countering ? (activeTrade?.fromPlayerId ?? null) : opp;
  const myProps = tradeable(properties, myId);
  const theirProps = targetId === null ? [] : tradeable(properties, targetId);
  const myCash = cashOf(myId);
  const theirCash = targetId === null ? 0 : cashOf(targetId);
  const myStep = cashStep(myCash);
  const theirStep = cashStep(theirCash);

  // Verdict. Both sides, because "what this does to THEM" is the leverage.
  const mineBefore = groupCounts(holdingsAfter(properties, myId));
  const mineAfter = groupCounts(holdingsAfter(properties, myId, offer, request));
  const mineDiff = setDiff(mineBefore, mineAfter);
  const theirDiff = targetId === null
    ? { lost: [], gained: [], changed: [] }
    : setDiff(
        groupCounts(holdingsAfter(properties, targetId)),
        groupCounts(holdingsAfter(properties, targetId, request, offer)),
      );

  const giveValue = sumPrice(offer) + offerMoney;
  const getValue = sumPrice(request) + requestMoney;
  const net = getValue - giveValue;
  const breaksMine = new Set(mineDiff.lost.map((c) => c.group));
  const empty = offer.length === 0 && request.length === 0
    && offerMoney === 0 && requestMoney === 0 && offerJail === 0 && requestJail === 0;

  const verdict = { mine: mineDiff, theirs: theirDiff, theirName: targetId === null ? undefined : name(targetId) };

  const opponents = players.filter((p) => p.id !== myId && !p.isBankrupt);

  return (
    <RuleTakeover
      open={isOpen}
      turnHex={myHex}
      eyebrow={
        countering
          ? `TRADE · ROUND ${String(round.current.n + 1)} · YOUR COUNTER · NOT SENT YET`
          : `TRADE · NEW OFFER · ${targetId === null ? 'PICK A PLAYER' : `TO ${name(targetId).toUpperCase()}`} · NOT SENT YET`
      }
      title={countering ? 'Counter offer' : 'Compose offer'}
      tracker={<GoLoanPill player={me} />}
      onClose={dismiss}
      leftClass="rn-tight rn-fixed"
      rightClass="rn-tight rn-fixed"
      left={
        targetId === null ? (
          <>
            <Hdr label="You give" note="Pick a player first" />
            <Empty>Choose who you are trading with →</Empty>
          </>
        ) : (
          <>
            {/* THE HEADER IS THE SCROLL CUE. The grid holds three whole 44px
                rows and eight assets is four, so a chip you have already
                picked can be below the fold. A count of what is selected,
                pinned above the scroll, answers "did that register" without a
                gradient that would erase a price. */}
            <Hdr
              label="You give"
              note={offer.length + offerJail > 0
                ? `${String(offer.length + offerJail)} PICKED · ${fmtM(sumPrice(offer))}`
                : `${String(myProps.length + 1)} ASSETS · ${fmtM(myCash)} CASH`}
            />
            <AssetGrid label="Assets you give">
              {/* GAP 2 — AND IT LEADS THE GRID, IT DOES NOT TRAIL IT.
                  Eight assets is four 44px rows against 156px of grid, so the
                  last row is below the fold at rest. Trailing the properties
                  put the jail card there: a feature that has never once been
                  surfaced, hidden behind a scroll on its first outing. It is
                  also the one asset in here that is not a property, so
                  leading with it is the honest grouping. */}
              <JailCardChip
                testId="offer-jail"
                held={jailOf(myId)}
                count={offerJail}
                onCycle={() => { setOfferJail((c) => (c + 1) % (jailOf(myId) + 1)); }}
              />
              {myProps.map((p) => (
                <AssetChip
                  key={p.spaceIndex}
                  testId={`offer-${String(p.spaceIndex)}`}
                  spaceIndex={p.spaceIndex}
                  selected={offer.includes(p.spaceIndex)}
                  breaks={offer.includes(p.spaceIndex) && breaksMine.has(groupOf(p.spaceIndex) ?? 'brown')}
                  onToggle={() => { setOffer(toggle(offer, p.spaceIndex)); }}
                />
              ))}
            </AssetGrid>
            <Stepper
              className="rn-step"
              value={offerMoney}
              min={0}
              max={myCash}
              step={myStep}
              onChange={(v) => { setOfferMoney(snapCash(v, myStep, myCash)); }}
              ariaLabel={`Cash you add, in steps of ${fmtM(myStep)}`}
            >
              <StepReadout label="You add"><Money value={offerMoney} size="glance-lg" tone="gold" digits={3} /></StepReadout>
            </Stepper>
          </>
        )
      }
      mid={
        <>
          <Hdr label="Net effect" note={countering ? `ROUND ${String(round.current.n + 1)}` : 'NOT SENT'} />
          {countering && <Cap>Counters loop with no limit — either side may keep going</Cap>}
          {/* A £0 hero over three empty columns is worse than no hero: it
              looks like a computed verdict on an offer that does not exist. */}
          {targetId === null ? (
            <WarnCard
              tone="warn"
              head="Nothing to weigh yet"
              body="Pick a player and this column keeps a running verdict: net value, and every monopoly the offer would make or break — on both sides."
            />
          ) : (
            <KV label="Net value to you">
              <Money
                value={net}
                size="hero-lg"
                tone={net > 0 ? 'gain' : net < 0 ? 'loss' : 'gold'}
                digits={3}
                legible
              />
            </KV>
          )}
          {targetId !== null && hasConsequences(verdict)
            ? <Consequences {...verdict} />
            : targetId !== null && !empty && (
                <WarnCard
                  tone="good"
                  head="Nothing of yours breaks"
                  body="No completed set of yours is touched by this offer."
                />
              )}
          {targetId !== null && empty && (
            <Cap>Tap assets on either side · the verdict updates as you go</Cap>
          )}
          {targetId !== null && mineDiff.changed.slice(0, 2).map((c) => <SetChangeRow key={c.group} change={c} />)}
        </>
      }
      right={
        targetId === null ? (
          <>
            <Hdr label="Trade with" note={`${String(opponents.length)} in the game`} />
            {/* <Segs> caps at 4 items — 4x44 + 3x12 = 212px inside the 250px
                column. Max players is 4, so at most 3 opponents. It fits. */}
            {opponents.length > 0 ? (
              <Segs
                value={opp ?? ''}
                ariaLabel="Trade with"
                onChange={(v) => { setOpp(v); resetDraft(); }}
                options={opponents.slice(0, 4).map((p) => ({ value: p.id, label: p.name }))}
              />
            ) : (
              <Empty>No one left to trade with</Empty>
            )}
            <Cap>Their deeds and cash appear the moment you pick</Cap>
          </>
        ) : (
          <>
            <Hdr
              label="You ask for"
              note={request.length + requestJail > 0
                ? `${String(request.length + requestJail)} PICKED · ${fmtM(sumPrice(request))}`
                : `${name(targetId).toUpperCase()} · ${fmtM(theirCash)}`}
            />
            <AssetGrid label="Assets you ask for">
              <JailCardChip
                testId="request-jail"
                held={jailOf(targetId)}
                count={requestJail}
                onCycle={() => { setRequestJail((c) => (c + 1) % (jailOf(targetId) + 1)); }}
              />
              {theirProps.map((p) => (
                <AssetChip
                  key={p.spaceIndex}
                  testId={`request-${String(p.spaceIndex)}`}
                  spaceIndex={p.spaceIndex}
                  selected={request.includes(p.spaceIndex)}
                  onToggle={() => { setRequest(toggle(request, p.spaceIndex)); }}
                />
              ))}
            </AssetGrid>
            <Stepper
              className="rn-step"
              value={requestMoney}
              min={0}
              max={theirCash}
              step={theirStep}
              onChange={(v) => { setRequestMoney(snapCash(v, theirStep, theirCash)); }}
              ariaLabel={`Cash they add, in steps of ${fmtM(theirStep)}`}
            >
              <StepReadout label="They add"><Money value={requestMoney} size="glance-lg" tone="gold" digits={3} /></StepReadout>
            </Stepper>
          </>
        )
      }
      context={
        <RuleContext
          properties={properties}
          myId={myId}
          hits={[...offer, ...request]}
          boardLabel="Board: gold tiles are in this offer"
          who="Your move"
          phase={targetId === null ? 'Pick a player' : countering ? 'They reply next' : `${name(targetId)} replies next`}
          color={myHex}
        />
      }
      actions={
        <>
          <Button
            variant="ghost"
            label={countering ? 'Back' : 'Cancel'}
            onClick={() => { if (countering) setCountering(false); else dismiss(); }}
          />
          <Button
            variant="primary"
            label={countering ? 'Send counter' : 'Send offer'}
            disabled={targetId === null || empty}
            onClick={countering ? sendCounter : send}
          />
        </>
      }
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// REVIEW — a live offer, from either side of it
// ────────────────────────────────────────────────────────────────────────────

interface ReviewProps {
  trade: TradeOffer;
  myId: string;
  me: Player | undefined;
  players: Player[];
  properties: PropertyState[];
  roundNo: number;
  confirming: boolean;
  onConfirmOpen: () => void;
  onConfirmBack: () => void;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
  onCounter: () => void;
  onClose: () => void;
}

function ReviewTrade({
  trade, myId, me, players, properties, roundNo, confirming,
  onConfirmOpen, onConfirmBack, onAccept, onReject, onCancel, onCounter, onClose,
}: ReviewProps) {
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const hexOf = (id: string) => {
    const p = players.find((q) => q.id === id);
    return p ? TOKEN_HEX[p.token] : TOKEN_HEX.blue;
  };
  const cashOf = (id: string) => players.find((p) => p.id === id)?.money ?? 0;

  // SERVER TRUTH: a counter swaps from/to. `to` is always the decider,
  // `from` is always the last offerer.
  const decider = trade.toPlayerId;
  const offerer = trade.fromPlayerId;
  const mine = decider === myId;
  const them = mine ? offerer : decider;

  // From MY seat: what arrives, what leaves.
  const incoming = mine ? trade.offeredProperties : trade.requestedProperties;
  const outgoing = mine ? trade.requestedProperties : trade.offeredProperties;
  const inCash = mine ? trade.offeredMoney : trade.requestedMoney;
  const outCash = mine ? trade.requestedMoney : trade.offeredMoney;
  const inJail = mine ? trade.offeredJailCards : trade.requestedJailCards;
  const outJail = mine ? trade.requestedJailCards : trade.offeredJailCards;

  const inValue = sumPrice(incoming) + inCash;
  const outValue = sumPrice(outgoing) + outCash;
  const net = inValue - outValue;

  const mineDiff = setDiff(
    groupCounts(holdingsAfter(properties, myId)),
    groupCounts(holdingsAfter(properties, myId, outgoing, incoming)),
  );
  const theirDiff = setDiff(
    groupCounts(holdingsAfter(properties, them)),
    groupCounts(holdingsAfter(properties, them, incoming, outgoing)),
  );
  const verdict = { mine: mineDiff, theirs: theirDiff, theirName: name(them) };

  const myCash = cashOf(myId);
  const theirCash = cashOf(them);
  const deciderHex = hexOf(decider);

  return (
    <RuleTakeover
      open
      // CHANNEL 5 — the whole surface lights in the DECIDER's colour, so a
      // glance at the primary button already says whether it is on you.
      turnHex={deciderHex}
      // CHANNEL 1
      eyebrow={`TRADE · ROUND ${String(roundNo)} · LAST OFFER BY ${name(offerer).toUpperCase()}`}
      // CHANNEL 2
      title={
        mine
          ? roundNo > 1 ? `${name(offerer)} countered` : `Review ${name(offerer)}'s offer`
          : `Awaiting ${name(decider)}`
      }
      tracker={<GoLoanPill player={me} />}
      onClose={onClose}
      leftClass="rn-tight"
      rightClass="rn-tight"
      left={
        <>
          <Hdr label={`${name(them)} gives`} note={`${name(them).toUpperCase()} · ${fmtM(theirCash)}`} />
          {incoming.length === 0 && inCash === 0 && inJail === 0 && <Empty>Nothing</Empty>}
          {incoming.map((i) => (
            <Row
              key={i}
              label={nameOf(i)}
              group={groupOf(i)}
              value={<Money value={priceOf(i)} size="label" digits={3} />}
            />
          ))}
          {inCash > 0 && <Row label="Cash" value={<Money value={inCash} size="label" digits={3} />} />}
          <Row
            label="Jail free card"
            muted={inJail === 0}
            value={inJail > 0
              ? <Badge tone="good">{`×${String(inJail)}`}</Badge>
              : <span className="kit-t-micro kit-t-caps kit-t-mute">NONE</span>}
          />
          <Line />
          <Row label="Total to you" current value={<Money value={inValue} size="glance" tone="gold" digits={3} />} />
          <Row label={`${name(them)} after`} value={<Money value={theirCash - inCash + outCash} size="label" digits={3} />} />
        </>
      }
      mid={
        <>
          <Hdr label="Net effect" note={`ROUND ${String(roundNo)}`} />
          {roundNo > 1 && <Cap>Counters loop with no limit — accepting is what ends it</Cap>}
          <KV label="Net value to you">
            <Money value={net} size="hero-lg" tone={net > 0 ? 'gain' : net < 0 ? 'loss' : 'gold'} digits={3} legible />
          </KV>
          {hasConsequences(verdict)
            ? <Consequences {...verdict} />
            : (
              <WarnCard
                tone="good"
                head="Nothing of yours breaks"
                body="No completed set of yours is touched by this offer."
              />
            )}
          {mineDiff.changed.slice(0, 2).map((c) => <SetChangeRow key={c.group} change={c} />)}
        </>
      }
      right={
        <>
          <Hdr label={`${name(them)} wants`} note={`YOU · ${fmtM(myCash)}`} />
          {outgoing.length === 0 && outCash === 0 && outJail === 0 && <Empty>Nothing</Empty>}
          {outgoing.map((i) => (
            <Row
              key={i}
              label={nameOf(i)}
              group={groupOf(i)}
              value={<Money value={priceOf(i)} size="label" digits={3} />}
            />
          ))}
          {outCash > 0 && <Row label="Cash" value={<Money value={outCash} size="label" digits={3} />} />}
          {outJail > 0 && <Row label="Jail free card" value={<Badge tone="warn">{`×${String(outJail)}`}</Badge>} />}
          <Line />
          <Row label="Total from you" current value={<Money value={outValue} size="glance" tone="gold" digits={3} />} />
          <Row label="You after" value={<Money value={myCash - outCash + inCash} size="label" digits={3} />} />
          {/* Continuous, so <Meter>, not <SetPips>: how much of my cash this
              offer costs me is a ratio, and no discrete count expresses it. */}
          {outCash > 0 && myCash > 0 && (
            <>
              <Cap>Share of your cash</Cap>
              <Meter
                pct={(outCash / myCash) * 100}
                tone={outCash > myCash * 0.6 ? 'bad' : outCash > myCash * 0.3 ? 'warn' : 'gold'}
                ariaLabel="Cash in this offer against your cash"
              />
            </>
          )}
          {mine && (
            <>
              <Cap>Quick reply</Cap>
              <div className="rn-qr">
                {/* GAP 6: a one-way "guess what I want" flow is the named
                    failure in Catan Universe and Pokemon TCG Pocket. */}
                <QuickReply
                  label="Need more"
                  sent="Sent"
                  onSend={() => { socketManager.emit(EVENTS.TRADE_COUNTER, {
                    tradeId: trade.tradeId,
                    offeredProperties: trade.requestedProperties,
                    requestedProperties: trade.offeredProperties,
                    offeredMoney: trade.requestedMoney,
                    requestedMoney: trade.offeredMoney,
                    offeredJailCards: trade.requestedJailCards,
                    requestedJailCards: trade.offeredJailCards,
                  }); }}
                />
                <Arm face="No thanks" confirm="Tap to reject" onConfirm={onReject} />
              </div>
            </>
          )}
        </>
      }
      context={
        <RuleContext
          properties={properties}
          myId={myId}
          hits={[...incoming, ...outgoing]}
          boardLabel="Board: gold tiles are in this offer"
          // CHANNEL 3
          who={mine ? 'Your move' : `${name(decider)}'s move`}
          phase={mine ? 'Accept · counter · reply' : 'They are deciding'}
          color={deciderHex}
        />
      }
      actions={
        mine ? (
          <>
            <Button variant="secondary" label={roundNo > 1 ? 'Counter again' : 'Counter'} onClick={onCounter} />
            {/* CHANNEL 4 */}
            <Button variant="primary" label="Accept offer" onClick={onConfirmOpen} />
          </>
        ) : (
          <>
            <Arm face="Cancel offer" confirm="Tap to withdraw" onConfirm={onCancel} />
            <Button variant="primary" waiting label={`Waiting · ${name(decider)}`} />
          </>
        )
      }
      confirm={
        <ConfirmPlate
          open={confirming && mine}
          sub="EXPLICIT CONFIRM · IRREVERSIBLE"
          title={roundNo > 1 ? `Accept round ${String(roundNo)}?` : 'Accept this trade?'}
          rows={[
            { label: 'You receive', value: <span className="kit-t-micro kit-t-caps rn-trunc">{describe(incoming, inCash, inJail)}</span> },
            { label: 'You give up', value: <span className="kit-t-micro kit-t-caps rn-trunc">{describe(outgoing, outCash, outJail)}</span> },
            { label: 'Net value', value: <Money value={net} size="glance" tone={net >= 0 ? 'gain' : 'loss'} digits={3} /> },
            ...mineDiff.lost.slice(0, 1).map((c) => ({
              label: `${c.group} set`,
              value: <Badge tone="jail">{`${String(c.before)}/${String(c.total)} → ${String(c.after)}/${String(c.total)}`}</Badge>,
            })),
          ]}
          note="This cannot be undone"
          noteBody="Assets move immediately. Arm-and-fire is used everywhere else in Mockopoly; accepting a trade is one of the two places that still gets a real confirmation."
          okLabel="Accept trade"
          onOk={onAccept}
          onBack={onConfirmBack}
        />
      }
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────

function toggle(arr: number[], i: number): number[] {
  return arr.includes(i) ? arr.filter((x) => x !== i) : [...arr, i];
}

/** Millions, one decimal — for a caps label where <Money> cannot go. */
function fmtM(v: number): string {
  return `£${(v / 1_000_000).toFixed(1)}M`;
}

function describe(idx: readonly number[], cash: number, jail: number): string {
  const parts = idx.map(nameOf);
  if (cash > 0) parts.push(fmtM(cash));
  if (jail > 0) parts.push(`${String(jail)} jail card${jail === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' + ') : 'Nothing';
}
