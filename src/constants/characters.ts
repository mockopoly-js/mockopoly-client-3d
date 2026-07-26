/**
 * Character catalog — the 52 rigged characters converted to decoder-free glb by
 * `scripts/gen-characters.mjs` (npm run models:characters) into
 * `public/models/characters/<id>.glb`.
 *
 * This catalog is the single source of truth for the character selection screen
 * (CT2) and token rendering (CT3). Each entry's `id` is the glb filename stem;
 * `url` points at the committed public asset (served statically, lazy-loaded per
 * selected character via drei's per-url useGLTF cache — never JS-bundled).
 *
 * `category` groups the pack into human-friendly themes for the picker. Every
 * one of the 52 characters belongs to exactly one bucket.
 */

export interface CharacterDef {
  /** glb filename stem, e.g. "Wizard". Stable id used everywhere. */
  id: string;
  /** Human label for the picker, e.g. "Ninja (Male)". */
  name: string;
  /** Theme grouping for the picker. */
  category: CharacterCategory;
  /** Public asset URL, `/models/characters/<id>.glb`. */
  url: string;
}

export type CharacterCategory =
  | 'Suit'
  | 'Casual'
  | 'Fantasy'
  | 'Ninja'
  | 'Viking'
  | 'Pirate'
  | 'Cowboy'
  | 'Zombie'
  | 'Soldier'
  | 'Worker'
  | 'Animal'
  | 'Other';

/**
 * Ordered category buckets (drives picker section order).
 */
export const CHARACTER_CATEGORIES: readonly CharacterCategory[] = [
  'Suit',
  'Casual',
  'Fantasy',
  'Ninja',
  'Viking',
  'Pirate',
  'Cowboy',
  'Zombie',
  'Soldier',
  'Worker',
  'Animal',
  'Other',
] as const;

/**
 * Turn a filename stem into a readable label:
 *   "Ninja_Male_Hair" -> "Ninja (Male, Hair)"
 *   "Doctor_Female_Young" -> "Doctor (Female, Young)"
 *   "OldClassy_Male" -> "Old Classy (Male)"
 *   "Wizard" -> "Wizard"
 * The first underscore-segment is the base; any trailing segments become a
 * parenthetical qualifier. CamelCase in the base is split ("OldClassy" ->
 * "Old Classy", "BlueSoldier" -> "Blue Soldier").
 */
