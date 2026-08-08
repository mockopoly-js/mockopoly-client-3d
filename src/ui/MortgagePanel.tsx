import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import { COLOR_GROUP_HEX, TOKEN_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';
import { Arm, Button, Hold, KIT, Money, Panel, groupColor } from './kit';
import type { KitStyle } from './kit';
import { groupLabel } from './propertyDeed';
import { useHudStandDown } from './takeoverStage';

// Color groups that support building (exclude railroad and utility)
const BUILDABLE_GROUPS = new Set(['brown', 'light-blue', 'pink', 'orange', 'red', 'yellow', 'green', 'dark-blue']);

/**
 * Per-property manage panel: mortgage/unmortgage + build/sell for the
 * selected property. Migrated onto the kit's <Panel>.
 *
 * GAP 1 FIXED HERE: the panel never showed the viewer's own cash, even though
 * it is the one screen you open specifically because you need to know it —
 * a "Your cash" row is now the first thing in the body.
 *
 * GAP 4 FIXED HERE: this game's build rules differ from standard Monopoly —
 * no even-build (any property in an owned set, any order — already true of
 * the gating below, which only ever checks full-set ownership, never
 * even-ness across siblings), selling returns the FULL price (stated in the
 * <Arm> confirm text, which is exactly what <Arm> exists for — restating the
 * consequence), unmortgaging costs mortgageValue x 1.1 (shown as a plain
 * number AND restated in the <Hold> label), and a partnership's build cost is
 * split by equity (a note above the build controls, computed from the same
 * `activePartnershipForGroup` this file already resolves for the build gate).
 *
 * Design notes: mortgaging is semi-destructive, so it is a <Hold> (not the
 * <Arm> the kit's own JSDoc uses as a generic example) — selling a house is
 * the <Arm> case instead, per this migration's explicit brief.
 */
export function MortgagePanel() {
  const idx = useGameStore((s) => s.selectedPropertyIndex);
  const selectProperty = useGameStore((s) => s.selectProperty);
  const properties = useGameStore((s) => s.state?.properties);
  const players = useGameStore((s) => s.state?.players);
  const currentId = useGameStore((s) => s.state?.turn.currentPlayerId);
  const myId = useGameStore((s) => s.myPlayerId);
  const partnerships = useGameStore((s) => s.state?.partnerships);
  // Held open by `selectedPropertyIndex` until the player clears it, so it is
  // routinely still up when a takeover arrives — and this panel carries <Arm>
  // and <Hold> controls, which re-declare `visibility: visible` two levels
  // down. The stand-down's `opacity: 0` half is what actually covers those.
  const standDown = useHudStandDown();

  // .at() is BoardSpace | undefined — an out-of-range idx is a real runtime
  // possibility, so the guards below are live (and narrow space/prop to
  // non-null together with `open`).
  const space = idx != null ? BOARD_SPACES.at(idx) : undefined;
  const prop = space ? properties?.find((p) => p.spaceIndex === space.index) : undefined;
  const open = idx != null && !!space && !!prop;

  const me = players?.find((p) => p.id === myId);
  const mine = open && prop.ownerId === myId;
  const isMyTurn = currentId === myId;
  const canBuild = !!space && space.type === 'property'; // railroads/utilities can't build
  const houseCost = space?.houseCost ?? 0;
  const mortgageValue = space?.mortgageValue ?? 0;
  const liftCost = mortgageValue * 1.1;
  const rawAccent = open && space.colorGroup ? COLOR_GROUP_HEX[space.colorGroup] : KIT.gold;
  const accent = groupColor(rawAccent, true);

  const emit = (ev: string) => { if (idx != null) socketManager.emit(ev, { spaceIndex: idx }); };

  // ── Partnership check: is there an ACTIVE partnership for this color group
  // where I am a listed partner?
  const isBuildableGroup = space?.colorGroup != null && BUILDABLE_GROUPS.has(space.colorGroup);
  const activePartnershipForGroup = isBuildableGroup && partnerships != null
    ? (partnerships.find(
        (p) =>
          p.status === 'active' &&
          p.colorGroup === space.colorGroup &&
          p.partners.some((pe) => pe.playerId === myId),
      ) ?? null)
    : null;
  const hasPartnershipForGroup = activePartnershipForGroup != null;

  // ── Full color-group ownership check ──
  // For buildable properties: every member of the same colorGroup must be
  // owned by me (ownerId === myId) AND none can be mortgaged.
  // Partnership override: if an active partnership exists for this group and I
  // am a partner, treat it as owning the full group.
  const groupMemberIndices = isBuildableGroup
    ? BOARD_SPACES
        .filter((s) => s.type === 'property' && s.colorGroup === space.colorGroup)
        .map((s) => s.index)
    : [];
  const ownsFullGroup = hasPartnershipForGroup || (
    groupMemberIndices.length > 0 &&
    groupMemberIndices.every((gi) => {
      const gp = properties?.find((p) => p.spaceIndex === gi);
      return gp?.ownerId === myId && !gp.isMortgaged;
    })
  );

  // ── canManage: I can interact with build/sell buttons if I own it OR I am a
  // partner in an active partnership for this group.
  // Mortgage apply/lift remain owner-only (mine).
  const canManage = mine || hasPartnershipForGroup;

  const houses = prop?.houses ?? 0;
  const hasHotel = prop?.hasHotel ?? false;
  const isMortgaged = prop?.isMortgaged ?? false;

  const canMortgage = mine && !isMortgaged && houses === 0 && !hasHotel;
  const canLift = mine && isMortgaged;
  const canBuyHouse = canManage && isMyTurn && canBuild && ownsFullGroup && !isMortgaged && !hasHotel && houses < 4 && (me?.money ?? 0) >= houseCost;
  const canBuyHotel = canManage && isMyTurn && canBuild && ownsFullGroup && !isMortgaged && houses === 4 && !hasHotel && (me?.money ?? 0) >= houseCost;
  const canSellHouse = canManage && isMyTurn && canBuild && houses > 0 && !hasHotel;
  const canSellHotel = canManage && isMyTurn && canBuild && hasHotel;

  // GAP 4 (partnership split) — each partner's share of the NEXT build cost.
  const splitEntries = hasPartnershipForGroup
    ? activePartnershipForGroup.partners.map((pe) => ({
        playerId: pe.playerId,
        percentage: pe.percentage,
        player: players?.find((p) => p.id === pe.playerId),
        amount: (houseCost * pe.percentage) / 100,
      }))
    : [];

  return (
    <div style={{ ...stage, ...standDown.style }} aria-hidden={standDown.ariaHidden}>
      <Panel
        open={open}
        width="wide"
        scrim="light"
        onClose={() => { selectProperty(null); }}
        title={space?.name}
        sub={space?.colorGroup ? groupLabel(space.colorGroup) : undefined}
      >
        {open && (
          <>
            <i aria-hidden="true" style={{ ...band, background: accent, boxShadow: `0 0 12px 2px ${accent}` }} />

            {/* GAP 1 */}
            <div style={cashRow}>
              <span style={mutedLabel}>Your cash</span>
              <Money value={me?.money ?? 0} size="glance-lg" />
            </div>

            {!canManage && <div style={noOwnText}>You do not own this property.</div>}

            {mine && (
              <div style={section}>
                <div style={sectionTitle}>Mortgage</div>
                <div style={mortNums}>
                  <div style={metaCol}>
                    <span style={mutedLabel}>To mortgage</span>
                    <Money value={mortgageValue} size="glance" tone="gain" />
                  </div>
                  <div style={metaCol}>
                    <span style={mutedLabel}>To lift (110%)</span>
                    <Money value={liftCost} size="glance" tone="loss" />
                  </div>
                </div>
                {isMortgaged ? (
                  <Hold
                    tone="gold"
                    label={`Hold to lift · −${formatMoney(liftCost)}`}
                    ariaLabel="Unmortgage"
                    onComplete={() => { emit(EVENTS.MORTGAGE_LIFT); }}
                    disabled={!canLift}
                    style={holdBlock}
                  />
                ) : (
                  <Hold
                    tone="danger"
                    label={`Hold to mortgage · +${formatMoney(mortgageValue)}`}
                    ariaLabel="Mortgage"
                    onComplete={() => { emit(EVENTS.MORTGAGE_APPLY); }}
                    disabled={!canMortgage}
                    style={holdBlock}
                  />
                )}
              </div>
            )}

            {canManage && canBuild && (
              <div style={section}>
                <div style={sectionTitle}>Build</div>
                <div style={ruleNote}>No even-build — any order. Selling returns full price, not half.</div>

                {splitEntries.length > 0 && (
                  <div style={splitNote}>
                    <span style={mutedLabel}>Next house cost, split by equity</span>
                    <div style={splitRow}>
                      {splitEntries.map((e) => {
                        const isMe = e.playerId === myId;
                        const color = e.player ? TOKEN_HEX[e.player.token] : KIT.gold;
                        return (
                          <span key={e.playerId} style={isMe ? splitChipMine : splitChipOther}>
                            {!isMe && (
                              <i aria-hidden="true" style={{ ...dot, background: color, boxShadow: `0 0 8px 2px ${color}` }} />
                            )}
                            {isMe ? 'You' : e.player?.name ?? e.playerId} <b>{e.percentage}%</b>{' '}
                            <Money value={e.amount} size="micro" tone={isMe ? 'gold' : 'default'} />
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={buildStatus}>
                  <span style={buildCount}>{hasHotel ? 'Hotel' : `${houses} house${houses === 1 ? '' : 's'}`}</span>
                </div>

                <div style={btnGrid}>
                  <Button variant="secondary" label="Buy house" note={formatMoney(houseCost)} disabled={!canBuyHouse} onClick={() => { emit(EVENTS.BUILD_BUY_HOUSE); }} />
                  <Arm
                    face="Sell house"
                    confirm={`Full price +${formatMoney(houseCost)}`}
                    ariaLabel="Sell house"
                    disabled={!canSellHouse}
                    onConfirm={() => { emit(EVENTS.BUILD_SELL_HOUSE); }}
                  />
                  <Button variant="secondary" label="Buy hotel" note={formatMoney(houseCost)} disabled={!canBuyHotel} onClick={() => { emit(EVENTS.BUILD_BUY_HOTEL); }} />
                  <Arm
                    face="Sell hotel"
                    confirm={`Full price +${formatMoney(houseCost)}`}
                    ariaLabel="Sell hotel"
                    disabled={!canSellHotel}
                    onConfirm={() => { emit(EVENTS.BUILD_SELL_HOTEL); }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

// ── kit-surface host. Kit surfaces are position:absolute and need a
// full-size positioned ancestor of their own — see kit gotcha #1. ──
const stage: KitStyle = { position: 'fixed', inset: 0, zIndex: KIT.zPanel, pointerEvents: 'none' };
const band: KitStyle = { display: 'block', height: 6, borderRadius: 4, margin: `0 ${KIT.rowPad} ${KIT.sp2}` };
const cashRow: KitStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${KIT.rowPad}` };
const mutedLabel: KitStyle = {
  fontSize: KIT.fsMicro, fontWeight: 700, color: KIT.text2,
  textTransform: 'uppercase', letterSpacing: KIT.lsWide,
};
const noOwnText: KitStyle = { fontSize: KIT.fsLabel, color: KIT.text2, padding: `${KIT.sp2} ${KIT.rowPad}` };
const section: KitStyle = { marginTop: KIT.sp2, padding: `${KIT.sp2} ${KIT.rowPad}`, borderTop: `1px solid ${KIT.borderSoft}` };
const sectionTitle: KitStyle = { fontSize: KIT.fsLabelLg, fontWeight: 700, color: KIT.text };
const mortNums: KitStyle = { display: 'flex', gap: KIT.sp5, marginTop: KIT.sp2 };
const metaCol: KitStyle = { display: 'flex', flexDirection: 'column', gap: 1 };
const holdBlock: KitStyle = { width: '100%', marginTop: KIT.sp2 };
const ruleNote: KitStyle = { fontSize: KIT.fsMicro, color: KIT.text2, lineHeight: 1.35, marginTop: 2 };
const splitNote: KitStyle = { marginTop: KIT.sp2 };
const splitRow: KitStyle = { marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: KIT.sp3, fontSize: KIT.fsLabel, fontWeight: 600, color: KIT.text };
const splitChipMine: KitStyle = { display: 'inline-flex', alignItems: 'center', gap: 4 };
const splitChipOther: KitStyle = { display: 'inline-flex', alignItems: 'center', gap: 4, color: KIT.text2 };
const dot: KitStyle = { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' };
const buildStatus: KitStyle = { marginTop: KIT.sp2 };
const buildCount: KitStyle = {
  fontSize: KIT.fsMicro, fontWeight: 800, color: KIT.gold,
  textTransform: 'uppercase', letterSpacing: KIT.lsWide,
};
const btnGrid: KitStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: KIT.tapGap, marginTop: KIT.sp2 };
