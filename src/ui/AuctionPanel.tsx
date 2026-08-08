import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_SPACES, COLOR_GROUPS } from '../constants/board';
import { COLOR_GROUP_HEX, TOKEN_HEX } from '../constants/theme';
import { socketManager } from '../network/SocketManager';
import { selectMyPlayer, useGameStore } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import type { S_AuctionBid, S_AuctionStart, S_AuctionWon } from '../types/SocketEvents';
import { formatMoney } from '../utils/format';
import {
  Arm, Badge, BtnRow, Button, CAPS, DeedRowView, KIT, Meter, Money, NUM, SetPips,
  Takeover, TakeoverCol, TakeoverRule, TurnStrip, TYPE, groupColor, turnStyle,
} from './kit';
import {
  AUCTION_INCREMENTS, bidPressurePct, composeBid, cushionTone, incrementOverflows,
  isLegalBid, minLegalBid, openingBid,
} from './takeoverMath';
import {
  ColCap, Cons, EstRow, FootCtx, FootNote, HeadCap, LotDeed, MID_COL_W,
  TakeoverHead, TakeoverHost, TriBody,
} from './takeoverParts';

/**
 * THE AUCTION — a broken rule, not just a missing screen.
 *
 * The server implements the whole thing (PROPERTY_AUCTION_START / AUCTION_BID /
 * AUCTION_PASS / PROPERTY_AUCTION_BID / PROPERTY_AUCTION_WON, and
 * `turn.auctionState`). The client rendered NOTHING and fired a toast, so today
 * declining to buy starts an auction nobody can bid in.
 *
 * THE MODEL: SIMULTANEOUS OPEN OUTCRY WITH A RESETTING CLOCK. Everyone in
 * `activeBidderIds` may raise at any time and any bid resets the window. When a
 * bidder's window expires they pass, so when every window has expired the
 * standing high bid wins — which is exactly what the server's own
 * "complete when one bidder remains" rule already does. Strict rotation was
 * REJECTED: it needs a per-player timer, leaves my primary inert most of the
 * time, and stalls the whole table on one thinking player.
 *
 * THE CLOCK IS HONEST. It is not decoration: at zero, a non-leading bidder
 * emits AUCTION_PASS. Without that an AFK player deadlocks the auction forever
 * — a NEW broken rule in place of the old one. What happens at zero is stated
 * in the footer at all times, and the leader is never auto-passed.
 *
 * NO CLOSE ✕ ON THE LIVE AUCTION. Dismissing would be an implicit pass, and
 * close-and-click is exactly the memorised gesture that would fire it by
 * accident. PASS is the only exit and it is <Arm>-ed, at the top of the bid
 * column — ~270px from the footer primary, so the memorised bottom-right tap
 * can never reach the irreversible one.
 */

/** Seconds in a bidding window. Any bid resets it. */
export const AUCTION_WINDOW_S = 12;

interface Floor {
  id: string;
  name: string;
  color: string;
  bid: number;
  status: 'high' | 'in' | 'out' | 'capped';
}