function humanize(id: string): string {
  const parts = id.split('_');
  const base = parts[0].replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const quals = parts.slice(1).map((p) => p.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
  return quals.length ? `${base} (${quals.join(', ')})` : base;
}

/**
 * Classify a stem into a theme bucket. Order matters — first match wins, so
 * more-specific themes (Ninja/Viking/etc.) are checked before the generic
 * catch-alls.
 */
function categorize(id: string): CharacterCategory {
  const lower = id.toLowerCase();
  // Cowboy must beat the Animal `cow` match (Cowboy_* contains "cow").
  if (lower.includes('cowboy')) return 'Cowboy';
  // Animal = the literal Cow (not Cowboy) + Pug. Anchor `cow` so it can't
  // swallow "cowboy" (already handled above, but keep the regex precise).
  if (/^cow$|pug/.test(lower)) return 'Animal';
  if (/ninja|kimono/.test(lower)) return 'Ninja';
  if (lower.includes('viking')) return 'Viking';
  if (lower.includes('pirate')) return 'Pirate';
  if (lower.includes('zombie')) return 'Zombie';
  if (/wizard|witch|elf|goblin|knight/.test(lower)) return 'Fantasy';
  if (lower.includes('soldier')) return 'Soldier';
  if (/chef|doctor|worker/.test(lower)) return 'Worker';
  if (/suit|oldclassy/.test(lower)) return 'Suit';
  if (lower.includes('casual')) return 'Casual';
  return 'Other';
}

// The 52 converted glb stems (kept in sync with public/models/characters/*.glb
// and scripts/gen-characters.mjs output). Alphabetical, matching the script.
const CHARACTER_IDS: readonly string[] = [
  'BaseCharacter',
  'BlueSoldier_Female',
  'BlueSoldier_Male',
  'Casual2_Female',
  'Casual2_Male',
  'Casual3_Female',
  'Casual3_Male',
  'Casual_Bald',
  'Casual_Female',
  'Casual_Male',
  'Chef_Female',
  'Chef_Hat',
  'Chef_Male',
  'Cow',
  'Cowboy_Female',
  'Cowboy_Hair',
  'Cowboy_Male',
  'Doctor_Female_Old',
  'Doctor_Female_Young',
  'Doctor_Male_Old',
  'Doctor_Male_Young',
  'Elf',
  'Goblin_Female',
  'Goblin_Male',
  'Kimono_Female',
  'Kimono_Male',
  'Knight_Golden_Female',
  'Knight_Golden_Male',
  'Knight_Male',
  'Ninja_Female',
  'Ninja_Male',
  'Ninja_Male_Hair',
  'Ninja_Sand',
  'Ninja_Sand_Female',
  'OldClassy_Female',
  'OldClassy_Male',
  'Pirate_Female',
  'Pirate_Male',
  'Pug',
  'Soldier_Female',
  'Soldier_Male',
  'Suit_Female',
  'Suit_Male',
  'VikingHelmet',
  'Viking_Female',
  'Viking_Male',
  'Witch',
  'Wizard',
  'Worker_Female',
  'Worker_Male',
  'Zombie_Female',
  'Zombie_Male',
] as const;

/**
 * The full character catalog — one entry per converted glb.
 */
export const CHARACTERS: readonly CharacterDef[] = CHARACTER_IDS.map((id) => ({
  id,
  name: humanize(id),
  category: categorize(id),
  url: `/models/characters/${id}.glb`,
}));

/**
 * Fast lookup by id.
 */
export const CHARACTER_BY_ID: Readonly<Record<string, CharacterDef>> =
  Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

/**
 * Default character for players who never pick one. A clean, neutral suit.
 */
export const DEFAULT_CHARACTER = 'Suit_Male';

/**
 * Resolve a (possibly missing/unknown) character id to a valid catalog entry,
 * falling back to the default. Handy for CT3 token rendering.
 */
export function resolveCharacter(id: string | null | undefined): CharacterDef {
  // CHARACTER_BY_ID is typed as a total Record, but an unknown id (the reason
  // this resolver exists) yields undefined at runtime — hence the real fallback.
  const found = id != null ? CHARACTER_BY_ID[id] : undefined;
  return found ?? CHARACTER_BY_ID[DEFAULT_CHARACTER];
}

// Directory of the MOBILE-ONLY meshopt-compressed character variants generated by
// scripts/gen-characters-mobile.mjs (npm run models:characters:mobile). Same
// `<id>.glb` filenames as the desktop originals — only the folder differs — so a
// desktop url maps to its mobile variant by swapping this path prefix. Kept
// module-local; callers go through toMobileCharacterUrl below.
const CHARACTERS_MOBILE_DIR = '/models/characters-mobile';

/**
 * Map a desktop character url (`/models/characters/<id>.glb`) to its MOBILE
 * meshopt-compressed variant (`/models/characters-mobile/<id>.glb`).
 *
 * WHY: the mobile variants carry EXT_meshopt_compression (FILTER method) for a
 * smaller download + faster parse; the skinning inputs (JOINTS_0/WEIGHTS_0),
 * inverse bind matrices and animation channels are preserved LOSSLESSLY, so a
 * token animates + deforms identically to the desktop original. The meshopt
 * decoder is bundled in three-stdlib and auto-installed by drei's useGLTF (no
 * draco, no CDN, no client wiring), exactly like forest.mobile.glb.
 *
 * Call ONLY when `isMobile` — DESKTOP must keep loading the byte-identical
 * originals from `/models/characters`. A url that is not a desktop character url
 * is returned unchanged (defensive no-op).
 */
export function toMobileCharacterUrl(url: string): string {
  return url.replace(/^\/models\/characters\//, `${CHARACTERS_MOBILE_DIR}/`);
}
