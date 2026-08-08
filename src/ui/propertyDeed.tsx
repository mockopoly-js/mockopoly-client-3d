import { COLOR_GROUPS } from '../constants/board';
import type { BoardSpace, ColorGroup, Partnership, PropertyState } from '../types/GameState';
import { Money, type DeedRow } from './kit';

/**
 * Shared, pure helpers for rendering a property's rent ladder and partnership
 * equity — used by BuyPrompt (#buy), PropertyCardModal (#deed) and
 * MortgagePanel (#build/#mortgage), so the three screens can never disagree
 * about "what tier is active" or "what a partner's cut is".
 *
 * Rent-ladder tier order, matching <Deed rows>: RENT, WITH COLOUR SET (an
 * unimproved full colour set doubles the base rent — standard, unmodified
 * Monopoly; not one of this game's house-rule deviations), 1..4 HOUSES, HOTEL.
 * Railroads and utilities price rent differently (owned-count / dice-based)
 * and are out of scope here, matching the approved mockup's own scope cut.
 */
export const RENT_TIER_LABELS = [
  'Rent', 'With colour set', '1 house', '2 houses', '3 houses', '4 houses', 'Hotel',
] as const;

/** 'dark-blue' -> 'Dark blue'. Shared so BuyPrompt / PropertyCardModal /
 *  MortgagePanel never render three different capitalisations of the same
 *  colour group. */
export function groupLabel(colorGroup: string): string {
  const words = colorGroup.split('-');
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/**
 * Does `ownerId` effectively control every property in `colorGroup`? Either
 * solo ownership of every member, or an active partnership for the group that
 * lists them as a partner — the same "partnership counts as full ownership"
 * rule the build gate already applies (see MortgagePanel's `ownsFullGroup`).
 */
export function ownerHoldsFullGroup(
  ownerId: string | null | undefined,
  colorGroup: ColorGroup | undefined,
  properties: PropertyState[] | undefined,
  partnerships: Partnership[] | undefined,
): boolean {
  if (ownerId == null || colorGroup == null) return false;
  const partnered = partnerships?.some(
    (p) => p.status === 'active' && p.colorGroup === colorGroup && p.partners.some((pe) => pe.playerId === ownerId),
  ) ?? false;
  if (partnered) return true;
  const members = COLOR_GROUPS[colorGroup] ?? [];
  return members.length > 0 && members.every((idx) => properties?.find((p) => p.spaceIndex === idx)?.ownerId === ownerId);
}

export interface RentState {
  ownerId: string | null;
  houses: number;
  hasHotel: boolean;
  isMortgaged: boolean;
}

/**
 * Index into RENT_TIER_LABELS for the tier presently in effect, or -1 when no
 * rent applies right now: mortgaged, no rent ladder at all, or — the case
 * that matters most here — genuinely unowned, where there is no one to
 * collect it. (BuyPrompt's "if you buy this, here's what you could charge"
 * ladder is a deliberate hypothetical and does NOT go through this helper —
 * it calls `buildRentRows` directly with tier 0, so it can never be confused
 * with a live "this is what's owed" reading.)
 */
export function currentRentTier(
  space: BoardSpace,
  state: RentState | undefined,
  properties: PropertyState[] | undefined,
  partnerships: Partnership[] | undefined,
): number {
  if (!space.rents) return -1;
  if (!state || state.isMortgaged || state.ownerId == null) return -1;
  if (state.hasHotel) return 6;
  if (state.houses > 0) return state.houses + 1;
  if (ownerHoldsFullGroup(state.ownerId, space.colorGroup, properties, partnerships)) return 1;
  return 0;
}

/** The rent value for a given ladder tier (0-indexed into RENT_TIER_LABELS). */
export function rentTierValue(rents: number[], tier: number): number {
  if (tier <= 0) return rents[0];
  if (tier === 1) return rents[0] * 2;
  return rents[tier - 1];
}

/** Builds the <Deed rows> ladder — the current tier highlighted gold, every
 *  tier beyond it (not yet reachable) locked. Tiers already passed stay in
 *  full contrast: "locked" means unreachable, not merely superseded. */
export function buildRentRows(rents: number[] | undefined, current: number): DeedRow[] {
  if (!rents || rents.length < 6) return [];
  return RENT_TIER_LABELS.map((label, i) => ({
    label,
    value: <Money value={rentTierValue(rents, i)} size="glance" tone={i === current ? 'gold' : 'default'} />,
    current: i === current,
    locked: current >= 0 && i > current,
  }));
}

/** My equity percentage in `ps`, or 0 if I'm not a listed partner. */
export function equityOf(ps: Partnership, playerId: string): number {
  return ps.partners.find((p) => p.playerId === playerId)?.percentage ?? 0;
}

/** Every partner other than `playerId`. */
export function otherPartners(ps: Partnership, playerId: string) {
  return ps.partners.filter((p) => p.playerId !== playerId);
}

/** The active partnership for `colorGroup` that lists `playerId`, if any. */
export function myPartnershipFor(
  colorGroup: ColorGroup | undefined,
  partnerships: Partnership[] | undefined,
  playerId: string | null | undefined,
): Partnership | null {
  if (colorGroup == null || playerId == null) return null;
  return (
    partnerships?.find(
      (p) => p.status === 'active' && p.colorGroup === colorGroup && p.partners.some((pe) => pe.playerId === playerId),
    ) ?? null
  );
}
