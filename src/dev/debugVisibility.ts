/**
 * DEV-ONLY debug visibility flags for scene-layer toggling (see
 * `DebugTogglePanel`). Lets a dev independently hide/show each 3D scene layer
 * (forest sub-categories + a whole-forest master, board, city, tokens) and
 * read the fps/draw-call/tri delta on the existing FPS + `RenderStatsReadout`
 * panels — i.e. "what does each layer cost".
 *
 * A tiny, dependency-free mutable-flags store with a subscribe/notify
 * contract (a `Set` of listeners) — NOT zustand. This is throwaway dev/perf
 * tooling state, not app state: keeping it out of `useGameStore` means it
 * never touches gameStore's `reset()`/persistence/selectors, and the whole
 * module is only ever imported from `import.meta.env.DEV`-gated call sites
 * (`DebugTogglePanel` + the board/forest/city/token wiring), so it never
 * reaches a production bundle.
 *
 * Every category starts VISIBLE (`true`) — the default state renders the game
 * exactly as today, zero change. Toggling a flag notifies subscribers (the
 * board/forest components), which flip a mesh/group's `.visible` — this is
 * NOT a per-frame cost, it only fires on the rare tap.
 */

/** Forest sub-categories, classified from each chunk's source-type name (see ForestEnvironment). */
export type ForestDebugCategory =
  | 'trees'
  | 'mountains'
  | 'flowers'
  | 'mushrooms'
  | 'grass'
  | 'rocks'
  | 'ground';

/** Every independently-toggleable debug visibility category. */
export type DebugVisibilityCategory =
  | ForestDebugCategory
  | 'wholeForest'
  | 'board'
  | 'city'
  | 'tokens';

export type DebugVisibilityFlags = Readonly<Record<DebugVisibilityCategory, boolean>>;

/** Panel display order + the full category list (single source of truth). */
export const DEBUG_VISIBILITY_CATEGORIES: readonly DebugVisibilityCategory[] = [
  'wholeForest',
  'trees',
  'mountains',
  'flowers',
  'mushrooms',
  'grass',
  'rocks',
  'ground',
  'board',
  'city',
  'tokens',
];

function createDefaultFlags(): DebugVisibilityFlags {
  const defaults = {} as Record<DebugVisibilityCategory, boolean>;
  for (const category of DEBUG_VISIBILITY_CATEGORIES) defaults[category] = true;
  return defaults;
}

// LAZILY initialized (only the FIRST time a getter/setter below is actually
// called) rather than eagerly at module scope. Every real call site is
// wrapped in `if (!import.meta.env.DEV) return;`, so in a production build
// (where that folds to a compile-time `true`) NOTHING ever calls into this
// module at all — no function here is reachable, so esbuild's minifier drops
// every declaration (and this lazy init never runs, unlike an eager top-level
// `= createDefaultFlags()` call, which — having unknown purity — a minifier
// must keep as a bare statement even once its result becomes unused).
let flags: DebugVisibilityFlags | undefined;
const listeners = new Set<() => void>();

function ensureFlags(): DebugVisibilityFlags {
  flags ??= createDefaultFlags();
  return flags;
}

/** Current flags snapshot. Stable reference until the next actual change (safe for `useSyncExternalStore`). */
export function getDebugVisibility(): DebugVisibilityFlags {
  return ensureFlags();
}

/** Set one category's visibility flag and notify subscribers (no-op if unchanged). */
export function setDebugVisibility(category: DebugVisibilityCategory, visible: boolean): void {
  const current = ensureFlags();
  if (current[category] === visible) return;
  flags = { ...current, [category]: visible };
  for (const listener of listeners) listener();
}

/** Flip one category's visibility flag. */
export function toggleDebugVisibility(category: DebugVisibilityCategory): void {
  setDebugVisibility(category, !ensureFlags()[category]);
}

/** Subscribe to any flag change; returns an unsubscribe function. */
export function subscribeDebugVisibility(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