export function AuctionPanel() {
  const auction = useGameStore((s) => s.state?.turn.auctionState ?? null);
  const players = useGameStore((s) => s.state?.players);
  const properties = useGameStore((s) => s.state?.properties);
  const myId = useGameStore((s) => s.myPlayerId);
  const me = useGameStore(selectMyPlayer);

  /**
   * `completeAuction()` nulls `turn.auctionState`, so the settled screen cannot
   * be derived from state — it only exists in the PROPERTY_AUCTION_WON payload.
   */
  const [won, setWon] = useState<S_AuctionWon | null>(null);
  /**
   * EACH PLAYER'S LAST ACTUAL BID, accumulated from PROPERTY_AUCTION_BID rather
   * than derived from the standing high. Deriving it showed a rival at
   * "high − 1 step", which after my own raise reported her last bid as a number
   * she never bid — a wrong figure on the one panel whose whole job is
   * reporting who bid what.
   */
  const [bids, setBids] = useState<Record<string, number>>({});
  /** The roster at open, so a player who has passed can still be listed. */
  const [roster, setRoster] = useState<string[]>([]);
  const [bid, setBid] = useState(0);
  /** Bumped on every clock reset; drives both the countdown and the button key. */
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const onStart = (d: S_AuctionStart) => {
      setWon(null);
      setBids({});
      setRoster(d.bidderIds);
    };
    const onBid = (d: S_AuctionBid) => {
      setBids((b) => ({ ...b, [d.playerId]: d.amount }));
    };
    const onWon = (d: S_AuctionWon) => { setWon(d); };

    socketManager.on(EVENTS.PROPERTY_AUCTION_START, onStart);
    socketManager.on(EVENTS.PROPERTY_AUCTION_BID, onBid);
    socketManager.on(EVENTS.PROPERTY_AUCTION_WON, onWon);
    return () => {
      socketManager.off(EVENTS.PROPERTY_AUCTION_START, onStart);
      socketManager.off(EVENTS.PROPERTY_AUCTION_BID, onBid);
      socketManager.off(EVENTS.PROPERTY_AUCTION_WON, onWon);
    };
  }, []);

  const live = auction !== null && auction.status === 'active';
  const spaceIndex = auction?.spaceIndex ?? won?.spaceIndex ?? -1;
  const high = auction?.currentHighBid ?? 0;
  const cash = me?.money ?? 0;
  const iAmHigh = myId !== null && auction?.currentHighBidderId === myId;
  const iAmBidder = myId !== null && (auction?.activeBidderIds.includes(myId) ?? false);

  /**
   * Re-open the pad on the LOWEST LEGAL RAISE every time the high bid moves, so
   * one tap of the primary is always a legal raise and a stale composed bid can
   * never survive an opponent's raise.
   */
  useEffect(() => {
    setBid(openingBid(high, cash) ?? 0);
    setEpoch((e) => e + 1);
  }, [high, cash, spaceIndex]);

  const open = live || won !== null;

  const passNow = useCallback(() => { socketManager.emit(EVENTS.AUCTION_PASS); }, []);
  const expire = useCallback(() => {
    if (!live || !iAmBidder || iAmHigh) return;
    passNow();
  }, [live, iAmBidder, iAmHigh, passNow]);

  const clock = useClock(AUCTION_WINDOW_S, epoch, expire);

  const space = spaceIndex >= 0 ? BOARD_SPACES.at(spaceIndex) : undefined;
  const group = space?.colorGroup;
  const groupHex = group ? groupColor(COLOR_GROUP_HEX[group], true) : KIT.gold;
  const members = useMemo(() => (group ? COLOR_GROUPS[group] ?? [] : []), [group]);
  const ownedBy = useCallback(
    (pid: string | null) => (pid === null ? 0 : members.filter((i) => properties?.find((p) => p.spaceIndex === i)?.ownerId === pid).length),
    [members, properties],
  );

  const floor: Floor[] = useMemo(() => {
    const ids = roster.length > 0 ? roster : (players ?? []).filter((p) => !p.isBankrupt).map((p) => p.id);
    return ids.flatMap<Floor>((id) => {
      const p = players?.find((x) => x.id === id);
      if (!p) return [];
      const active = auction?.activeBidderIds.includes(id) ?? false;
      const isHigh = auction?.currentHighBidderId === id;
      const status: Floor['status'] = isHigh ? 'high' : !active ? 'out' : p.money <= high ? 'capped' : 'in';
      // The leader's figure is seeded from state, not from the event stream: a
      // panel that mounts mid-auction (reconnect, a late first render) has no
      // PROPERTY_AUCTION_BID history, and reporting the standing high bidder at
      // £0 would be a wrong number on the row that matters most.
      return [{ id, name: p.name, color: TOKEN_HEX[p.token], bid: bids[id] ?? (isHigh ? high : 0), status }];
    });
  }, [roster, players, auction, bids, high]);

  const leaderId = auction?.currentHighBidderId ?? won?.playerId ?? null;
  const leader = players?.find((p) => p.id === leaderId);
  const myTone = me ? TOKEN_HEX[me.token] : KIT.gold;

  // ── the composed bid ──────────────────────────────────────────────────────
  const floorBid = openingBid(high, cash);
  const canCompose = floorBid !== null && !iAmHigh && iAmBidder;
  const legal = canCompose && isLegalBid(bid, high, cash);
  const leaves = cash - bid;
  const cushion = cushionTone(leaves, cash);
  const meterTone = leaves <= 0 ? 'bad' : cushion === 'low' ? 'warn' : 'gold';

  const bump = (delta: number) => {
    setBid((b) => composeBid(b, delta, high, cash) ?? b);
  };
  const placeBid = () => {
    if (!isLegalBid(bid, high, cash)) return;
    socketManager.emit(EVENTS.AUCTION_BID, { amount: bid });
  };
  const dismiss = () => { setWon(null); };

  const settled = won !== null;
  const noSale = settled && won.playerId === '';
  const iWon = settled && won.playerId === myId;

  // The host takes the same `open` as the surface: that is this panel's
  // registration with the takeover registry, which stands the HUD down and
  // ranks simultaneous takeovers by recency. See src/ui/takeoverStage.ts.
  return (
    <TakeoverHost open={open}>
      <Takeover
        open={open}
        label={settled ? 'Auction settled' : 'Property auction'}
        style={{
          ...turnStyle(myTone),
          // The bidding window. `warn` drains 12s -> 5s and urgent's own
          // hard-coded 5s drain covers 5 -> 0: two continuous drains that each
          // end exactly on their phase boundary, instead of the 20s turn default.
          '--dur-turn-warn': `${AUCTION_WINDOW_S - 5}s`,
        }}
        eyebrow={
          <TakeoverHead
            eyebrow={settled
              ? `Auction · space ${spaceIndex} · settled`
              : `Auction · space ${spaceIndex} · nobody bought it`}
            title={settled
              ? (noSale ? `${space?.name ?? 'Lot'} unsold` : `${iWon ? 'You take' : `${leader?.name ?? 'Winner'} takes`} ${space?.name ?? ''}`)
              : (space?.name ?? 'Auction')}
            cap={settled
              ? <HeadCap>{noSale ? 'No sale' : 'Hammer price'}</HeadCap>
              : <HeadCap tone={iAmHigh ? 'good' : 'muted'}>{high > 0 ? `High bid · ${iAmHigh ? 'you' : leader?.name ?? '—'}` : 'No bids yet'}</HeadCap>}
            value={<Money value={settled ? won.amount : high} size="hero-lg" tone="gold" digits={5} />}
          />
        }
        // A LIVE auction has NO close. A settled one is just a receipt.
        onClose={settled ? dismiss : undefined}
        footer={
          <>
            <FootCtx>
              <FootNote>
                {settled
                  ? (noSale ? 'No bids · the lot stays unowned' : `Sold at ${formatMoney(won.amount)}`)
                  : iAmHigh
                    ? `You lead · holds in ${clock.left}s`
                    : iAmBidder
                      ? `No bid in ${clock.left}s = you pass`
                      : 'You are out of this lot'}
              </FootNote>
              <TurnStrip
                who={settled ? 'Winner' : 'Your cash'}
                phase={settled ? (noSale ? 'Nobody' : leader?.name ?? '—') : formatMoney(cash)}
                color={settled ? (leader ? TOKEN_HEX[leader.token] : KIT.gold) : myTone}
              />
            </FootCtx>
            {settled ? (
              <Button variant="primary" label="Back to board" onClick={dismiss} />
            ) : iAmHigh ? (
              <Button
                key={`hi-${clock.key}`}
                variant="primary"
                waiting
                label="You are high"
                clock={clock.state}
                clockCount={clock.left}
              />
            ) : !iAmBidder ? (
              <Button
                key={`out-${clock.key}`}
                variant="primary"
                waiting
                label="Watching"
                clock={clock.state}
                clockCount={clock.left}
              />
            ) : (
              <Button
                key={`bid-${clock.key}`}
                variant="primary"
                sheen
                label={legal ? `Bid ${formatMoney(bid)}` : 'Cannot raise'}
                disabled={!legal}
                clock={clock.state}
                clockCount={clock.left}
                onClick={placeBid}
              />
            )}
          </>
        }
      >
        <TriBody>
          {/* ── read-only: the lot, and what it does to the sets ── */}
          <TakeoverCol top style={{ paddingInline: 10 }}>
            <LotDeed
              color={groupHex}
              sub={space?.colorGroup
                ? `${space.colorGroup.replace('-', ' ')} · ${settled && !noSale ? `owned by ${iWon ? 'you' : leader?.name ?? '—'}` : `space ${spaceIndex} · unowned`}`
                : 'Unowned'}
              rows={[
                { label: 'Rent', value: <Money value={space?.rents?.[0] ?? space?.price ?? 0} size="glance" tone="gold" />, current: true },
                { label: 'With colour set', value: <Money value={(space?.rents?.[0] ?? 0) * 2} size="glance" /> },
              ]}
            />
            <i className="kit-rule" />
            {/*
              ONE COUNT PER FACT. While the lot is live this column owns the set
              maths, because "who is close to a monopoly" is the whole reason to
              bid. Once it is SETTLED the count moves to the right column (which
              is headed WHAT CHANGED and is the only place a count belongs), and
              this column switches to the thing nothing else says: who holds
              each member of the group now. Showing both put "1/3" on screen
              twice and, in an earlier pass, disagreed with itself.
            */}
            {settled ? (
              members.map((idx) => {
                const holder = properties?.find((p) => p.spaceIndex === idx)?.ownerId ?? null;
                const holderName = holder === null ? 'Open' : holder === myId ? 'You' : players?.find((p) => p.id === holder)?.name ?? '—';
                return (
                  <EstRow
                    key={idx}
                    color={groupHex}
                    label={BOARD_SPACES.at(idx)?.name ?? `Space ${idx}`}
                    value={<span style={{ color: holder === null ? KIT.goldBright : KIT.text }}>{holderName}</span>}
                  />
                );
              })
            ) : members.length > 0 ? (
              <>
                <PipRow who="You" color={groupHex} owned={ownedBy(myId)} total={members.length} />
                {leader && leaderId !== myId && (
                  <PipRow who={leader.name} color={groupHex} owned={ownedBy(leaderId)} total={members.length} />
                )}
              </>
            ) : null}
            {!settled && leader && leaderId !== myId && ownedBy(leaderId) + 1 >= members.length && members.length > 0 && (
              <Cons tone="warn" head={`${leader.name} completes the set`}>
                {`This is ${leader.name}'s last ${space?.colorGroup ?? ''} — winning it doubles their rent across the group.`}
              </Cons>
            )}
            {!settled && leaderId === myId && ownedBy(myId) + 1 >= members.length && members.length > 0 && (
              <Cons tone="good" head="This completes your set">
                Winning it doubles your rent across the whole group.
              </Cons>
            )}
          </TakeoverCol>

          <TakeoverRule />

          {settled ? (
            /* ── read-only: the money movement. Sparse by design. ── */
            <TakeoverCol top style={{ flex: `0 0 ${MID_COL_W}px`, gap: 2, overflow: 'hidden' }}>
              <ColCap>Money movement</ColCap>
              {noSale ? (
                <DeedRowView row={{ label: 'Nothing changed hands', value: <Money value={0} size="label" digits={5} /> }} />
              ) : (
                <>
                  {/* Three one-line rows, not a before/after pair on one row: the
                      arrow form measured 120px and left 32px for its label. */}
                  <DeedRowView row={{ label: iWon ? 'You pay' : `${leader?.name ?? 'Winner'} pays`, value: <Money value={won.amount} size="label" tone="loss" digits={5} />, current: true }} />
                  <DeedRowView row={{ label: iWon ? 'Your cash now' : 'Their cash now', value: <Money value={leader?.money ?? 0} size="label" digits={5} /> }} />
                  <DeedRowView row={{ label: iWon ? 'You still hold' : 'You kept', value: <Money value={cash} size="label" tone={iWon ? 'default' : 'gain'} digits={5} /> }} />
                </>
              )}
            </TakeoverCol>
          ) : (
            /* ── read-only: the floor. Every bidder's live state at once. ── */
            <TakeoverCol top style={{ flex: `0 0 ${MID_COL_W}px`, overflow: 'hidden' }}>
              <ColCap extra={<Badge tone="warn">No re-entry</Badge>}>Bidders</ColCap>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 }}>
                {floor.map((f) => <FloorRow key={f.id} row={f} isMe={f.id === myId} />)}
              </div>
            </TakeoverCol>
          )}

          <TakeoverRule />

          {settled ? (
            /*
             * WHAT CHANGED. A settlement that only reports what the WINNER
             * gained leaves the player who stopped bidding with nothing to
             * read, so the second block always states what stopping bought.
             */
            <TakeoverCol top style={{ gap: 8, paddingInline: 10 }}>
              <ColCap>What changed</ColCap>
              {members.length > 0 && !noSale && (
                <SetPips
                  color={groupHex}
                  owned={ownedBy(leaderId)}
                  total={members.length}
                  complete={ownedBy(leaderId) === members.length}
                />
              )}
              {noSale ? (
                <Cons tone="calm" head="Nobody bid">
                  {`${space?.name ?? 'The lot'} stays unowned. The next player to land on it can still buy it at ${formatMoney(space?.price ?? 0)}.`}
                </Cons>
              ) : iWon ? (
                <Cons tone={ownedBy(myId) === members.length ? 'good' : 'calm'} head={ownedBy(myId) === members.length ? 'You completed the set' : 'The lot is yours'}>
                  {`You hold ${ownedBy(myId)} of ${members.length}. It cost ${formatMoney(won.amount)} against a ${formatMoney(space?.price ?? 0)} list price.`}
                </Cons>
              ) : (
                <>
                  <Cons
                    tone={ownedBy(leaderId) === members.length ? 'danger' : 'warn'}
                    head={ownedBy(leaderId) === members.length ? `${leader?.name ?? 'They'} completed the set` : `${leader?.name ?? 'They'} took it`}
                  >
                    {`They hold ${ownedBy(leaderId)} of ${members.length} ${space?.colorGroup ?? ''}.`}
                  </Cons>
                  <i className="kit-rule" />
                  <Cons tone="good" head={`You kept ${formatMoney(cash)}`}>
                    Nothing you own changed hands.
                  </Cons>
                </>
              )}
            </TakeoverCol>
          ) : (
          /* ── interactive: my bid pad ──
             gap 5, measured: at 6 the pad totalled 230.4 in a 233.5 column —
             3px of slack, which is inside iOS font-metric variance and is how a
             MIN / ALL IN row ends up silently below the fold. */
          <TakeoverCol top style={{ gap: 5, paddingInline: 10 }}>
            {/*
              PASS AT THE TOP OF THIS COLUMN, ~270px from the footer primary.
              <Arm> restates the consequence before it fires, and it is disabled
              while I hold the high bid because passing on your own bid is not a
              legal move (`canPassAuction` would strand the lot).
            */}
            <Arm
              face="Pass on this lot"
              confirm="Tap again · no re-entry"
              onConfirm={passNow}
              disabled={!live || !iAmBidder || iAmHigh}
              ariaLabel="Pass on this lot — you cannot re-enter"
              style={{ width: '100%', boxShadow: `${KIT.liftTop}, ${KIT.ringHair}, ${KIT.shadow1}` }}
            />
            <i className="kit-rule" />

            {/*
              THE OVERSPEND GUARD IS A CONTINUOUS READOUT, NOT A GATE. The bid
              and what it LEAVES you sit on one baseline and the colour walks
              text -> warn -> danger as the cushion disappears. The hard ceiling
              is enforced by DISABLING the increments, so an illegal bid cannot
              be composed at all.
            */}
            <div style={bidLine}>
              <span style={bidLabel}>Your bid</span>
              <span style={{ ...TYPE.micro, ...CAPS, color: KIT.text2 }}>Leaves you</span>
            </div>
            {/* lineHeight 1: `normal` on a 26px <Money> is a 31.2px line box,
                and the two numbers only need their own cap height to share one
                optical baseline. */}
            <div style={{ ...bidLine, marginTop: -3, lineHeight: 1 }}>
              <Money value={bid} size="hero-lg" tone="gold" digits={5} />
              <Money value={Math.max(0, leaves)} size="glance-lg" tone={cushion} digits={5} />
            </div>
            <Meter pct={bidPressurePct(bid, cash)} tone={meterTone} ariaLabel="Bid against your cash" />

            <BtnRow>
              {AUCTION_INCREMENTS.map((inc) => (
                <Button
                  key={inc}
                  label={`+${formatMoney(inc)}`}
                  disabled={!canCompose || incrementOverflows(bid, inc, cash)}
                  onClick={() => { bump(inc); }}
                  style={{ flex: '1 1 0', minWidth: 0, padding: '0 4px' }}
                />
              ))}
            </BtnRow>
            <BtnRow>
              <Button
                variant="ghost"
                label="Min"
                note={formatMoney(minLegalBid(high))}
                disabled={!canCompose || minLegalBid(high) > cash}
                onClick={() => { setBid(minLegalBid(high)); }}
                style={{ flex: '1 1 0', minWidth: 0, padding: '0 8px' }}
              />
              <Button
                variant="ghost"
                label="All in"
                note={formatMoney(cash)}
                disabled={!canCompose || cash <= high}
                onClick={() => { setBid(cash); }}
                style={{ flex: '1 1 0', minWidth: 0, padding: '0 8px' }}
              />
            </BtnRow>
          </TakeoverCol>
          )}
        </TriBody>
      </Takeover>
    </TakeoverHost>
  );
}

