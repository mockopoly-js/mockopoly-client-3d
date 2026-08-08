/**
 * RENT DEALS — DEAL_OFFER / COUNTER / ACCEPT / REJECT / CANCEL.
 *
 * You have landed on something you cannot pay for. Instead of going bankrupt
 * you offer the creditor property, cash and a request that they forgive part
 * of the rent; they accept, reject, or counter, and the loop runs until
 * somebody accepts.
 *
 * WHOSE MOVE IS UNAMBIGUOUS BECAUSE THE SERVER SAYS SO. `lastOfferBy` is a
 * real field on RentDeal, and dealHandlers.ts refuses a counter from whoever
 * made the last one ("Wait for the other party to respond"). So the decider is
 * "everyone in the deal who is not lastOfferBy", and that single fact drives
 * five channels: eyebrow, title, TurnStrip, the primary button's `waiting`
 * state, and the --turn colour of the whole surface.
 *
 * This panel also owns the entry point to <GoAdvancePanel>. The server gates
 * GO deductions on `money < 0 || turn.mustPayRent` — the debt moment is
 * exactly when this panel opens, so the borrow flow lives behind a button here
 * rather than needing a mount of its own in App.tsx.
 */
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Arm, Money, Meter, Slider, Stepper } from './kit';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import { TOKEN_HEX } from '../constants/theme';
import type { Player, PropertyState, RentDeal } from '../types/GameState';
import { GO_LIFETIME_CAP, GO_SALARY, GoAdvancePanel, GoLoanPill } from './GoAdvancePanel';
import {
  AssetChip, AssetGrid, Cap, ConfirmPlate, Consequences, Empty, Hdr, KV, Line,
  QuickReply, Row, RuleContext, RuleTakeover, SetChangeRow, StepReadout, WarnCard,
} from './rules/RuleSurface';
import {
  cashStep, groupCounts, groupOf, holdingsAfter, setDiff, snapCash,
} from './rules/negotiation';

const priceOf = (i: number) => BOARD_SPACES.find((s) => s.index === i)?.price ?? 0;
const nameOf = (i: number) => BOARD_SPACES.find((s) => s.index === i)?.name ?? `#${String(i)}`;
const sumPrice = (idx: readonly number[]) => idx.reduce((t, i) => t + priceOf(i), 0);
const m2 = (v: number) => (v / 1_000_000).toFixed(2);

/** Offerable = owned, unmortgaged, unbuilt. Mirrors GameEngine. */
const offerable = (props: PropertyState[], ownerId: string) =>
  props.filter((p) => p.ownerId === ownerId && !p.isMortgaged && p.houses === 0 && !p.hasHotel);

