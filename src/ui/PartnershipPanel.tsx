/**
 * PARTNERSHIPS — PARTNERSHIP_PROPOSE / ACCEPT_PROPOSAL / REJECT_PROPOSAL /
 * CANCEL_PROPOSAL / DISSOLVE_REQUEST / ACCEPT_DISSOLVE / REJECT_DISSOLVE.
 *
 * 2-3 players co-own a colour group and split rent and build costs by equity.
 * Four surfaces, one shape:
 *
 *   propose   pick a group, allocate equity, send
 *   pending   who has accepted, what changes when the last one does
 *   active    the live split, and the ledger of what it has paid out
 *   dissolve  what unwinds, who is owed what, and who still has to agree
 *
 * THE EQUITY ALLOCATOR CANNOT EXPRESS AN INVALID TOTAL.
 * The old panel held three free percentages, showed "Total 87% (must be 100)"
 * in red and disabled Propose until you fixed it — a validator nagging at you
 * for a problem the control created. Equity is now twenty integer 5% units,
 * redistributed by largest remainder with a one-unit floor: every reachable
 * state sums to exactly 100, so there is no error state, no red text and
 * nothing to fix. See `eqSet` in rules/negotiation.ts, which is tested
 * exhaustively for that invariant.
 */
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Arm, Hold, Money, Segs, SetPips, Stepper } from './kit';
import { useGameStore } from '../state/gameStore';
import { useGameBusEvent } from '../state/useGameBus';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES, COLOR_GROUPS } from '../constants/board';
import { TOKEN_HEX } from '../constants/theme';
import type {
  ColorGroup, Partnership, PartnershipDissolutionRequest,
  PartnershipProposal, Player, PropertyState,
} from '../types/GameState';
import type { S_PartnershipBuildCostSplit, S_PartnershipRentSplit } from '../types/SocketEvents';
import { GoLoanPill } from './GoAdvancePanel';
import {
  Cap, Empty, EqBar, Hdr, KV, Line, PDot, Row, RuleContext, RuleTakeover,
  SplitRow, StepReadout, WarnCard,
} from './rules/RuleSurface';
import {
  EQ_MIN_UNITS, EQ_UNIT_PCT, eqInitial, eqMaxUnits, eqPercents, eqSet,
  groupHex, groupLabel, shortSpaceName,
} from './rules/negotiation';

/** One PARTNERSHIP_RENT_SPLIT / PARTNERSHIP_BUILD_COST_SPLIT, as it arrived. */
interface SplitEvent {
  kind: 'rent' | 'build';
  spaceIndex: number;
  at: number;
  splits: { playerId: string; amount: number }[];
}

/** Only houseable groups can be partnered. Mirrors GameEngine. */
const HOUSEABLE: ColorGroup[] = ['brown', 'light-blue', 'pink', 'orange', 'red', 'yellow', 'green', 'dark-blue'];

/**
 * Module-level empties. `useGameStore(s => s.state?.x) ?? []` builds a NEW
 * array on every render, which makes any useMemo that depends on it recompute
 * every time — and react-hooks/exhaustive-deps flags the logical expression
 * for exactly that reason. Defaulting INSIDE the selector to a frozen constant
 * gives a stable identity in both branches.
 */
const NO_PLAYERS: Player[] = [];
const NO_PROPS: PropertyState[] = [];
const NO_PARTNERSHIPS: Partnership[] = [];

const priceOf = (i: number) => BOARD_SPACES.find((s) => s.index === i)?.price ?? 0;
const houseCostOf = (i: number) => BOARD_SPACES.find((s) => s.index === i)?.houseCost ?? 0;
const nameOf = (i: number) => BOARD_SPACES.find((s) => s.index === i)?.name ?? `#${String(i)}`;
const m2 = (v: number) => (v / 1_000_000).toFixed(2);

