/**
 * THE LOCKER — the derivation behind CharacterSelect, and the UNLOCK SEAM.
 *
 * The 52 characters are cosmetic SKINS, intended to be IAP-unlocked
 * Fortnite-style. PAYMENTS ARE DEFERRED: there is no purchase flow, no price,
 * no store, and nothing in this file or the screen knows what a transaction is.
 * What there IS, is one place to change when entitlements land.
 *
 *   *** THE SEAM IS `isUnlocked(characterId)`, BELOW. ***
 *
 * It returns `true` for every skin today. The whole screen — tile state, the
 * OWNED / LOCKED filter, whether EQUIP is enabled — is derived from it and
 * nothing else, so wiring real entitlements is a change to one function body
 * and touches no layout. `buildLocker()` is the only thing the screen calls, so
 * a future entitlements source (a server set, a receipt cache) can be threaded
 * in here without the component learning about it.
 */
import { CHARACTERS } from '../constants/characters';
import { RARITY_COLOR, isSkinUnlocked, resolveSkinMeta, skinThumbnailUrl } from '../constants/skins';
import type { Rarity } from '../constants/skins';

/** The three states a locker grid can be filtered to. */
export type LockerFilter = 'all' | 'owned' | 'locked';

/**
 * *** THE UNLOCK SEAM. ***
 *
 * Does the player own this skin? Today: yes, always — `isSkinUnlocked` is the
 * data-layer stub and returns `true` for every id, so the locker is fully
 * playable while the transaction layer does not exist.
 *
 * WHEN ENTITLEMENTS LAND, this is the function that changes. Every locked
 * affordance on the screen (the lock chip, the LOCKED filter, the disabled
 * EQUIP) already reads it, so nothing above this line needs to move.
 */
export function isUnlocked(characterId: string): boolean {
  return isSkinUnlocked(characterId);
}

/** One tile in the grid. Everything the card needs, already resolved. */
export interface LockerTile {
  id: string;
  name: string;
  category: string;
  rarity: Rarity;
  /** Rarity frame colour. */
  frame: string;
  /** From {@link isUnlocked}. A locked tile still previews; it cannot equip. */
  locked: boolean;
  /** Static portrait. The grid is 52 <img>; only the preview is live WebGL. */
  thumb: string;
}

/**
 * Every skin, filtered.
 *
 * SEARCH MATCHES CATEGORY AS WELL AS NAME AND ID. The previous screen carried a
 * separate row of 13 category chips; at 844x390 the grid gets ~175px of height
 * in total, and a second filter row would have cost a third of it. Typing
 * "viking" reaches the same nine skins, so the capability survives and the row
 * does not.
 */
export function buildLocker(search: string, filter: LockerFilter): LockerTile[] {
  const q = search.trim().toLowerCase();

  return CHARACTERS.flatMap((c) => {
    const locked = !isUnlocked(c.id);
    if (filter === 'owned' && locked) return [];
    if (filter === 'locked' && !locked) return [];

    if (q !== '') {
      const hit =
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q);
      if (!hit) return [];
    }

    const meta = resolveSkinMeta(c.id);
    return [{
      id: c.id,
      name: c.name,
      category: c.category,
      rarity: meta.rarity,
      frame: RARITY_COLOR[meta.rarity],
      locked,
      thumb: skinThumbnailUrl(c.id),
    }];
  });
}

/** How many of the roster the player owns — the locker's one honest headline. */
export function ownedCount(): number {
  return CHARACTERS.reduce((n, c) => n + (isUnlocked(c.id) ? 1 : 0), 0);
}
