import { useGameStore } from '../state/gameStore';
import { BOARD_SPACES } from '../constants/board';
import { COLOR_GROUP_HEX, TOKEN_HEX } from '../constants/theme';
import { Badge, Deed, KIT, Money, Panel, groupColor } from './kit';
import type { KitStyle } from './kit';
import type { Partnership, Player } from '../types/GameState';
import {
  buildRentRows, currentRentTier, equityOf, groupLabel, myPartnershipFor, otherPartners, rentTierValue,
} from './propertyDeed';
import { useHudStandDown } from './takeoverStage';

/**
 * Read-only deed inspect, opened when the player taps a tile on the 3D board.
 * Reads `deedCardIndex` — separate from `selectedPropertyIndex` /
 * `showPropertyCard`, which drive MortgagePanel.
 *
 * GAP 2/3 FIXED HERE. The old version showed the owner's name and stopped —
 * a partner reading a deed inside their own partnership had no way to see
 * their stake, and the printed rent is what the PAYER owes, not what a
 * partner actually pockets. Both share ONE "Partnership" block below the
 * ladder: it always names every partner and their equity (gap 2), and — only
 * when a rent tier is currently active (mortgaged / unowned show neither) —
 * each row also carries that partner's £ share of it (gap 3), answering
 * "what do I actually get" at the exact point a partner could otherwise
 * misread the ladder as their own income. One block, not two, was a deliberate
 * tightening: a separate "who's in it" strip above a separate "here's the
 * split" block measured ~35px taller for the fully redundant equity
 * percentages, on the same 312px panel width the kit's own <Deed> docs already
 * budget close to the edge of.
 */
export function PropertyCardModal() {
  const deedCardIndex = useGameStore((s) => s.deedCardIndex);
  const closeDeedCard = useGameStore((s) => s.closeDeedCard);
  const properties = useGameStore((s) => s.state?.properties);
  const players = useGameStore((s) => s.state?.players);
  const partnerships = useGameStore((s) => s.state?.partnerships);
  const myId = useGameStore((s) => s.myPlayerId);
  // A tapped-open deed is opened by the player and closed by the player —
  // nothing dismisses it when a takeover arrives, and at --z-panel (134) it is
  // UNDER --z-takeover (140) with its own scrim, so it would print through.
  const standDown = useHudStandDown();

  // .at() is BoardSpace | undefined — an out-of-range index is a real runtime
  // possibility, so the guard below is live (and narrows space to non-null).
  const space = deedCardIndex !== null ? BOARD_SPACES.at(deedCardIndex) : undefined;
  const open = deedCardIndex !== null && !!space;

  const propState = space ? properties?.find((p) => p.spaceIndex === space.index) : undefined;
  const ownerId = propState?.ownerId ?? null;
  const owner: Player | undefined = ownerId ? players?.find((pl) => pl.id === ownerId) : undefined;
  const amIOwner = myId != null && ownerId === myId;

  const myPs: Partnership | null = open ? myPartnershipFor(space.colorGroup, partnerships, myId) : null;

  const mortgaged = !!propState?.isMortgaged;
  const houseCount = propState?.houses ?? 0;
  const hasHotel = propState?.hasHotel ?? false;

  const rawAccent = open && space.colorGroup ? COLOR_GROUP_HEX[space.colorGroup] : KIT.gold;
  const accent = groupColor(rawAccent, true);

  const current = open
    ? currentRentTier(space, { ownerId, houses: houseCount, hasHotel, isMortgaged: mortgaged }, properties, partnerships)
    : -1;
  const rows = open ? buildRentRows(space.rents, current) : [];
  const rentValue = open && space.rents && current >= 0 ? rentTierValue(space.rents, current) : null;

  const stateLabel = mortgaged ? 'Mortgaged' : hasHotel ? 'Hotel' : houseCount > 0 ? `${houseCount} house${houseCount === 1 ? '' : 's'}` : null;

  // "Partnership" is deliberately left off this line — the partnership block
  // below already carries it, and this line wrapping to a second row was
  // measured to cost ~16px of an already-tight 312px-panel budget for no new
  // information.
  const subParts = open
    ? [
        space.colorGroup ? groupLabel(space.colorGroup) : null,
        owner ? `Owned by ${amIOwner ? 'you' : owner.name}` : 'Unowned',
      ].filter((p): p is string => p != null)
    : [];

  return (
    <div style={{ ...stage, ...standDown.style }} aria-hidden={standDown.ariaHidden}>
      <Panel
        open={open}
        width="narrow"
        scrim="light"
        onClose={closeDeedCard}
        label={space ? `${space.name} deed` : 'Property deed'}
      >
        {open && (
          <Deed color={accent} title={space.name} sub={subParts.join(' · ')} rows={rows} mortgaged={mortgaged}>
            {stateLabel && (
              <div style={badgeRow}>
                <Badge tone={mortgaged ? 'warn' : 'good'}>{stateLabel}</Badge>
              </div>
            )}

            {myPs && myId != null && (
              <div style={partnerBlock}>
                <div style={mutedLabel}>{rentValue != null ? 'Partnership · this tier' : 'Partnership'}</div>
                <div style={splitRows}>
                  <div style={splitRowMine}>
                    YOU <b style={boldGold}>{equityOf(myPs, myId)}%</b>
                    {rentValue != null && <>{' '}<Money value={(rentValue * equityOf(myPs, myId)) / 100} size="label" tone="gold" /></>}
                  </div>
                  {otherPartners(myPs, myId).map((p) => {
                    const partner = players?.find((pl) => pl.id === p.playerId);
                    const dotColor = partner ? TOKEN_HEX[partner.token] : KIT.gold;
                    return (
                      <div key={p.playerId} style={splitRowOther}>
                        <i aria-hidden="true" style={{ ...partnerDot, background: dotColor, boxShadow: `0 0 8px 2px ${dotColor}` }} />
                        {partner?.name ?? p.playerId} <b style={boldText}>{p.percentage}%</b>
                        {rentValue != null && <>{' '}<Money value={(rentValue * p.percentage) / 100} size="label" /></>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Deed>
        )}
      </Panel>
    </div>
  );
}

// ── kit-surface host. Kit surfaces are position:absolute and need a
// full-size positioned ancestor of their own — see kit gotcha #1. ──
const stage: KitStyle = { position: 'fixed', inset: 0, zIndex: KIT.zPanel, pointerEvents: 'none' };
const badgeRow: KitStyle = { padding: `${KIT.sp1} ${KIT.rowPad} 0` };
const mutedLabel: KitStyle = {
  fontSize: KIT.fsMicro, fontWeight: 700, color: KIT.text2,
  textTransform: 'uppercase', letterSpacing: KIT.lsWider,
};
const partnerBlock: KitStyle = { marginTop: KIT.sp1, padding: `${KIT.sp1} ${KIT.rowPad} ${KIT.sp2}`, borderTop: `1px solid ${KIT.borderSoft}` };
const partnerDot: KitStyle = { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' };
const boldGold: KitStyle = { color: KIT.goldBright, fontWeight: 800 };
const boldText: KitStyle = { color: KIT.text, fontWeight: 800 };
const splitRows: KitStyle = { marginTop: 3, display: 'flex', flexDirection: 'column', gap: 3 };
const splitRowMine: KitStyle = { fontSize: KIT.fsLabel, fontWeight: 600, color: KIT.text };
const splitRowOther: KitStyle = { display: 'flex', alignItems: 'center', gap: 5, fontSize: KIT.fsLabel, fontWeight: 600, color: KIT.text2 };