/**
 * <SetPips> renders "2/3" but has no slot for WHOSE 2 of 3, and on this screen
 * two set rows sit one above the other — mine and the leader's. An unlabelled
 * pair is unreadable, so the name rides beside the pips.
 */
function PipRow({ who, color, owned, total }: { who: string; color: string; owned: number; total: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto', minWidth: 0 }}>
      <SetPips color={color} owned={owned} total={total} complete={owned === total} style={{ flex: '0 0 auto' }} />
      <span style={{ ...TYPE.micro, ...CAPS, color: KIT.text2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {who}
      </span>
    </div>
  );
}

/**
 * One bidder's live state.
 *
 * <Pod> is the read-only player row but it is built for the HUD's left column
 * (40px, glass, name stacked over cash) and this needs one 26px line inside
 * 184px with a status badge. Same visual language, tighter box.
 *
 * PASSED USES A SOLID COLOUR PLUS A LINE-THROUGH, NEVER OPACITY (rule R3), and
 * that treatment is what makes "passing is irreversible" visible on the floor
 * itself rather than only in the PASS button's own armed label.
 */
function FloorRow({ row, isMe }: { row: Floor; isMe: boolean }) {
  const out = row.status === 'out';
  const highest = row.status === 'high';
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 26, flex: '0 0 auto',
        padding: '0 12px 0 10px',
        borderLeft: `2px solid ${row.color}`,
        borderRadius: `0 ${KIT.rSm} ${KIT.rSm} 0`,
        background: highest
          ? `linear-gradient(90deg, color-mix(in srgb, ${row.color} 22%, transparent), transparent 88%)`
          : `linear-gradient(90deg, rgba(10,11,20,${out ? '.62' : '.72'}), rgba(10,11,20,${out ? '.14' : '.18'}))`,
        boxShadow: highest ? `inset 0 0 0 1px ${KIT.gold}, ${KIT.liftTop}` : KIT.liftTop,
      }}
    >
      <span
        style={{
          ...TYPE.label, fontWeight: 700, ...CAPS, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
          color: out ? '#8f8fa4' : highest || isMe ? KIT.text : KIT.text2,
          textDecoration: out ? 'line-through' : undefined,
        }}
      >
        {isMe ? 'You' : row.name}
      </span>
      {row.status === 'high' && <Badge tone="gold">High</Badge>}
      {row.status === 'in' && <Badge>In</Badge>}
      {row.status === 'out' && <Badge tone="out">Passed</Badge>}
      {row.status === 'capped' && <Badge tone="warn">Capped</Badge>}
      <span style={{ marginLeft: 'auto', flex: '0 0 auto', ...NUM }}>
        <Money value={row.bid} size="glance" tone={highest ? 'gold' : 'default'} digits={5} />
      </span>
    </div>
  );
}

