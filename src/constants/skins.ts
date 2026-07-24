/**
 * Skin catalog metadata — rarity, flavor copy, and the IAP unlock SEAM for the
 * Fortnite-locker character screen (CT4).
 *
 * These 52 characters are cosmetic SKINS. In the shipped product they'll be
 * IAP-unlocked (Fortnite-style): common skins free, rarer ones premium. That
 * transaction layer is DEFERRED — this module builds only the presentation
 * metadata + a clean unlock seam. NO payment logic lives here or anywhere yet.
 *
 * Kept separate from `characters.ts` (the id/name/category/url source of truth)
 * so the raw catalog stays a thin data table and all "shop" flavor lives here.
 * Everything is derived from the same CHARACTERS ids, so the two files can never
 * drift on the roster.
 */

import { CHARACTERS } from './characters';
import type { CharacterCategory } from './characters';
import { GOLD } from './theme';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/** Rarity display order (low → high) for sorting/legends. */
export const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'] as const;

/**
 * Accent color per rarity — the card frame + preview banner tint. Chosen to sit
 * in OUR dark/gold identity (not literal Fortnite blue): a muted green for
 * common, cool blue for rare, royal purple for epic, and the house gold for
 * legendary.
 */
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#7a8a6f', // muted sage grey-green
  rare: '#4a90d9', // cool blue
  epic: '#a45cd6', // royal purple
  legendary: GOLD, // house gold (#d4af37)
};

/** Human label for a rarity (title-case), for the banner. */
export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

/**
 * Rarity by CATEGORY — the broad flavor assignment. Individual ids can be
 * promoted above their category baseline in {@link RARITY_OVERRIDES} (e.g. the
 * golden knights → legendary). Assignment rationale:
 *   common   — everyday folk (Suit, Casual, Worker)
 *   rare     — trained/uniformed (Soldier, Cowboy, Ninja)
 *   epic     — themed fantasy/horror packs (Fantasy, Viking, Pirate, Zombie)
 *   legendary — reserved for a handful of showpiece ids (see overrides)
 */
const CATEGORY_RARITY: Record<CharacterCategory, Rarity> = {
  Suit: 'common',
  Casual: 'common',
  Worker: 'common',
  Soldier: 'rare',
  Cowboy: 'rare',
  Ninja: 'rare',
  Animal: 'rare',
  Fantasy: 'epic',
  Viking: 'epic',
  Pirate: 'epic',
  Zombie: 'epic',
  Other: 'rare',
};

/**
 * Per-id rarity bumps above the category baseline — the "showpiece" legendaries
 * and a couple of standout epics. Any id not listed uses its category rarity.
 */
const RARITY_OVERRIDES: Record<string, Rarity> = {
  Knight_Golden_Male: 'legendary',
  Knight_Golden_Female: 'legendary',
  Wizard: 'legendary',
  Witch: 'legendary',
  VikingHelmet: 'legendary',
};

/**
 * One flavor line per CATEGORY (templated). Kept short so it fits the preview
 * banner on mobile. A future pass can hand-write per-id copy; the category
 * template covers all 52 sensibly today.
 */
const CATEGORY_DESCRIPTION: Record<CharacterCategory, string> = {
  Suit: 'Dressed to close the deal — boardroom-ready and all business.',
  Casual: 'Off-duty and easygoing. Just here to buy the whole street.',
  Worker: 'Honest hands on the job. Builds hotels, literally.',
  Soldier: 'Battle-ready and disciplined. Holds the line on every property.',
  Cowboy: 'Rides in from the frontier to lasso the best deals.',
  Ninja: 'A silent shadow — collects rent before you notice.',
  Fantasy: 'Straight out of legend, wielding uncommon fortune.',
  Viking: 'A seafaring raider who plunders the property market.',
  Pirate: 'Yo-ho-ho and a monopoly of rum. Claims every port.',
  Zombie: 'Back from the dead and hungry for real estate.',
  Animal: 'An unexpected challenger. Small paws, big ambitions.',
  Other: 'A one-of-a-kind figure with a style all their own.',
};

/**
 * Per-id description overrides for the most distinctive skins, so the marquee
 * legendaries read like real shop copy. Everything else uses its category line.
 */
const DESCRIPTION_OVERRIDES: Record<string, string> = {
  Knight_Golden_Male: 'A gilded champion. When they roll, the board glitters.',
  Knight_Golden_Female: 'A gilded champion. When they roll, the board glitters.',
  Wizard: 'Bends the rules of chance with a flick of the wand.',
  Witch: 'Hexes your rent and doubles her own. Beware the cauldron.',
  VikingHelmet: 'The horned crown of a true property-conquering jarl.',
};

export interface SkinMeta {
  id: string;
  rarity: Rarity;
  description: string;
  /**
   * True for skins that will sit behind the future IAP gate (all non-common
   * skins). Purely cosmetic today — drives a "premium" badge; NOT a lock. See
   * {@link isSkinUnlocked} for the real gate (a no-op stub for now).
   */
  premium: boolean;
}

function rarityFor(id: string, category: CharacterCategory): Rarity {
  return RARITY_OVERRIDES[id] ?? CATEGORY_RARITY[category];
}

function descriptionFor(id: string, category: CharacterCategory): string {
  return DESCRIPTION_OVERRIDES[id] ?? CATEGORY_DESCRIPTION[category];
}

/**
 * Skin metadata by id — derived from the CHARACTERS roster so it stays in sync.
 */
export const SKIN_META: Readonly<Record<string, SkinMeta>> = Object.fromEntries(
  CHARACTERS.map((c) => {
    const rarity = rarityFor(c.id, c.category);
    return [
      c.id,
      {
        id: c.id,
        rarity,
        description: descriptionFor(c.id, c.category),
        premium: rarity !== 'common',
      } satisfies SkinMeta,
    ];
  }),
);

/**
 * Resolve a skin's metadata, falling back to a safe common default for unknown
 * ids (mirrors resolveCharacter's tolerance).
 */
export function resolveSkinMeta(id: string): SkinMeta {
  return (
    SKIN_META[id] ?? {
      id,
      rarity: 'common',
      description: CATEGORY_DESCRIPTION.Other,
      premium: false,
    }
  );
}

/**
 * IAP unlock SEAM. Returns whether the player owns/has unlocked a skin.
 *
 * TODAY: every skin is unlocked (returns true for all) so the locker is fully
 * playable during development. The future IAP layer flips this per-id (e.g.
 * check an entitlements set from the server / store receipt). Callers should
 * gate EQUIP on this, and show a lock/premium badge when it returns false — the
 * UI is already wired for that, so enabling the gate is a one-line change here.
 */
export function isSkinUnlocked(_id: string): boolean {
  return true;
}

/** The static portrait thumbnail URL for a skin (rendered by Part A). */
export function skinThumbnailUrl(id: string): string {
  return `/images/characters/${id}.png`;
}
