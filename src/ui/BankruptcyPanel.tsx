import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_SPACES, COLOR_GROUPS } from '../constants/board';
import { COLOR_GROUP_HEX, TOKEN_HEX } from '../constants/theme';
import { socketManager } from '../network/SocketManager';
import { selectMyPlayer, useGameStore } from '../state/gameStore';
import { useGameBusEvent } from '../state/useGameBus';
import { EVENTS } from '../types/SocketEvents';
import type { C_BankruptcyTransfer } from '../types/SocketEvents';
import { formatMoney } from '../utils/format';
import {
  Arm, Badge, Button, CAPS, DeedRowView, KIT, Meter, Money, NUM,
  Takeover, TakeoverCol, TakeoverRule, TurnStrip, TYPE, groupColor, turnStyle,
} from './kit';
import {
  blockedReason, raisedPct, raisedTotal, receiptLine, shortfall, toggleAsset,
  type LiquidationAsset,
} from './takeoverMath';
import {
  AssetChip, ChipGrid, ChipGroup, ColCap, Cons, ConfirmCard, EstRow, FootCtx, FootNote,
  HeadCap, MID_COL_W, MoreCue, ScrollBox, TakeoverHead, TakeoverHost, TriBody,
} from './takeoverParts';

/**
 * BANKRUPTCY LIQUIDATION — also missing entirely.
 *
 * `BANKRUPTCY_TRANSFER_ASSETS` is defined on both sides of the contract and
 * never listened for, so today a player can declare bankruptcy but cannot
 * choose what to liquidate. There is no screen at all between "you owe more
 * than you hold" and "you are out".
 *
 * TWO EMOTIONAL STATES, TWO TREATMENTS, ONE COMPONENT:
 *
 *   CHOOSE (voluntary)  a workbench. Dense, green, full of controls, and the
 *                       running shortfall is the loudest thing on screen. You
 *                       are here to survive.
 *   FORCED (bankrupt)   a settlement statement. Almost no controls, gold and
 *                       neutral rather than red, red reserved for the confirm
 *                       card alone. Losing is part of the game; the screen
 *                       states the facts, CREDITS WHAT YOU BUILT, and says what
 *                       happens next. It should not feel like a crash.
 *
 * HOUSE RULE: buildings sell back at FULL price, not half (`GameRoom.sellHouse`
 * refunds `space.houseCost`). That inverts the normal Monopoly advice, so it is
 * stated on the group header AND carried by every chip value.
 *
 * THE CONFIRM IS EXPLICIT AND IS NOT A NESTED MODAL — see <ConfirmCard>. This
 * is one of only two surfaces in the system that earns a real confirmation
 * rather than <Arm> or <Hold>, because it is an irreversible transfer of
 * everything.
 */

export interface BankruptcyPanelProps {
  /**
   * Controlled open state. Omit and the panel manages itself off the
   * `open-liquidation` bus event — the same shape `open-negotiation` already
   * uses for <DealPanel>.
   */
  open?: boolean;
  onClose?: () => void;
}

type Mode = 'choose' | 'forced';

