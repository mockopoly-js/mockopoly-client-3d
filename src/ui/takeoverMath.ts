/**
 * PURE RULES for the two money takeovers — auction bidding and bankruptcy
 * liquidation.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT A HELPER INSIDE EACH PANEL
 * ---------------------------------------------------------------
 * Both surfaces are *arithmetic under pressure*: a bid composed in four taps
 * against a hard cash ceiling, and a shortfall recomputed on every chip tap.
 * Neither may ever produce a value the server will reject — on the auction that
 * would be a wasted tap under a running clock, and on the liquidation it would
 * be a "PAY" button that lies. So the rules live here, as functions with no
 * React and no DOM, and they are asserted directly rather than inferred from a
 * rendered button's `disabled` attribute.
 *
 * *** THE CLIENT IS DELIBERATELY STRICTER THAN THE SERVER. ***
 * `GameEngine.canBid` only requires `amount > currentHighBid && amount <= cash`
 * — a £1 raise is legal server-side. `minLegalBid()` adds a MINIMUM RAISE on
 * top, so the composed bid always clears the standing high by a meaningful step
 * and one tap of the primary is always a legal raise. `isLegalBid()` is the
 * server's rule, verbatim, and is what the panel actually gates on; the min
 * raise only shapes what the pad can COMPOSE.
 */

// ────────────────────────────────────────────────────────────────────────────
// AUCTION
// ────────────────────────────────────────────────────────────────────────────

/**
 * Smallest raise the bid pad will compose. Board prices run £600K–£4M, so £100K
 * is ~1/6th of the cheapest lot: fine-grained enough to snipe, coarse enough
 * that a £1-at-a-time war cannot happen.
 */
export const AUCTION_MIN_RAISE = 100_000;

/**
 * The three increments. £0.1M is the legal minimum raise; £0.5M and £1.0M are
 * the two jumps that actually end auctions.
 *
 * A RAW NUMERIC FIELD WAS REJECTED: nine tap targets, slow under a clock, and
 * it happily accepts a number above your cash — the illegal bid has to be
 * caught after the fact instead of being impossible to compose.
 * A <Stepper> WAS REJECTED: 13 taps to get from £1.7M to £3.0M.
 */
export const AUCTION_INCREMENTS: readonly number[] = [100_000, 500_000, 1_000_000];

/** The lowest amount the pad will compose against a standing high bid. */
export function minLegalBid(currentHighBid: number, minRaise: number = AUCTION_MIN_RAISE): number {
  return currentHighBid + minRaise;
}

/**
 * `GameEngine.canBid`, verbatim. This is the ONLY predicate the BID button is
 * allowed to gate on, so the client and the server can never disagree about
 * whether a tap was legal.
 */
export function isLegalBid(amount: number, currentHighBid: number, cash: number): boolean {
  if (!Number.isFinite(amount)) return false;
  return amount > currentHighBid && amount <= cash;
}

/**
 * The bid the pad opens on: the lowest legal raise, so ONE TAP OF THE PRIMARY
 * IS ALWAYS A LEGAL RAISE. Returns null when no legal raise exists at all
 * (min raise is over your cash) — the caller must then offer PASS only.
 *
 * The `cash > currentHighBid` fallback matters: with £1.05M against a £1.0M
 * high, the min raise (£1.1M) is unaffordable but £1.05M is still a legal bid,
 * and the pad opens there rather than locking you out of an auction you can
 * afford to win.
 */
export function openingBid(
  currentHighBid: number,
  cash: number,
  minRaise: number = AUCTION_MIN_RAISE,
): number | null {
  const floor = minLegalBid(currentHighBid, minRaise);
  if (floor <= cash) return floor;
  if (cash > currentHighBid) return cash;
  return null;
}

/**
 * Apply an increment to the composed bid and clamp it into the legal window.
 *
 * NEVER ABOVE CASH AND NEVER AT OR BELOW THE STANDING HIGH — those two
 * invariants hold for any `delta`, including a stale one from a button that
 * was live one frame before an opponent raised.
 */
export function composeBid(
  current: number,
  delta: number,
  currentHighBid: number,
  cash: number,
  minRaise: number = AUCTION_MIN_RAISE,
): number | null {
  const opening = openingBid(currentHighBid, cash, minRaise);
  if (opening === null) return null;
  const raw = current + delta;
  if (raw > cash) return cash;
  if (raw < opening) return opening;
  return raw;
}

/** True when tapping `+delta` would push the composed bid over your cash. */
export function incrementOverflows(current: number, delta: number, cash: number): boolean {
  return current + delta > cash;
}

/** 0..100 — the composed bid as a share of your cash, for the <Meter>. */
export function bidPressurePct(bid: number, cash: number): number {
  if (cash <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((bid / cash) * 100)));
}

/**
 * Colour walk for the LEAVES-YOU readout. The guard is a CONTINUOUS READOUT,
 * not a gate: the cushion is stated in money and in colour at every step, and
 * only the hard cash ceiling is enforced (by disabling the increments).
 */
export function cushionTone(leaves: number, cash: number): 'default' | 'gain' | 'low' | 'loss' {
  if (leaves <= 0) return 'loss';
  if (cash > 0 && leaves / cash < 0.25) return 'low';
  return 'gain';
}

// ────────────────────────────────────────────────────────────────────────────
// BANKRUPTCY LIQUIDATION
// ────────────────────────────────────────────────────────────────────────────

/** What a single tappable asset chip does when you select it. */
export type LiquidationKind = 'hotel' | 'house' | 'mortgage' | 'transfer';