export function PartnershipPanel() {
  const open = useGameStore((s) => s.showPartnershipPanel);
  const close = useGameStore((s) => s.togglePartnershipPanel);
  const players = useGameStore((s) => s.state?.players ?? NO_PLAYERS);
  const properties = useGameStore((s) => s.state?.properties ?? NO_PROPS);
  const partnerships = useGameStore((s) => s.state?.partnerships ?? NO_PARTNERSHIPS);
  const proposal: PartnershipProposal | null = useGameStore((s) => s.state?.activePartnershipProposal) ?? null;
  const dissolution: PartnershipDissolutionRequest | null = useGameStore((s) => s.state?.activePartnershipDissolution) ?? null;
  const myId = useGameStore((s) => s.myPlayerId) ?? '';

  const [group, setGroup] = useState<ColorGroup | null>(null);
  const [units, setUnits] = useState<number[]>([]);

  // THE SPLIT LEDGER IS ACCUMULATED HERE, BECAUSE NOTHING ELSE KEEPS IT.
  // The server emits PARTNERSHIP_RENT_SPLIT and PARTNERSHIP_BUILD_COST_SPLIT
  // with a per-player amount each, GameStateSync forwards both onto the game
  // bus — and then they are dropped: `state.log` only carries the four
  // partnership LIFECYCLE lines (formed / dissolved / inherited /
  // restructured), never a single split. So "what has this partnership
  // actually paid me" was unanswerable. This panel is mounted for the whole
  // game, so it can simply remember.
  const [ledger, setLedger] = useState<SplitEvent[]>([]);
  useGameBusEvent<S_PartnershipRentSplit>('partnership-rent-split', (d) => {
    setLedger((l) => [{ kind: 'rent' as const, spaceIndex: d.spaceIndex, at: Date.now(), splits: d.splits }, ...l].slice(0, 24));
  });
  useGameBusEvent<S_PartnershipBuildCostSplit>('partnership-build-cost-split', (d) => {
    setLedger((l) => [{ kind: 'build' as const, spaceIndex: d.spaceIndex, at: Date.now(), splits: d.splits }, ...l].slice(0, 24));
  });

  const me = players.find((p) => p.id === myId);
  const myHex = me ? TOKEN_HEX[me.token] : TOKEN_HEX.blue;
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const hexOf = (id: string) => {
    const p = players.find((q) => q.id === id);
    return p ? TOKEN_HEX[p.token] : TOKEN_HEX.blue;
  };
  const emit = (ev: string, payload: object) => { socketManager.emit(ev, payload); };
  const ownerOf = (i: number) => properties.find((p) => p.spaceIndex === i)?.ownerId ?? null;

  const inProposal = proposal?.proposedEquity.some((e) => e.playerId === myId) ?? false;
  const myPartnership = partnerships.find((pt) => pt.partners.some((e) => e.playerId === myId)) ?? null;
  const dissolving = dissolution !== null
    && partnerships.some(
      (pt) => pt.partnershipId === dissolution.partnershipId && pt.partners.some((e) => e.playerId === myId),
    );
  const isOpen = open || inProposal || dissolving;

  // Groups I could propose on: fully owned, ≥2 distinct owners, one of them me,
  // no live partnership. Exactly GameEngine.canProposePartnership's shape, so
  // the button can never send something the server will bounce.
  // `owner` is redeclared inside each memo rather than closed over, so the
  // dependency list stays honest: these recompute on `properties`, not on the
  // identity of a helper that is rebuilt every render.
  const eligible = useMemo(() => {
    const owner = (i: number) => properties.find((p) => p.spaceIndex === i)?.ownerId ?? null;
    return HOUSEABLE.filter((g) => {
      const idx = COLOR_GROUPS[g];
      if (idx.length === 0) return false;
      if (partnerships.some((pt) => pt.colorGroup === g)) return false;
      if (!idx.every((i) => owner(i) !== null)) return false;
      if (new Set(idx.map(owner)).size < 2) return false;
      return idx.some((i) => owner(i) === myId);
    });
  }, [partnerships, properties, myId]);

  const owners = useMemo(() => {
    if (group === null) return [];
    const owner = (i: number) => properties.find((p) => p.spaceIndex === i)?.ownerId ?? null;
    return Array.from(new Set(COLOR_GROUPS[group].map(owner).filter((x): x is string => x !== null)));
  }, [group, properties]);

  // Keep the allocator's arity in step with the chosen group's owner list.
  useEffect(() => { setUnits(eqInitial(owners.length)); }, [owners.length, group]);

  const dismiss = () => { close(false); };

  // ── dissolution takes precedence: money is already at stake ──────────────
  if (isOpen && dissolution && dissolving) {
    const pt = partnerships.find((p) => p.partnershipId === dissolution.partnershipId);
    if (pt) {
      return (
        <DissolveView
          pt={pt}
          req={dissolution}
          me={me}
          myId={myId}
          players={players}
          properties={properties}
          onClose={dismiss}
          onAccept={() => { emit(EVENTS.PARTNERSHIP_ACCEPT_DISSOLVE, { dissolutionId: dissolution.dissolutionId }); }}
          onReject={() => { emit(EVENTS.PARTNERSHIP_REJECT_DISSOLVE, { dissolutionId: dissolution.dissolutionId }); }}
        />
      );
    }
  }

  // ── a live proposal I am named in ────────────────────────────────────────
  if (isOpen && proposal && inProposal) {
    return (
      <ProposalView
        proposal={proposal}
        me={me}
        myId={myId}
        players={players}
        properties={properties}
        onClose={dismiss}
        onAccept={() => { emit(EVENTS.PARTNERSHIP_ACCEPT_PROPOSAL, { proposalId: proposal.proposalId }); }}
        onReject={() => { emit(EVENTS.PARTNERSHIP_REJECT_PROPOSAL, { proposalId: proposal.proposalId }); }}
        onCancel={() => { emit(EVENTS.PARTNERSHIP_CANCEL_PROPOSAL, { proposalId: proposal.proposalId }); }}
      />
    );
  }

  // ── a partnership of mine is running ─────────────────────────────────────
  if (isOpen && myPartnership && !proposal) {
    return (
      <ActiveView
        pt={myPartnership}
        me={me}
        myId={myId}
        players={players}
        properties={properties}
        ledger={ledger}
        onClose={dismiss}
        onDissolve={() => { emit(EVENTS.PARTNERSHIP_DISSOLVE_REQUEST, { partnershipId: myPartnership.partnershipId }); }}
      />
    );
  }

  // ── propose ──────────────────────────────────────────────────────────────
  const idx = group === null ? [] : COLOR_GROUPS[group];
  const setValue = idx.reduce((t, i) => t + priceOf(i), 0);
  const houseCost = idx.length > 0 ? houseCostOf(idx[0]) : 0;
  const pct = eqPercents(units);
  const rentBase = idx.reduce((t, i) => t + (BOARD_SPACES.find((s) => s.index === i)?.rents?.[0] ?? 0), 0);
  const myCash = me?.money ?? 0;
  const ready = group !== null && owners.length >= 2 && owners.length <= 3 && units.length === owners.length;
  const maxUnits = eqMaxUnits(owners.length);

  return (
    <RuleTakeover
      open={isOpen}
      turnHex={myHex}
      eyebrow={
        group === null
          ? `PARTNERSHIP · PROPOSE · ${String(eligible.length)} ELIGIBLE ${eligible.length === 1 ? 'SET' : 'SETS'} · 2-3 PARTNERS`
          : `PARTNERSHIP · PROPOSE · ${groupLabel(group)} SET · ${String(owners.length)} PARTNERS`
      }
      title={group === null ? 'Co-own a set' : `Co-own ${groupLabel(group).toLowerCase()}`}
      tracker={<GoLoanPill player={me} />}
      onClose={dismiss}
      leftClass="rn-tight"
      rightClass="rn-tight"
      left={
        group === null ? (
          <>
            <Hdr label="The set" note="Pick one first" />
            <Empty>Choose a colour group →</Empty>
            <Cap>A set can be partnered once every space in it is owned and at least two players hold part of it</Cap>
          </>
        ) : (
          <>
            <Hdr label="The set" note={`${String(idx.filter((i) => ownerOf(i) === myId).length)}/${String(idx.length)} yours`} />
            <SetPips color={groupHex(group)} owned={idx.length} total={idx.length} complete />
            <Cap>{idx.map(nameOf).join(' · ')}</Cap>
            <Row label="Set value" current value={<Money value={setValue} size="glance" tone="gold" digits={3} />} />
            <Cap>Per partner £M · rent of {m2(rentBase)} / house of {m2(houseCost)}</Cap>
            {owners.map((id, i) => (
              <SplitRow
                key={id}
                color={hexOf(id)}
                name={name(id)}
                pct={pct[i] ?? 0}
                inAmount={m2((rentBase * (units[i] ?? 0)) / (100 / EQ_UNIT_PCT))}
                outAmount={m2((houseCost * (units[i] ?? 0)) / (100 / EQ_UNIT_PCT))}
              />
            ))}
          </>
        )
      }
      mid={
        <>
          <Hdr label="Partnership" note={group === null ? 'NOT PICKED' : `${String(owners.length)} PARTNERS`} />
          {group !== null && houseCost > myCash && (
            <WarnCard
              tone="warn"
              head="You cannot build alone"
              body={`A house on this set costs £${m2(houseCost)}M. You hold £${m2(myCash)}M. Partners fund the build and take a share of the rent.`}
            />
          )}
          {group !== null && houseCost <= myCash && (
            <WarnCard
              tone="good"
              head="Rent and costs split automatically"
              body="Every rent payment and every build on this set is divided by equity, by the server, every time."
            />
          )}
          {group !== null && <SetPips color={groupHex(group)} owned={idx.length} total={idx.length} complete />}
          <Cap>Dissolving needs every partner to agree — this is not a one-way door for anybody</Cap>
        </>
      }
      right={
        group === null ? (
          <>
            <Hdr label="Eligible sets" note={`${String(eligible.length)} of 8`} />
            {eligible.length > 0 ? (
              // <Segs> caps at 4 (4x44 + 3x12 = 212px inside a 250px column).
              <Segs
                value={''}
                ariaLabel="Colour group"
                onChange={(g) => { setGroup(g as ColorGroup); }}
                options={eligible.slice(0, 4).map((g) => ({ value: g, label: groupLabel(g) }))}
              />
            ) : (
              <Empty>No eligible groups</Empty>
            )}
            {eligible.length > 4 && <Cap>{eligible.length - 4} more once one of these resolves</Cap>}
          </>
        ) : (
          <>
            <Hdr label="Equity split" note="TOTAL 100%" ok />
            <EqBar
              segments={owners.map((id, i) => ({ key: id, pct: pct[i] ?? 0, color: hexOf(id) }))}
            />
            {owners.map((id, i) => (
              <Stepper
                key={id}
                className="rn-step"
                value={units[i] ?? EQ_MIN_UNITS}
                min={EQ_MIN_UNITS}
                max={maxUnits}
                step={1}
                onChange={(v) => { setUnits((u) => eqSet(u, i, v)); }}
                ariaLabel={`Equity for ${name(id)}`}
              >
                <StepReadout label={<><PDot color={hexOf(id)} /> {name(id)}</>}>
                  {pct[i] ?? 0}%
                </StepReadout>
              </Stepper>
            ))}
            <Cap>5% steps · the total cannot leave 100%</Cap>
          </>
        )
      }
      context={
        <RuleContext
          properties={properties}
          myId={myId}
          hits={idx}
          boardLabel="Board: gold tiles are the set being partnered"
          who="Your move"
          phase={
            group === null
              ? 'Pick a set'
              : owners.filter((id) => id !== myId).map(name).join(' + ') + ' must accept'
          }
          color={myHex}
        />
      }
      actions={
        <>
          <Button variant="ghost" label="Cancel" onClick={dismiss} />
          <Button variant="primary" label="Propose" disabled={!ready} onClick={() => {
            if (group === null) return;
            emit(EVENTS.PARTNERSHIP_PROPOSE, {
              colorGroup: group,
              proposedEquity: owners.map((id, i) => ({ playerId: id, percentage: pct[i] ?? 0 })),
            });
            close(false);
          }} />
        </>
      }
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PROPOSAL — pending, from either side of it
// ────────────────────────────────────────────────────────────────────────────

function ProposalView({
  proposal, me, myId, players, properties, onClose, onAccept, onReject, onCancel,
}: {
  proposal: PartnershipProposal;
  me: Player | undefined;
  myId: string;
  players: Player[];
  properties: PropertyState[];
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const hexOf = (id: string) => {
    const p = players.find((q) => q.id === id);
    return p ? TOKEN_HEX[p.token] : TOKEN_HEX.blue;
  };
  const idx = COLOR_GROUPS[proposal.colorGroup];
  const setValue = idx.reduce((t, i) => t + priceOf(i), 0);
  const mine = proposal.initiatorId === myId;
  const iAccepted = proposal.acceptedPlayerIds.includes(myId);
  const needed = proposal.proposedEquity.filter((e) => e.playerId !== proposal.initiatorId);
  const outstanding = needed.filter((e) => !proposal.acceptedPlayerIds.includes(e.playerId));
  const waitingOn: string | null = outstanding.length > 0 ? outstanding[0].playerId : null;
  // The surface lights in the colour of whoever still has to move.
  const deciderHex = hexOf(waitingOn ?? myId);
  const myTurn = !mine && !iAccepted;

  return (
    <RuleTakeover
      open
      turnHex={myTurn ? hexOf(myId) : deciderHex}
      eyebrow={`PARTNERSHIP · ${mine ? 'SENT BY YOU' : `PROPOSED BY ${name(proposal.initiatorId).toUpperCase()}`} · ${groupLabel(proposal.colorGroup)} SET`}
      title={myTurn ? `Join ${groupLabel(proposal.colorGroup).toLowerCase()}?` : 'Awaiting partners'}
      tracker={<GoLoanPill player={me} />}
      onClose={onClose}
      leftClass="rn-tight"
      rightClass="rn-tight"
      left={
        <>
          <Hdr label="Proposed" note={`${groupLabel(proposal.colorGroup)} SET`} />
          <SetPips color={groupHex(proposal.colorGroup)} owned={idx.length} total={idx.length} complete />
          <Cap>{idx.map(nameOf).join(' · ')}</Cap>
          <Row label="Set value" current value={<Money value={setValue} size="glance" tone="gold" digits={3} />} />
          <Cap>Equity as sent</Cap>
          <EqBar segments={proposal.proposedEquity.map((e) => ({ key: e.playerId, pct: e.percentage, color: hexOf(e.playerId) }))} />
          {proposal.proposedEquity.map((e) => (
            <Row
              key={e.playerId}
              label={<><PDot color={hexOf(e.playerId)} /> {name(e.playerId)}</>}
              value={<span className="kit-t-glance kit-t-gold kit-t-num">{e.percentage}%</span>}
            />
          ))}
        </>
      }
      mid={
        <>
          <Hdr label="Status" note="NOT ACTIVE" />
          <KV label="Partners accepted">
            <span className="kit-t-hero-lg kit-t-gold kit-t-num kit-t-legible">
              {needed.length - outstanding.length} OF {needed.length}
            </span>
          </KV>
          <WarnCard
            tone="warn"
            head={waitingOn === null ? 'Every partner has accepted' : `Waiting on ${name(waitingOn)}`}
            body="No rent is split and no house can be co-funded until every named partner accepts."
          />
        </>
      }
      right={
        <>
          <Hdr label="Partner replies" note="ALL MUST ACCEPT" />
          {proposal.proposedEquity.map((e) => (
            <Row
              key={e.playerId}
              label={<><PDot color={hexOf(e.playerId)} /> {name(e.playerId)}</>}
              value={
                e.playerId === proposal.initiatorId
                  ? <Badge tone="gold">PROPOSER</Badge>
                  : proposal.acceptedPlayerIds.includes(e.playerId)
                    ? <Badge tone="good">ACCEPTED</Badge>
                    : <Badge tone="warn">WAITING</Badge>
              }
            />
          ))}
          <Cap>What changes the moment the last one accepts</Cap>
          <Row label="Set rent" value={<Badge tone="good">{proposal.proposedEquity.map((e) => e.percentage).join(' / ')}</Badge>} />
          <Row label="House costs" value={<Badge tone="good">{proposal.proposedEquity.map((e) => e.percentage).join(' / ')}</Badge>} />
          <Row label="To dissolve" value={<Badge tone="warn">{`ALL ${String(proposal.proposedEquity.length)} AGREE`}</Badge>} />
        </>
      }
      context={
        <RuleContext
          properties={properties}
          myId={myId}
          hits={idx}
          boardLabel="Board: gold tiles are the set being partnered"
          who={myTurn ? 'Your move' : waitingOn === null ? 'Forming' : `Waiting on ${name(waitingOn)}`}
          phase={`${String(needed.length - outstanding.length)} of ${String(needed.length)} accepted`}
          color={myTurn ? hexOf(myId) : deciderHex}
        />
      }
      actions={
        myTurn ? (
          <>
            <Arm face="Reject" confirm="Tap to reject" onConfirm={onReject} />
            <Button variant="primary" label="Accept share" onClick={onAccept} />
          </>
        ) : mine ? (
          <>
            <Arm face="Cancel proposal" confirm="Tap to cancel" onConfirm={onCancel} />
            <Button variant="primary" waiting label={waitingOn === null ? 'Forming' : `Waiting · ${name(waitingOn)}`} />
          </>
        ) : (
          <Button variant="primary" waiting label={waitingOn === null ? 'Forming' : `Waiting · ${name(waitingOn)}`} />
        )
      }
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ACTIVE
// ────────────────────────────────────────────────────────────────────────────

function ActiveView({
  pt, me, myId, players, properties, ledger, onClose, onDissolve,
}: {
  pt: Partnership;
  me: Player | undefined;
  myId: string;
  players: Player[];
  properties: PropertyState[];
  ledger: SplitEvent[];
  onClose: () => void;
  onDissolve: () => void;
}) {
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const hexOf = (id: string) => {
    const p = players.find((q) => q.id === id);
    return p ? TOKEN_HEX[p.token] : TOKEN_HEX.blue;
  };
  const idx = COLOR_GROUPS[pt.colorGroup];
  const houseCost = idx.length > 0 ? houseCostOf(idx[0]) : 0;
  const rentBase = idx.reduce((t, i) => t + (BOARD_SPACES.find((s) => s.index === i)?.rents?.[0] ?? 0), 0);
  const myShare = pt.partners.find((e) => e.playerId === myId)?.percentage ?? 0;
  const myHex = me ? TOKEN_HEX[me.token] : TOKEN_HEX.blue;


  return (
    <RuleTakeover
      open
      turnHex={myHex}
      eyebrow={`PARTNERSHIP · ACTIVE · ${groupLabel(pt.colorGroup)} SET · ${String(pt.partners.length)} PARTNERS`}
      title={`${groupLabel(pt.colorGroup)} · ${String(pt.partners.length)} partners`}
      tracker={<GoLoanPill player={me} />}
      onClose={onClose}
      leftClass="rn-tight"
      rightClass="rn-fade"
      left={
        <>
          <Hdr label="Equity" note="LOCKED AT 100%" ok />
          <EqBar segments={pt.partners.map((e) => ({ key: e.playerId, pct: e.percentage, color: hexOf(e.playerId) }))} />
          <Cap>£M rent taken / build paid</Cap>
          {pt.partners.map((e) => (
            <SplitRow
              key={e.playerId}
              color={hexOf(e.playerId)}
              name={name(e.playerId)}
              pct={e.percentage}
              inAmount={m2((rentBase * e.percentage) / 100)}
              outAmount={m2((houseCost * e.percentage) / 100)}
            />
          ))}
          <Line />
          <Row label="Base set rent" current value={<Money value={rentBase} size="glance" tone="gold" digits={3} />} />
        </>
      }
      mid={
        <>
          <Hdr label="Your position" note={`${String(myShare)}%`} />
          <KV label="Your share of set rent">
            <Money value={(rentBase * myShare) / 100} size="hero-lg" tone="gold" digits={3} legible />
          </KV>
          <WarnCard
            tone="good"
            head="Builds are co-funded"
            body={`A house costs £${m2(houseCost)}M and you pay £${m2((houseCost * myShare) / 100)}M of it. Neither the rent nor the cost is ever split by hand.`}
          />
          <SetPips color={groupHex(pt.colorGroup)} owned={idx.length} total={idx.length} complete />
        </>
      }
      right={
        <>
          <Hdr label="Split ledger" note={`${String(ledger.length)} ${ledger.length === 1 ? 'EVENT' : 'EVENTS'}`} />
          {ledger.length === 0
            ? <Empty>No splits yet this game</Empty>
            : ledger.map((e, i) => {
                const mineAmt = e.splits.find((x) => x.playerId === myId)?.amount ?? 0;
                return (
                  <div className="rn-ledger" key={`${String(e.at)}-${String(i)}`}>
                    <span className="rn-ledger-turn">{clock(e.at)}</span>
                    <span className="rn-ledger-body">
                      {e.kind === 'rent' ? 'RENT' : 'BUILD'} · {shortSpaceName(nameOf(e.spaceIndex)).toUpperCase()}
                    </span>
                    <Money
                      value={mineAmt}
                      size="micro"
                      tone={e.kind === 'rent' ? 'gain' : 'loss'}
                      digits={3}
                    />
                  </div>
                );
              })}
        </>
      }
      context={
        <RuleContext
          properties={properties}
          myId={myId}
          hits={idx}
          boardLabel="Board: gold tiles are the partnered set"
          who="Your move"
          phase={`Partnership running · ${String(myShare)}%`}
          color={myHex}
        />
      }
      actions={
        <>
          {/* <Arm>, not <Hold>: a dissolve REQUEST is reversible — every other
              partner still has to agree, and they may refuse. */}
          <Arm face="Request dissolve" confirm="Tap to request" onConfirm={onDissolve} />
          <Button variant="primary" label="Done" onClick={onClose} />
        </>
      }
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// DISSOLVE
// ────────────────────────────────────────────────────────────────────────────

function DissolveView({
  pt, req, me, myId, players, properties, onClose, onAccept, onReject,
}: {
  pt: Partnership;
  req: PartnershipDissolutionRequest;
  me: Player | undefined;
  myId: string;
  players: Player[];
  properties: PropertyState[];
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const hexOf = (id: string) => {
    const p = players.find((q) => q.id === id);
    return p ? TOKEN_HEX[p.token] : TOKEN_HEX.blue;
  };
  const idx = COLOR_GROUPS[pt.colorGroup];
  const setValue = idx.reduce((t, i) => t + priceOf(i), 0);
  const myCash = me?.money ?? 0;
  const myShare = pt.partners.find((e) => e.playerId === myId)?.percentage ?? 0;
  const others = pt.partners.filter((e) => e.playerId !== myId);
  const owedOut = others.reduce((t, e) => t + (setValue * e.percentage) / 100, 0);
  const iAccepted = req.acceptedPlayerIds.includes(myId);
  const myTurn = !iAccepted;
  const short = owedOut > myCash;
  const myHex = me ? TOKEN_HEX[me.token] : TOKEN_HEX.blue;

  return (
    <RuleTakeover
      open
      turnHex={myHex}
      eyebrow={`PARTNERSHIP · DISSOLVE ASKED BY ${name(req.requesterId).toUpperCase()} · ${groupLabel(pt.colorGroup)} SET`}
      title={`Dissolve ${groupLabel(pt.colorGroup).toLowerCase()}?`}
      tracker={<GoLoanPill player={me} />}
      onClose={onClose}
      leftClass="rn-tight"
      rightClass="rn-tight"
      left={
        <>
          <Hdr label="On dissolve" note={`${groupLabel(pt.colorGroup)} SET`} />
          <SetPips color={groupHex(pt.colorGroup)} owned={idx.length} total={idx.length} complete />
          <Row label="Set value" value={<Money value={setValue} size="label" digits={3} />} />
          <Row label="Your share" value={<span className="kit-t-glance kit-t-gold kit-t-num">{myShare}%</span>} />
          <Line />
          {others.map((e) => (
            <Row
              key={e.playerId}
              label={<><PDot color={hexOf(e.playerId)} /> {name(e.playerId)} is owed</>}
              value={<Money value={(setValue * e.percentage) / 100} size="label" tone="loss" digits={3} />}
            />
          ))}
          <Row label="You hold" current value={<Money value={myCash} size="glance" tone={short ? 'low' : 'gold'} digits={3} />} />
        </>
      }
      mid={
        <>
          <Hdr label="Dissolve status" note={`${String(req.acceptedPlayerIds.length)} OF ${String(pt.partners.length)}`} />
          <KV label="Partners accepted">
            <span className="kit-t-hero-lg kit-t-gold kit-t-num kit-t-legible">
              {req.acceptedPlayerIds.length} OF {pt.partners.length}
            </span>
          </KV>
          {short ? (
            <WarnCard
              head="You cannot settle"
              body={`£${m2(owedOut)}M is repayable the instant every partner accepts. You hold £${m2(myCash)}M. Mortgage or sell first.`}
            />
          ) : (
            <WarnCard
              tone="warn"
              head="Rent stops being split"
              body="The set returns to individual ownership and every future rent goes to one player again."
            />
          )}
        </>
      }
      right={
        <>
          <Hdr label="Partner replies" note="UNANIMOUS" />
          {pt.partners.map((e) => (
            <Row
              key={e.playerId}
              label={<><PDot color={hexOf(e.playerId)} /> {name(e.playerId)}</>}
              value={
                e.playerId === req.requesterId
                  ? <Badge tone="warn">REQUESTED</Badge>
                  : req.acceptedPlayerIds.includes(e.playerId)
                    ? <Badge tone="good">AGREED</Badge>
                    : e.playerId === myId
                      ? <Badge tone="gold">YOUR CALL</Badge>
                      : <Badge tone="warn">WAITING</Badge>
              }
            />
          ))}
          <Cap>If you reject</Cap>
          <Row label="Partnership" value={<Badge tone="good">CONTINUES</Badge>} />
          <Row label="They may retry" value={<Badge>NEXT TURN</Badge>} />
        </>
      }
      context={
        <RuleContext
          properties={properties}
          myId={myId}
          hits={idx}
          boardLabel="Board: gold tiles are the partnered set"
          who={myTurn ? 'Your move' : 'Waiting on partners'}
          phase={`${name(req.requesterId)} asked to dissolve`}
          color={myHex}
        />
      }
      actions={
        myTurn ? (
          <>
            <Arm face="Reject" confirm="Tap to reject" onConfirm={onReject} />
            {/* <Hold>: agreeing settles the buy-out the instant the last
                partner does the same, and it cannot be taken back. */}
            <Hold label="Hold to dissolve" onComplete={onAccept} />
          </>
        ) : (
          <Button variant="primary" waiting label="Waiting · partners" />
        )
      }
    />
  );
}

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