export function DealPanel() {
  const open = useGameStore((s) => s.showDealPanel);
  const close = useGameStore((s) => s.toggleDealPanel);
  const deal: RentDeal | null = useGameStore((s) => s.state?.activeRentDeal) ?? null;
  const turn = useGameStore((s) => s.state?.turn);
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const properties: PropertyState[] = useGameStore((s) => s.state?.properties) ?? [];
  const myId = useGameStore((s) => s.myPlayerId) ?? '';

  const [props_, setProps] = useState<number[]>([]);
  const [cash, setCash] = useState(0);
  const [exemption, setExemption] = useState(0);
  const [countering, setCountering] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [goOpen, setGoOpen] = useState(false);

  const me = players.find((p) => p.id === myId);
  const owe = turn?.mustPayRent === true && turn.currentPlayerId === myId;
  const involved = deal !== null && (deal.debtorId === myId || deal.creditorIds.includes(myId));
  const isOpen = open || involved || owe;

  useEffect(() => { if (deal === null) { setConfirming(false); setCountering(false); } }, [deal]);

  // The GO sub-flow must not outlive its parent. Without this a player who
  // opens it, then has the debt settled under them (the server auto-collects
  // the rent the moment an advance lands, and a creditor can accept at any
  // time), is left staring at an orphaned takeover over a live board with no
  // deal behind it.
  useEffect(() => { if (!isOpen) setGoOpen(false); }, [isOpen]);

  // OPEN ON A SENSIBLE DEAL, NOT ON AN EMPTY ONE.
  // Composing from zero means the first thing the screen ever says is "SHORT
  // BY £6.00M" — a red callout blaming you for not yet having used the
  // control. The exemption starts at the part of the rent you genuinely
  // cannot cover, and the cash at everything you can, so the opening state is
  // the honest offer and every edit moves away from it deliberately.
  const rentNow = deal?.totalRentOwed ?? turn?.rentAmount ?? 0;
  const cashNow = me?.money ?? 0;
  const seeded = useRef('');
  useEffect(() => {
    const key = `${deal?.dealId ?? 'none'}:${String(rentNow)}`;
    if (rentNow <= 0 || seeded.current === key) return;
    seeded.current = key;
    // Snap FIRST, then ask for the remainder. Seeding the exemption off the
    // unsnapped figure left the opening state £0.2M short of the rent — the
    // stepper's grid had rounded the cash down and the callout immediately
    // read "SHORT BY £0.20M", which is the nag this seeding exists to avoid.
    const payable = snapCash(Math.min(cashNow, rentNow), cashStep(Math.max(rentNow, cashNow)), cashNow);
    setCash(payable);
    setExemption(Math.max(0, rentNow - payable));
  }, [deal?.dealId, rentNow, cashNow]);

  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const emit = (ev: string, payload: object) => { socketManager.emit(ev, payload); };
  const myHex = me ? TOKEN_HEX[me.token] : TOKEN_HEX.blue;
  const dismiss = () => { close(false); setCountering(false); setConfirming(false); };

  // ── a live deal ──────────────────────────────────────────────────────────
  if (isOpen && deal && !countering) {
    return (
      <>
        <ReviewDeal
          open={!goOpen}
          deal={deal}
          me={me}
          myId={myId}
          players={players}
          properties={properties}
          confirming={confirming}
          onConfirmOpen={() => { setConfirming(true); }}
          onConfirmBack={() => { setConfirming(false); }}
          onAccept={() => { setConfirming(false); emit(EVENTS.DEAL_ACCEPT, { dealId: deal.dealId }); }}
          onReject={() => { emit(EVENTS.DEAL_REJECT, { dealId: deal.dealId }); }}
          onCancel={() => { emit(EVENTS.DEAL_CANCEL, { dealId: deal.dealId }); }}
          onCounter={() => {
            setProps(deal.offeredProperties);
            setCash(deal.offeredMoney);
            setExemption(deal.requestedExemption);
            setCountering(true);
          }}
          onClose={dismiss}
        />
        <GoAdvancePanel open={goOpen} onClose={() => { setGoOpen(false); }} me={me} properties={properties} />
      </>
    );
  }

  // ── compose / counter ────────────────────────────────────────────────────
  const owed = deal?.totalRentOwed ?? turn?.rentAmount ?? 0;
  const spaceIndex = deal?.spaceIndex ?? me?.position ?? 0;
  const creditorIds = deal?.creditorIds ?? (turn?.rentOwnerId != null ? [turn.rentOwnerId] : []);
  const debtorId = deal?.debtorId ?? myId;
  const myCash = me?.money ?? 0;
  const step = cashStep(Math.max(owed, myCash));
  const exStep = cashStep(Math.max(owed, 1));

  const propValue = sumPrice(props_);
  const covered = propValue + cash + exemption;
  const gap = covered - owed;
  const cashAfter = myCash - cash;

  const mineDiff = setDiff(
    groupCounts(holdingsAfter(properties, debtorId)),
    groupCounts(holdingsAfter(properties, debtorId, props_)),
  );
  const breaks = new Set(mineDiff.lost.map((c) => c.group));

  const goUsed = me?.goDeductionsUsed ?? 0;
  const goLeft = GO_LIFETIME_CAP - goUsed;
  const eligibleProps = offerable(properties, debtorId);

  const sendOffer = () => {
    emit(EVENTS.DEAL_OFFER, {
      creditorIds, spaceIndex, totalRentOwed: owed,
      offeredProperties: props_, offeredMoney: cash,
      requestedExemption: exemption > 0 ? exemption : owed,
    });
    close(false);
  };
  const sendCounter = () => {
    if (!deal) return;
    emit(EVENTS.DEAL_COUNTER, {
      dealId: deal.dealId,
      offeredProperties: props_, offeredMoney: cash, requestedExemption: exemption,
    });
    setCountering(false);
  };

  return (
    <>
      <RuleTakeover
        // THE GO FLOW IS A SUB-FLOW, SO THIS SURFACE GOES INERT UNDER IT.
        // Both are <Takeover>s and .rn-tk deliberately has no opaque fill (the
        // window layer carries it), so leaving this one `is-on` printed the
        // deal's own columns straight through the GO panel's masked band —
        // two full screens of text on top of each other. It fades back in
        // when the GO panel closes; nothing is unmounted either way.
        //
        // SUPERSEDED, AND KEPT ONLY AS DEFENCE IN DEPTH: `src/ui/takeoverStage.ts`
        // now buries any takeover that a later one opens over, generically, for
        // every pair — not just the two this component happens to own. Nothing
        // downstream depends on this `&& !goOpen`; deleting it would change no
        // behaviour. Do not read it as load-bearing.
        open={isOpen && !goOpen}
        turnHex={myHex}
        eyebrow={
          countering
            ? `RENT DEAL · YOUR COUNTER · ${nameOf(spaceIndex).toUpperCase()} · NOT SENT YET`
            : `RENT DEAL · TO ${creditorIds.map(name).join(' + ').toUpperCase() || '—'} · YOU CANNOT PAY IN CASH`
        }
        title={countering ? 'Counter the deal' : `£${m2(owed)}M owed · ${nameOf(spaceIndex)}`}
        tracker={<GoLoanPill player={me} />}
        onClose={dismiss}
        leftClass="rn-tight rn-fixed"
        rightClass="rn-tight"
        left={
          <>
            <Hdr
              label="You offer"
              note={props_.length > 0
                ? `${String(props_.length)} PICKED · £${m2(propValue)}M`
                : `${String(eligibleProps.length)} ASSETS · £${m2(myCash)}M CASH`}
            />
            {eligibleProps.length === 0 ? (
              <Empty>Nothing unbuilt and unmortgaged to offer</Empty>
            ) : (
              <AssetGrid label="Assets you offer">
                {eligibleProps.map((p) => (
                  <AssetChip
                    key={p.spaceIndex}
                    testId={`deal-${String(p.spaceIndex)}`}
                    spaceIndex={p.spaceIndex}
                    selected={props_.includes(p.spaceIndex)}
                    breaks={props_.includes(p.spaceIndex) && breaks.has(groupOf(p.spaceIndex) ?? 'brown')}
                    onToggle={() => {
                      setProps(props_.includes(p.spaceIndex)
                        ? props_.filter((x) => x !== p.spaceIndex)
                        : [...props_, p.spaceIndex]);
                    }}
                  />
                ))}
              </AssetGrid>
            )}
            <Stepper
              className="rn-step"
              value={cash}
              min={0}
              max={myCash}
              step={step}
              onChange={(v) => { setCash(snapCash(v, step, myCash)); }}
              ariaLabel={`Cash you pay, in steps of ${m2(step)} million`}
            >
              <StepReadout label="You pay"><Money value={cash} size="glance-lg" tone="gold" digits={3} /></StepReadout>
            </Stepper>
          </>
        }
        mid={
          <>
            <Hdr label="Deal maths" note={nameOf(spaceIndex).toUpperCase()} />
            <KV label={`${creditorIds.map(name).join(' + ') || 'They'} ${creditorIds.length === 1 ? 'forgives' : 'forgive'}`}>
              <Money value={exemption} size="hero-lg" tone="gold" digits={3} legible />
            </KV>
            <KV label="You still pay">
              <Money value={Math.max(0, owed - exemption)} size="glance-lg" digits={3} legible />
            </KV>
            {gap < -1 ? (
              <WarnCard
                head={`Short by £${m2(-gap)}M`}
                body="Add cash or property, or ask for a bigger exemption. A deal that does not clear the rent cannot settle the debt."
              />
            ) : gap > 1 ? (
              <WarnCard
                tone="warn"
                head={`Overpaying by £${m2(gap)}M`}
                body="You are handing over more than the rent. Pull the exemption down or drop an asset."
              />
            ) : (
              <WarnCard tone="good" head="Exactly covered" body={`Cash + property + exemption = £${m2(owed)}M of rent, to the penny.`} />
            )}
            <Consequences mine={mineDiff} />
            {mineDiff.changed.slice(0, 1).map((c) => <SetChangeRow key={c.group} change={c} />)}
          </>
        }
        right={
          <>
            <Hdr label="Exemption asked" note="SLIDE TO SET" />
            <Slider
              value={exemption}
              min={0}
              max={Math.max(owed, exStep)}
              step={exStep}
              onChange={setExemption}
              ariaLabel="Rent exemption requested"
            />
            {/* THE COLUMN BUDGET IS 233px AND THIS IS ALL OF IT:
                14.3 header + 44 slider + 3x26 rows + 44 button + 5x4 gaps =
                200.3. "Cash from you" and "Property offered" rows used to sit
                here too and put it 47px over — measured, and the GO button's
                bottom 4px was clipped, which takes a 44px tap target to 40.
                Both were duplication: the cash stepper in the left column IS
                the first number, and the second now leads that column's own
                header, where it sits beside the chips it is the sum of. */}
            <Row label="Exemption asked" current value={<Money value={exemption} size="glance" tone="gold" digits={3} />} />
            <Row
              label="Total covered"
              value={<Money value={covered} size="glance" tone={Math.abs(gap) <= 1 ? 'gain' : gap < 0 ? 'loss' : 'gold'} digits={3} />}
            />
            <Row label="Your cash after" value={<Money value={cashAfter} size="label" tone={cashAfter < owed / 4 ? 'low' : 'default'} digits={3} />} />
            {!countering && goLeft > 0 && (
              // GAP 3: the GO advance had no interface at all. It is a real
              // alternative to giving up deeds, so it sits beside one, and the
              // tracker in the head says what is already sold.
              // `note` is one short token, not a sentence: .kit-btn__note has
              // no `white-space:nowrap`, so "2 left · £2M each" wrapped to four
              // lines inside a 224px button and took it from 44px to 108px,
              // pushing the column 60px over. The full terms are on the
              // takeover this opens.
              <Button
                variant="secondary"
                label="Borrow against GO"
                note={`${String(goLeft)} LEFT`}
                ariaLabel={`Borrow against GO — ${String(goLeft)} advances left, £${String(GO_SALARY / 1_000_000)}M each`}
                onClick={() => { setGoOpen(true); }}
              />
            )}
          </>
        }
        context={
          <RuleContext
            properties={properties}
            myId={myId}
            hits={[spaceIndex, ...props_]}
            boardLabel="Board: gold is the rent tile and what you offer"
            who="Your move"
            phase={countering ? 'They must accept or counter' : `${creditorIds.map(name).join(' + ') || 'They'} must accept or counter`}
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
              label={countering ? 'Send counter' : 'Propose deal'}
              disabled={owed <= 0}
              onClick={countering ? sendCounter : sendOffer}
            />
          </>
        }
      />
      <GoAdvancePanel open={goOpen} onClose={() => { setGoOpen(false); }} me={me} properties={properties} owed={owed} />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// REVIEW
// ────────────────────────────────────────────────────────────────────────────

function ReviewDeal({
  open, deal, me, myId, players, properties, confirming,
  onConfirmOpen, onConfirmBack, onAccept, onReject, onCancel, onCounter, onClose,
}: {
  /** False while the GO sub-flow is up — same reason as the compose surface. */
  open: boolean;
  deal: RentDeal;
  me: Player | undefined;
  myId: string;
  players: Player[];
  properties: PropertyState[];
  confirming: boolean;
  onConfirmOpen: () => void;
  onConfirmBack: () => void;
  onAccept: () => void;
  onConfirmBack2?: never;
  onReject: () => void;
  onCancel: () => void;
  onCounter: () => void;
  onClose: () => void;
}) {
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const hexOf = (id: string) => {
    const p = players.find((q) => q.id === id);
    return p ? TOKEN_HEX[p.token] : TOKEN_HEX.blue;
  };
  const cashOf = (id: string) => players.find((p) => p.id === id)?.money ?? 0;

  // SERVER TRUTH: dealHandlers refuses a counter from lastOfferBy, so the
  // decider is whoever did NOT make the standing offer.
  const amDebtor = deal.debtorId === myId;
  const myMove = deal.lastOfferBy !== myId;
  const other = amDebtor ? (deal.creditorIds[0] ?? '') : deal.debtorId;
  const decider = deal.lastOfferBy === deal.debtorId ? (deal.creditorIds[0] ?? '') : deal.debtorId;
  const deciderHex = hexOf(decider);

  const propValue = sumPrice(deal.offeredProperties);
  const handedOver = propValue + deal.offeredMoney;
  const stillPayable = Math.max(0, deal.totalRentOwed - deal.requestedExemption);
  const debtorCash = cashOf(deal.debtorId);
  const myCash = cashOf(myId);

  const diff = setDiff(
    groupCounts(holdingsAfter(properties, deal.debtorId)),
    groupCounts(holdingsAfter(properties, deal.debtorId, deal.offeredProperties)),
  );
  const verdict = {
    mine: amDebtor ? diff : { lost: [], gained: [] },
    theirs: amDebtor ? undefined : diff,
    theirName: name(deal.debtorId),
  };
  const countered = deal.status === 'countered';

  return (
    <RuleTakeover
      open={open}
      turnHex={deciderHex}
      eyebrow={`RENT DEAL · ${countered ? 'COUNTERED' : 'ROUND 1'} · LAST OFFER BY ${name(deal.lastOfferBy).toUpperCase()}`}
      title={
        myMove
          ? countered ? `${name(deal.lastOfferBy)} countered` : `Review ${name(deal.lastOfferBy)}'s deal`
          : `Awaiting ${name(decider)}`
      }
      tracker={<GoLoanPill player={me} />}
      onClose={onClose}
      leftClass="rn-tight"
      rightClass="rn-tight"
      left={
        <>
          <Hdr
            label={amDebtor ? 'You hand over' : 'You receive'}
            note={`${name(deal.debtorId).toUpperCase()} · £${m2(debtorCash)}M`}
          />
          {deal.offeredProperties.length === 0 && deal.offeredMoney === 0 && <Empty>Nothing but the exemption</Empty>}
          {deal.offeredProperties.map((i) => (
            <Row key={i} label={nameOf(i)} group={groupOf(i)} value={<Money value={priceOf(i)} size="label" digits={3} />} />
          ))}
          {deal.offeredMoney > 0 && <Row label="Cash now" value={<Money value={deal.offeredMoney} size="label" digits={3} />} />}
          <Line />
          <Row label="Total now" current value={<Money value={handedOver} size="glance" tone="gold" digits={3} />} />
          <Row label="Full rent was" value={<Money value={deal.totalRentOwed} size="label" digits={3} />} />
          <Row
            label={amDebtor ? 'Your cash after' : 'Debtor cash after'}
            value={<Money value={debtorCash - deal.offeredMoney} size="label" digits={3} />}
          />
        </>
      }
      mid={
        <>
          <Hdr label={amDebtor ? 'They forgive' : 'You forgive'} note={`£${m2(deal.totalRentOwed)}M OWED`} />
          <KV label="Rent written off">
            <Money value={deal.requestedExemption} size="hero-lg" tone={amDebtor ? 'gold' : 'loss'} digits={3} legible />
          </KV>
          <KV label="Still payable"><Money value={stillPayable} size="glance-lg" digits={3} legible /></KV>
          {!amDebtor && debtorCash < deal.totalRentOwed && (
            <WarnCard
              tone="warn"
              head={`They hold £${m2(debtorCash)}M`}
              body={`Demand the full £${m2(deal.totalRentOwed)}M and they go bankrupt: you take property at book value instead of cash.`}
            />
          )}
          <Consequences {...verdict} />
          {diff.changed.slice(0, 1).map((c) => <SetChangeRow key={c.group} change={c} />)}
        </>
      }
      right={
        <>
          <Hdr label={amDebtor ? 'Your position' : 'They ask for'} note={`${name(other).toUpperCase()} · £${m2(cashOf(other))}M`} />
          <Row label="Exemption" current value={<Money value={deal.requestedExemption} size="glance" tone="gold" digits={3} />} />
          <Row label="Still pays" value={<Money value={stillPayable} size="label" digits={3} />} />
          <Row label="Property offered" value={<Money value={propValue} size="label" digits={3} />} />
          <Line />
          <Row
            label="If refused"
            value={debtorCash < deal.totalRentOwed ? <Badge tone="jail">BANKRUPTCY</Badge> : <Badge tone="warn">FULL RENT DUE</Badge>}
          />
          {deal.totalRentOwed > 0 && (
            <>
              <Cap>Share of the rent this covers</Cap>
              <Meter
                pct={(handedOver / deal.totalRentOwed) * 100}
                tone={handedOver >= deal.totalRentOwed ? 'good' : handedOver >= deal.totalRentOwed / 2 ? 'warn' : 'bad'}
                ariaLabel="Value offered against rent owed"
              />
            </>
          )}
          {myMove && (
            <>
              <Cap>Quick reply · keeps the deal open</Cap>
              <div className="rn-qr">
                <QuickReply
                  label="Need more"
                  sent="Sent"
                  onSend={() => {
                    // A counter that changes nothing but hands the move back
                    // is the cheapest possible "not yet" — the loop stays open
                    // and the other side can see it is on them again.
                    socketManager.emit(EVENTS.DEAL_COUNTER, {
                      dealId: deal.dealId,
                      offeredProperties: deal.offeredProperties,
                      offeredMoney: deal.offeredMoney,
                      requestedExemption: Math.max(0, Math.round(deal.requestedExemption * 0.5)),
                    });
                  }}
                />
                <Arm face="No deal" confirm="Tap to reject" onConfirm={onReject} />
              </div>
            </>
          )}
          {!myMove && amDebtor && <Cap>You made the standing offer — they must reply before you can change it</Cap>}
        </>
      }
      context={
        <RuleContext
          properties={properties}
          myId={myId}
          hits={[deal.spaceIndex, ...deal.offeredProperties]}
          boardLabel="Board: gold is the rent tile and what is on the table"
          who={myMove ? 'Your move' : `${name(decider)}'s move`}
          phase={myMove ? 'Accept · counter · reply' : 'They are deciding'}
          color={deciderHex}
        />
      }
      actions={
        myMove ? (
          <>
            <Button variant="secondary" label="Counter" onClick={onCounter} />
            <Button variant="primary" label="Accept" onClick={onConfirmOpen} />
          </>
        ) : amDebtor ? (
          <>
            <Arm face="Cancel deal" confirm="Tap to withdraw" onConfirm={onCancel} />
            <Button variant="primary" waiting label={`Waiting · ${name(decider)}`} />
          </>
        ) : (
          <Button variant="primary" waiting label={`Waiting · ${name(decider)}`} />
        )
      }
      confirm={
        <ConfirmPlate
          open={confirming && myMove}
          sub="EXPLICIT CONFIRM · IRREVERSIBLE"
          title="Accept rent deal?"
          rows={[
            {
              label: amDebtor ? 'You give' : 'You receive',
              value: <span className="kit-t-micro kit-t-caps rn-trunc">{
                [...deal.offeredProperties.map(nameOf), ...(deal.offeredMoney > 0 ? [`£${m2(deal.offeredMoney)}M`] : [])].join(' + ') || 'Nothing'
              }</span>,
            },
            {
              label: amDebtor ? 'They write off' : 'You write off',
              value: <Money value={deal.requestedExemption} size="glance" tone="loss" digits={3} />,
            },
            { label: 'vs full rent', value: <Money value={deal.totalRentOwed} size="glance" digits={3} /> },
            { label: 'The debt', value: <Badge tone="good">CLEARED</Badge> },
            ...(amDebtor ? [{ label: 'Your cash after', value: <Money value={myCash - deal.offeredMoney} size="glance" digits={3} /> }] : []),
          ]}
          note="This cannot be undone"
          noteBody="The exemption is permanent and the rent can never be re-claimed. Transferring assets is the other place Mockopoly keeps a real confirmation."
          okLabel="Accept deal"
          onOk={onAccept}
          onBack={onConfirmBack}
        />
      }
    />
  );
}