export interface LiquidationAsset {
  /** Stable id — `hotel-39`, `house-39-2`, `mortgage-39`, `transfer-39`. */
  id: string;
  kind: LiquidationKind;
  spaceIndex: number;
  /** Property name. Fills the chip's fixed two-line box and leads the receipt. */
  name: string;
  /**
   * MEASURED: the chip has ~92px of label at 11px bold. The name alone needs
   * both lines of the name box ("Marlborough / Street", "The Angle /
   * Islington"), so the third fact rides the value line as a 2–5 character tag
   * — "HOTEL", "H3" — and the group header carries the rest.
   */
  tag: string;
  /** Plain-language action, for the accessible name and the receipt line. */
  verb: string;
  /** Colour-group hex, for the chip's 3px inset bar. */
  color: string;
  /**
   * Cash raised, or debt cancelled for a `transfer`. Both close the same gap by
   * the same arithmetic, which is why the shortfall sums them as one number.
   */
  value: number;
  /**
   * 1-based, counted DOWN from the top of the stack, for `house` only.
   * Buildings come off a property top-down, so house 3 must go before house 2.
   */
  storey?: number;
}

/** Money raised (and debt cancelled) by the current selection. */
export function raisedTotal(assets: readonly LiquidationAsset[], selected: ReadonlySet<string>): number {
  return assets.reduce((sum, a) => (selected.has(a.id) ? sum + a.value : sum), 0);
}

/**
 * The number the whole screen exists to report.
 *
 * Positive = still short by this much. Zero = exactly covered. Negative = spare
 * cash left over once the debt is paid, which is why this is NOT clamped: the
 * head shows "SOLVENT · SPARE £0.4M" off the same value and a clamped one could
 * only ever say "£0".
 */
export function shortfall(debt: number, cash: number, raised: number): number {
  return debt - cash - raised;
}

/** 0..100 — money raised against money needed, for the <Meter>. */
export function raisedPct(debt: number, cash: number, raised: number): number {
  const need = debt - cash;
  if (need <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((raised / need) * 100)));
}

/** Buildings still standing on a space once the selected ones are sold. */
export function buildingsRemaining(
  assets: readonly LiquidationAsset[],
  selected: ReadonlySet<string>,
  spaceIndex: number,
): number {
  return assets.filter(
    (a) => a.spaceIndex === spaceIndex
      && (a.kind === 'house' || a.kind === 'hotel')
      && !selected.has(a.id),
  ).length;
}

/**
 * Why this chip cannot be tapped yet, or null when it can.
 *
 * *** THE DEPENDENCIES ARE THE SERVER'S, NOT DECORATION. ***
 *   - `canSellHouse` refuses while a hotel stands  -> "SELL HOTEL"
 *   - `canMortgage` refuses while buildings stand  -> "SELL HOUSES"
 *   - a property cannot be both mortgaged and given away in one settlement
 * Every string is <= 11 characters, because the chip's value line is 13px of a
 * 44px box and a two-line reason pushes the name box out of the chip.
 */
export function blockedReason(
  asset: LiquidationAsset,
  assets: readonly LiquidationAsset[],
  selected: ReadonlySet<string>,
): string | null {
  const standing = buildingsRemaining(assets, selected, asset.spaceIndex);

  if (asset.kind === 'house') {
    const hotel = assets.find((a) => a.kind === 'hotel' && a.spaceIndex === asset.spaceIndex);
    if (hotel && !selected.has(hotel.id)) return 'SELL HOTEL';
    // Top-down: every storey above this one must already be sold.
    const above = assets.filter(
      (a) => a.kind === 'house'
        && a.spaceIndex === asset.spaceIndex
        && (a.storey ?? 0) > (asset.storey ?? 0)
        && !selected.has(a.id),
    );
    if (above.length > 0) return 'TOP FIRST';
    return null;
  }

  if (asset.kind === 'mortgage') {
    if (standing > 0) return 'SELL HOUSES';
    if (selected.has(`transfer-${asset.spaceIndex}`)) return 'GIVEN AWAY';
    return null;
  }

  if (asset.kind === 'transfer') {
    if (standing > 0) return 'SELL HOUSES';
    if (selected.has(`mortgage-${asset.spaceIndex}`)) return 'MORTGAGED';
    return null;
  }

  return null;
}

/**
 * Deselecting a building must also deselect whatever that sale unlocked, or the
 * tally would count an illegal move — you would be "raising" a mortgage on a
 * property that still has a house on it.
 *
 * Returns the new selection, never mutating the old one.
 */
export function toggleAsset(
  assets: readonly LiquidationAsset[],
  selected: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(selected);
  if (!next.has(id)) {
    next.add(id);
    return next;
  }
  next.delete(id);

  const asset = assets.find((a) => a.id === id);
  if (!asset) return next;
  if (asset.kind !== 'house' && asset.kind !== 'hotel') return next;

  // Cascade: anything on this space that is now illegal comes back off.
  for (const other of assets) {
    if (other.spaceIndex !== asset.spaceIndex) continue;
    if (!next.has(other.id)) continue;
    if (blockedReason(other, assets, next) !== null) next.delete(other.id);
  }
  return next;
}

/** The receipt line: two names, then a COMPUTED overflow count. Never a clamp. */
export function receiptLine(
  assets: readonly LiquidationAsset[],
  selected: ReadonlySet<string>,
): string {
  const names = assets
    .filter((a) => selected.has(a.id))
    .map((a) => `${a.name} ${a.verb}`);
  if (names.length === 0) return 'NOTHING SELECTED';
  const head = names.slice(0, 2).join(', ');
  return names.length > 2 ? `${head}  +${names.length - 2} more` : head;
}
