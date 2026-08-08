import { useGameStore, selectMyPlayer, selectIsMyTurn } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import { COLOR_GROUP_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';
import { Arm, Badge, Button, Deed, KIT, Money, Panel, groupColor } from './kit';
import type { KitStyle } from './kit';
import { buildRentRows, groupLabel } from './propertyDeed';
import { useHudStandDown } from './takeoverStage';

const BUYABLE = ['property', 'railroad', 'utility'];

/**
 * The mandatory buy-or-decline decision, migrated onto the kit's right-slide
 * <Panel>. There is deliberately NO close (X) / dismiss route: the server
 * keeps the turn in the `action` phase until the player actually decides, and
 * offering a free dismissal here would say otherwise. Buy / Decline in the
 * footer are the only two ways out — Decline is a <Arm> because declining is
 * NOT "no consequence": it sends the property to auction (GAP 5), which is
 * now stated in place rather than left for the player to discover.
 *
 * GOTCHA #5: the panel stays mounted at all times (this component is an
 * always-rendered sibling in App.tsx) — `open` is a derived boolean, never an
 * early `return null`, so the close slide still gets to play when a decision
 * resolves the prompt away.
 */
export function BuyPrompt() {
  const me = useGameStore(selectMyPlayer);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const phase = useGameStore((s) => s.state?.turn.phase);
  const properties = useGameStore((s) => s.state?.properties);
  // This one can genuinely coincide: `open` is derived from turn phase, so a
  // buy prompt is up for as long as the player takes to decide, and any other
  // player's trade offer arrives as a takeover over the top of it. The prompt
  // is not cancelled by yielding — the server still holds the turn in `action`
  // and the whole surface is back, undecided, when the takeover closes.
  const standDown = useHudStandDown();

  // .at() is BoardSpace | undefined — a position outside 0..39 is a real
  // runtime possibility even though it narrows space to non-null below.
  const space = me ? BOARD_SPACES.at(me.position) : undefined;
  const buyable = !!space && BUYABLE.includes(space.type);
  const owned = space ? properties?.find((p) => p.spaceIndex === space.index) : undefined;
  const alreadyOwned = owned?.ownerId != null; // show unless a real owner exists (dense array today; robust if ever sparse)
  const price = space?.price ?? 0;

  const open = !!me && isMyTurn && phase === 'action' && buyable && !alreadyOwned && price > 0;

  const buy = () => { socketManager.emit(EVENTS.TURN_BUY_PROPERTY); };
  // The server's TURN_PASS_BUY handler (gameHandlers.ts) starts the auction
  // AND advances the turn once it settles — the client must not also emit
  // TURN_END here, or it would race/duplicate the server's own turn advance.
  const decline = () => { socketManager.emit(EVENTS.TURN_PASS_BUY); };

  const canAfford = open && me.money >= price;
  const rawAccent = open && space.colorGroup ? COLOR_GROUP_HEX[space.colorGroup] : KIT.gold;
  const accent = groupColor(rawAccent, true);
  // Hypothetical, not a live reading: nobody owns this yet, so tier 0 (base
  // rent) is shown as "current" purely as a buy-decision aid — never via
  // `currentRentTier`, which is reserved for an actually-owned property.
  const rows = open ? buildRentRows(space.rents, 0) : [];

  return (
    <div style={{ ...stage, ...standDown.style }} aria-hidden={standDown.ariaHidden}>
      <Panel
        open={open}
        scrim="light"
        label={space ? `${space.name} — buy or decline` : 'Buy property'}
        footer={open ? (
          <>
            <Button
              variant="primary"
              label={`Buy ${formatMoney(price)}`}
              disabled={!canAfford}
              onClick={buy}
              style={{ flex: '1 1 auto', minWidth: 0 }}
            />
            <Arm
              face="Decline"
              confirm="Tap again · auction"
              onConfirm={decline}
              ariaLabel="Decline — sends this property to auction"
              style={armFit}
            />
          </>
        ) : undefined}
      >
        {open && (
          <Deed
            color={accent}
            title={space.name}
            sub={space.colorGroup ? `${groupLabel(space.colorGroup)} · Unowned` : 'Unowned'}
            rows={rows}
            meta={[
              { label: 'Price', value: <Money value={price} size="glance-lg" tone="gold" /> },
              { label: 'Your cash', value: <Money value={me.money} size="glance-lg" tone={canAfford ? 'default' : 'low'} /> },
            ]}
          >
            <div style={auctionRow}>
              <span style={mutedLabel}>If declined</span>
              <Badge tone="warn">Goes to auction</Badge>
            </div>
            {!canAfford && <div style={warnText}>Not enough cash</div>}
          </Deed>
        )}
      </Panel>
    </div>
  );
}

// ── kit-surface host. Kit surfaces are position:absolute and need a
// full-size positioned ancestor of their own — see kit gotcha #1. ──
const stage: KitStyle = { position: 'fixed', inset: 0, zIndex: KIT.zPanel, pointerEvents: 'none' };
const auctionRow: KitStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: KIT.sp2, marginTop: KIT.sp2, padding: `0 ${KIT.rowPad}`,
};
const mutedLabel: KitStyle = {
  fontSize: KIT.fsMicro, fontWeight: 700, color: KIT.text2,
  textTransform: 'uppercase', letterSpacing: KIT.lsWide,
};
const warnText: KitStyle = { fontSize: KIT.fsLabel, color: KIT.dangerBright, marginTop: KIT.sp2, padding: `0 ${KIT.rowPad}` };
// .arm sizes to its face text only ("Decline") — .arm__confirm is
// position:absolute so it never grows the box, and its longer "Tap again ·
// auction" string would overflow a box sized for the shorter face string.
const armFit: KitStyle = { minWidth: 172 };