/**
 * A 1Hz countdown that restarts whenever `epoch` changes.
 *
 * Returns the seconds left and a `key` the caller MUST put on the clock button.
 * A CSS animation only restarts when its `animation-name` changes, and the kit
 * uses the same `kit-clock-drain` for warn and urgent with different durations
 * — so flipping `data-clock` mid-flight keeps the elapsed time and the bar
 * visibly JUMPS. Remounting the button restarts the drain and the ring sweep
 * from full at exactly the moment the phase changes, and the geometry is
 * identical across the remount so there is no mis-tap window.
 */
function useClock(seconds: number, epoch: number, onExpire: () => void) {
  const [left, setLeft] = useState(seconds);
  const fired = useRef(-1);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    setLeft(seconds);
    const id = setInterval(() => { setLeft((t) => (t <= 0 ? 0 : t - 1)); }, 1000);
    return () => { clearInterval(id); };
  }, [seconds, epoch]);

  useEffect(() => {
    if (left > 0 || fired.current === epoch) return;
    fired.current = epoch;
    expire.current();
  }, [left, epoch]);

  const urgent = left <= 5;
  return { left, state: urgent ? ('urgent' as const) : ('warn' as const), key: `${epoch}-${urgent ? 'u' : 'w'}` };
}

const bidLine = {
  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
  gap: 8, paddingInline: 2, flex: '0 0 auto',
} as const;
const bidLabel = { ...TYPE.micro, fontWeight: 900, ...CAPS, letterSpacing: '1px', color: KIT.text2 } as const;