export function BankruptcyPanel({ open, onClose }: BankruptcyPanelProps = {}) {
  const me = useGameStore(selectMyPlayer);
  const myId = useGameStore((s) => s.myPlayerId);
  const players = useGameStore((s) => s.state?.players);
  const properties = useGameStore((s) => s.state?.properties);
  const turn = useGameStore((s) => s.state?.turn);

  const [selfOpen, setSelfOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('choose');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [confirming, setConfirming] = useState(false);

  useGameBusEvent('open-liquidation', () => { setSelfOpen(true); });

  const close = useCallback(() => {
    setSelfOpen(false);
    setConfirming(false);
    setSelected(new Set<string>());
    setMode('choose');
    onClose?.();
  }, [onClose]);

  const debt = (turn?.mustPayRent ?? false) && turn?.currentPlayerId === myId ? turn.rentAmount ?? 0 : 0;
  const creditorId = turn?.rentOwnerId ?? null;
  const creditor = players?.find((p) => p.id === creditorId);
  const creditorName = creditor?.name ?? 'the bank';
  const cash = me?.money ?? 0;

  // ── the assets, straight off server state ─────────────────────────────────
  const assets: LiquidationAsset[] = useMemo(() => {
    const out: LiquidationAsset[] = [];
    for (const idx of me?.properties ?? []) {
      const space = BOARD_SPACES.at(idx);
      const st = properties?.find((p) => p.spaceIndex === idx);
      if (!space || !st) continue;
      const color = groupColor(space.colorGroup ? COLOR_GROUP_HEX[space.colorGroup] : KIT.gold, true);
      const houseCost = space.houseCost ?? 0;
      const mortgageValue = space.mortgageValue ?? 0;

      if (st.hasHotel && houseCost > 0) {
        out.push({ id: `hotel-${idx}`, kind: 'hotel', spaceIndex: idx, name: space.name, tag: 'HOTEL', verb: 'hotel', color, value: houseCost });
      }
      for (let n = st.houses; n >= 1; n--) {
        out.push({ id: `house-${idx}-${n}`, kind: 'house', spaceIndex: idx, name: space.name, tag: `H${n}`, verb: `house ${n}`, color, value: houseCost, storey: n });
      }
      if (!st.isMortgaged && mortgageValue > 0) {
        out.push({ id: `mortgage-${idx}`, kind: 'mortgage', spaceIndex: idx, name: space.name, tag: '', verb: 'mortgage', color, value: mortgageValue });
      }
      // The creditor is named once, on the group header — never on a chip. The
      // chip has ~92px of label and a creditor called "Alexandra" would eat it.
      out.push({
        id: `transfer-${idx}`, kind: 'transfer', spaceIndex: idx, name: space.name,
        tag: '', verb: 'given',
        color, value: st.isMortgaged ? mortgageValue : space.price ?? 0,
      });
    }
    return out;
  }, [me?.properties, properties]);

  const buildings = useMemo(() => assets.filter((a) => a.kind === 'hotel' || a.kind === 'house'), [assets]);
  const mortgages = useMemo(() => assets.filter((a) => a.kind === 'mortgage'), [assets]);
  const transfers = useMemo(() => assets.filter((a) => a.kind === 'transfer'), [assets]);

  const raised = raisedTotal(assets, selected);
  const short = shortfall(debt, cash, raised);
  const solvent = short <= 0;

  // Nothing to sell, mortgage or give — the workbench would be empty, so the
  // only honest screen is the settlement one.
  const nothingToRaise = assets.length === 0;
  const effMode: Mode = nothingToRaise || debt <= 0 ? 'forced' : mode;
  const isOpen = (open ?? selfOpen) && me !== undefined && !me.isBankrupt;

  /**
   * The debt going away — a rent deal, a GO deduction, a rescue — closes the
   * screen. ON THE TRANSITION ONLY: an earlier version closed on `debt <= 0`
   * outright, which instantly dismissed a panel opened with no pending rent at
   * all (resigning, or settling after the debt was cleared some other way).
   */
  const prevDebt = useRef(0);
  useEffect(() => {
    const had = prevDebt.current > 0;
    prevDebt.current = debt;
    if (had && debt <= 0 && open === undefined) close();
  }, [debt, open, close]);

  const scrollAssets = useRef<HTMLDivElement>(null);
  const scrollBuild = useRef<HTMLDivElement>(null);
  const scrollEstate = useRef<HTMLDivElement>(null);

  const toggle = (id: string) => { setSelected((s) => toggleAsset(assets, s, id)); };

  // ── commit ────────────────────────────────────────────────────────────────
  const transferValue = assets.reduce((n, a) => (a.kind === 'transfer' && selected.has(a.id) ? n + a.value : n), 0);
  const cashLeg = Math.max(0, debt - transferValue);

  /**
   * Order matters and it is the SERVER's order, not a preference: a hotel must
   * come down before its houses (`canSellHouse` refuses while one stands) and
   * every building must be gone before its property can be mortgaged or given.
   */
  const commitLiquidation = () => {
    for (const a of assets) {
      if (!selected.has(a.id)) continue;
      if (a.kind === 'hotel') socketManager.emit(EVENTS.BUILD_SELL_HOTEL, { spaceIndex: a.spaceIndex });
    }
    for (const a of assets) {
      if (!selected.has(a.id)) continue;
      if (a.kind === 'house') socketManager.emit(EVENTS.BUILD_SELL_HOUSE, { spaceIndex: a.spaceIndex });
    }
    for (const a of assets) {
      if (!selected.has(a.id)) continue;
      if (a.kind === 'mortgage') socketManager.emit(EVENTS.MORTGAGE_APPLY, { spaceIndex: a.spaceIndex });
    }
    socketManager.emit(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, {
      toPlayerId: creditorId,
      properties: assets.filter((a) => a.kind === 'transfer' && selected.has(a.id)).map((a) => a.spaceIndex),
      money: cashLeg,
    } satisfies C_BankruptcyTransfer);
    close();
  };

  const commitBankruptcy = () => {
    socketManager.emit(EVENTS.BANKRUPTCY_DECLARE);
    close();
  };

  // ── the record, for the forced screen ─────────────────────────────────────
  const netWorth = cash + assets.reduce((n, a) => (a.kind === 'transfer' || a.kind === 'house' || a.kind === 'hotel' ? n + a.value : n), 0);
  const monopolies = useMemo(() => {
    if (!myId) return [] as string[];
    return Object.entries(COLOR_GROUPS)
      .filter(([, members]) => members.length > 0 && members.every((i) => properties?.find((p) => p.spaceIndex === i)?.ownerId === myId))
      .map(([g]) => g);
  }, [myId, properties]);
  const stillIn = (players ?? []).filter((p) => !p.isBankrupt).length;
  const place = ordinal(stillIn);
  const buildingCount = buildings.length;
  // Every deed + the buildings line (if any) + the cash line, which always exists.
  const estateItems = transfers.length + (buildingCount > 0 ? 1 : 0) + 1;
  const forcedCredit = monopolies.length > 0
    ? {
      head: `You built the ${monopolies[0].replace('-', ' ')} monopoly`,
      body: `Worth ${formatMoney(netWorth)} across ${transfers.length} deeds and ${buildingCount} buildings.`,
    }
    : transfers.length > 0
      ? {
        head: `You held ${transfers.length} propert${transfers.length === 1 ? 'y' : 'ies'}`,
        body: `Worth ${formatMoney(netWorth)} at the end. ${creditorName} takes the lot.`,
      }
      : {
        head: `You lasted to ${place} of ${players?.length ?? 0}`,
        body: `${formatMoney(cash)} goes to ${creditorName}. You stay at the table and watch it play out.`,
      };
  const myTone = me ? TOKEN_HEX[me.token] : KIT.gold;

  const forced = effMode === 'forced';

  // The host takes the same `open` as the surface: that is this panel's
  // registration with the takeover registry, which stands the HUD down and
  // ranks simultaneous takeovers by recency. See src/ui/takeoverStage.ts.
  return (
    <TakeoverHost open={isOpen}>
      <Takeover
        open={isOpen}
        label={forced ? 'Bankruptcy settlement' : 'Choose what to liquidate'}
        style={turnStyle(forced ? KIT.gold : myTone)}
        eyebrow={
          <TakeoverHead
            eyebrow={forced ? `Bankruptcy · creditor ${creditorName}` : `Rent due to ${creditorName}`}
            title={forced ? 'Settling up' : `Raise ${formatMoney(Math.max(0, debt - cash))}`}
            cap={forced
              ? <HeadCap>Final position</HeadCap>
              : <HeadCap tone={solvent ? 'good' : 'bad'}>{solvent ? 'Solvent · spare' : 'Still short'}</HeadCap>}
            value={forced
              ? <span style={{ ...TYPE.heroLg, ...NUM, color: KIT.goldBright }}>{place}<span style={TYPE.label}> of {players?.length ?? 0}</span></span>
              : (
                /*
                 * THE RUNNING SHORTFALL, in the head, at hero size, ABOVE EVERY
                 * SCROLL REGION. It cannot be scrolled away and a growing list
                 * cannot push it down — it is not in the list's column at all.
                 * It is carried three times: here, by the <Meter> in the middle
                 * column, and by the receipt line's computed overflow count.
                 */
                <Money value={Math.abs(short)} size="hero-lg" tone={solvent ? 'gain' : 'loss'} digits={5} />
              )}
          />
        }
        // NO ✕ on either state: a debt cannot be dismissed, and neither can a
        // settlement. The honest exits are the footer primary and, on the
        // workbench, I CAN'T PAY at the far side of the screen.
        footer={
          <>
            <FootCtx>
              {/* <= 33 characters: <FootCtx> is capped at 240px so it never
                  reaches the middle of the frame, and 37 characters of 11px
                  caps was measured truncating mid-word. */}
              <FootNote>
                {forced ? 'Nothing is recoverable after this' : 'Mortgaged properties pay no rent'}
              </FootNote>
              <TurnStrip
                who="Creditor"
                phase={`${creditorName} · ${formatMoney(creditor?.money ?? 0)}`}
                color={creditor ? TOKEN_HEX[creditor.token] : KIT.gold}
              />
            </FootCtx>
            {forced ? (
              <Button variant="primary" label="Settle up" onClick={() => { setConfirming(true); }} />
            ) : (
              <Button
                variant="primary"
                label={`Pay ${creditorName} ${formatMoney(debt)}`}
                disabled={!solvent}
                onClick={() => { setConfirming(true); }}
              />
            )}
          </>
        }
      >
        {forced ? (
          <TriBody>
            {/* ── read-only: the estate, itemised. Nothing is hidden. ── */}
            <TakeoverCol top style={{ gap: 4, paddingInline: 10 }}>
              <ColCap extra={<Badge>{estateItems} {estateItems === 1 ? 'item' : 'items'}</Badge>}>
                {creditorName} receives
              </ColCap>
              <ScrollBox boxRef={scrollEstate}>
                {transfers.map((a) => (
                  <EstRow key={a.id} color={a.color} label={a.name} value={<Money value={a.value} size="micro" digits={5} />} />
                ))}
                {buildingCount > 0 && (
                  <EstRow
                    color={KIT.gold}
                    label={`${buildingCount} building${buildingCount === 1 ? '' : 's'}`}
                    value={<Money value={buildings.reduce((n, b) => n + b.value, 0)} size="micro" digits={5} />}
                  />
                )}
                <EstRow color={KIT.gold} label="All remaining cash" value={<Money value={cash} size="micro" digits={5} />} />
              </ScrollBox>
              <MoreCue scrollRef={scrollEstate} itemSelector="[data-estrow]" total={estateItems} />
            </TakeoverCol>

            <TakeoverRule />

            {/* ── read-only: the record. Sparse by design. ── */}
            <TakeoverCol top style={{ flex: `0 0 ${MID_COL_W}px`, gap: 2, overflow: 'hidden' }}>
              <ColCap>Your game</ColCap>
              <DeedRowView row={{ label: 'Properties', value: <span style={{ ...TYPE.glance, ...NUM }}>{transfers.length}</span> }} />
              <DeedRowView row={{ label: 'Buildings', value: <span style={{ ...TYPE.glance, ...NUM }}>{buildingCount}</span> }} />
              <DeedRowView row={{ label: 'Monopolies', value: <span style={{ ...TYPE.glance, ...NUM, color: KIT.goldBright }}>{monopolies.length}</span> }} />
              <DeedRowView row={{ label: 'Net worth', value: <Money value={netWorth} size="label" tone="gold" digits={5} />, current: true }} />
            </TakeoverCol>

            <TakeoverRule />

            {/* ── the way back, and what comes next ── */}
            <TakeoverCol top style={{ gap: 8, paddingInline: 10 }}>
              {/* An emergency exit exists even here: this screen is reachable
                  from I CAN'T PAY, and a mis-tap must be recoverable. */}
              {!nothingToRaise && debt > 0 && (
                <>
                  <Button variant="ghost" block label="Back — let me try again" onClick={() => { setMode('choose'); }} />
                  <i className="kit-rule" />
                </>
              )}
              {/*
                CREDIT WHAT WAS BUILT, from real state — never a stock
                consolation line. A monopoly is the thing worth naming; failing
                that, the estate; failing that, how far the money went. Losing
                is part of the game and this screen should not read like a
                crash report.
              */}
              <Cons tone="calm" head={forcedCredit.head}>{forcedCredit.body}</Cons>
              <ColCap>After this</ColCap>
              <EstRow color={myTone} label="You" value={<Badge>Spectating</Badge>} />
              <EstRow
                color={creditor ? TOKEN_HEX[creditor.token] : KIT.gold}
                label={creditorName}
                value={<span style={NUM}>{formatMoney(creditor?.money ?? 0)} → {formatMoney((creditor?.money ?? 0) + cash)}</span>}
              />
              <EstRow label={`${Math.max(0, stillIn - 1)} others`} value="Play on" />
            </TakeoverCol>
          </TriBody>
        ) : (
          <TriBody>
            {/* ── interactive: sell buildings, at FULL price ── */}
            <TakeoverCol top style={{ gap: 6, paddingInline: 10 }}>
              <ColCap extra={<Badge tone="good">Full price</Badge>}>Sell buildings · {buildings.length}</ColCap>
              {buildings.length > 0 ? (
                <>
                  <ScrollBox boxRef={scrollBuild}>
                    <ChipGrid>
                      {buildings.map((a) => (
                        <AssetChip
                          key={a.id}
                          color={a.color}
                          name={a.name}
                          tag={a.tag}
                          value={`+${formatMoney(a.value)}`}
                          ariaLabel={`${a.name} — sell ${a.verb}, raises ${formatMoney(a.value)}`}
                          selected={selected.has(a.id)}
                          blocked={blockedReason(a, assets, selected)}
                          hurt
                          onToggle={() => { toggle(a.id); }}
                        />
                      ))}
                    </ChipGrid>
                  </ScrollBox>
                  <MoreCue scrollRef={scrollBuild} itemSelector="button" total={buildings.length} />
                </>
              ) : (
                <div style={{ ...TYPE.micro, color: KIT.text2, paddingLeft: 5, marginBottom: 'auto' }}>
                  Nothing built — nothing to sell.
                </div>
              )}
              {/*
                THE FOLD. <Arm>, pinned to the bottom of the LEFT column —
                MEASURED 540px from the footer primary, so the memorised
                bottom-right tap can never reach it, and two taps are needed
                even then.
              */}
              <Arm
                face="I can't pay"
                confirm="Tap again · show the end"
                onConfirm={() => { setMode('forced'); }}
                ariaLabel="I can't pay — show the bankruptcy settlement"
                style={{ width: '100%', marginTop: 'auto', boxShadow: `${KIT.liftTop}, ${KIT.ringHair}, ${KIT.shadow1}` }}
              />
            </TakeoverCol>

            <TakeoverRule />

            {/* ── read-only: the arithmetic ── */}
            <TakeoverCol top style={{ flex: `0 0 ${MID_COL_W}px`, gap: 2, overflow: 'hidden' }}>
              <DeedRowView row={{ label: `Owed to ${creditorName}`, value: <Money value={debt} size="label" tone="loss" digits={5} /> }} />
              <DeedRowView row={{ label: 'Cash on hand', value: <Money value={cash} size="label" digits={5} /> }} />
              <DeedRowView row={{ label: 'Raised so far', value: <Money value={raised} size="label" tone={raised > 0 ? 'gain' : 'default'} digits={5} />, current: true }} />
              <div style={{ padding: '4px 12px 0' }}>
                <Meter pct={raisedPct(debt, cash, raised)} tone={solvent ? 'good' : 'warn'} ariaLabel="Raised against the shortfall" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 18, paddingInline: 12 }}>
                <span style={{ ...TYPE.micro, ...CAPS, color: KIT.text2 }}>
                  {solvent ? 'Target met' : `${formatMoney(short)} to go`}
                </span>
                <span style={{ marginLeft: 'auto', ...TYPE.micro, ...CAPS, ...NUM, color: KIT.text }}>{selected.size} selected</span>
              </div>
              <div style={{ paddingInline: 12 }}>
                <span style={{ ...TYPE.micro, fontWeight: 500, color: KIT.text2, lineHeight: 1.3 }}>{receiptLine(assets, selected)}</span>
              </div>
              {/*
                The house rule lives with the ARITHMETIC, not with the building
                grid. It reads better here (it is a statement about the numbers
                to its left) and it buys the grid 46px — measured, the
                difference between one and a half visible rows of chips and two
                and a half. This column is the display-only middle third, so a
                block of text is exactly what belongs in it.
              */}
              <div style={{ marginTop: 6 }}>
                <Cons tone="calm" head="Full price, not half">
                  A building sells back for exactly what it cost. Selling one keeps the set — it only drops the rent.
                </Cons>
              </div>
            </TakeoverCol>

            <TakeoverRule />

            {/* ── interactive: mortgage or give ── */}
            <TakeoverCol top style={{ gap: 8, paddingInline: 10 }}>
              <ColCap>Mortgage or give · {mortgages.length + transfers.length} options</ColCap>
              <ScrollBox boxRef={scrollAssets}>
                <ChipGrid>
                  <ChipGroup label={`Mortgage · ${mortgages.length}`} note="10% to buy back" />
                  {mortgages.map((a) => (
                    <AssetChip
                      key={a.id}
                      color={a.color}
                      name={a.name}
                      tag={a.tag}
                      value={`+${formatMoney(a.value)}`}
                      ariaLabel={`${a.name} — mortgage, raises ${formatMoney(a.value)}`}
                      selected={selected.has(a.id)}
                      blocked={blockedReason(a, assets, selected)}
                      onToggle={() => { toggle(a.id); }}
                    />
                  ))}
                  <ChipGroup label={`Give to ${creditorName} · ${transfers.length}`} note="Cuts the debt" />
                  {transfers.map((a) => (
                    <AssetChip
                      key={a.id}
                      color={a.color}
                      name={a.name}
                      tag={a.tag}
                      value={`−${formatMoney(a.value)}`}
                      ariaLabel={`${a.name} — give away, cuts the debt by ${formatMoney(a.value)}`}
                      selected={selected.has(a.id)}
                      blocked={blockedReason(a, assets, selected)}
                      onToggle={() => { toggle(a.id); }}
                    />
                  ))}
                </ChipGrid>
              </ScrollBox>
              <MoreCue scrollRef={scrollAssets} itemSelector="button" total={mortgages.length + transfers.length} />
            </TakeoverCol>
          </TriBody>
        )}

        <ConfirmCard
          open={confirming && isOpen}
          onDismiss={() => { setConfirming(false); }}
          cap={forced ? 'Confirm settlement' : 'Confirm payment'}
          headline={forced ? `Everything to ${creditorName}` : `${formatMoney(debt)} to ${creditorName}`}
          confirmLabel="Confirm"
          onConfirm={forced ? commitBankruptcy : commitLiquidation}
          rows={forced ? (
            <>
              <EstRow label="Properties" value={<span style={NUM}>{transfers.length}</span>} />
              <EstRow label="Buildings" value={<span style={NUM}>{buildingCount}</span>} />
              <EstRow label="Cash" value={<Money value={cash} size="label" digits={5} />} />
            </>
          ) : (
            <>
              <EstRow label="Sold / mortgaged / given" value={<span style={NUM}>{selected.size}</span>} />
              <EstRow label="Cash after" value={<Money value={cash + raised - transferValue - cashLeg} size="label" tone="gain" digits={5} />} />
            </>
          )}
          note={forced
            ? `You finish ${place} of ${players?.length ?? 0} and stay at the table as a spectator. This cannot be undone.`
            : 'Buildings come down and mortgages are recorded immediately. Nothing here can be undone.'}
        />
      </Takeover>
    </TakeoverHost>
  );
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
