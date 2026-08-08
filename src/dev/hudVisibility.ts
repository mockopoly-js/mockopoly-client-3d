/**
 * DEV-ONLY HUD visibility TOGGLE (see `DebugTogglePanel` + `hudOverride.tsx`).
 *
 * A tiny, dependency-free mutable-flags store with a subscribe/notify contract —
 * mirroring `lodTint.ts` (getter/setter/toggle/subscribe shape) and
 * `debugVisibility.ts` (lazy init, see below) — because this is throwaway
 * dev/perf tooling state, not app state: it never touches `gameStore`.
 *
 * THE LIVE HALF OF `?nohud=1`. `hudOverride.tsx`'s `HudHideStyle` used to read
 * the launch-URL flag once per render — a one-shot kill switch with no way to
 * flip it back on short of a reload, which loses camera position and game
 * state. The actual `display:none` mechanism (the `<style>` rule in
 * hudOverride.tsx) is UNCHANGED and is not duplicated here: this module only
 * holds the mutable ON/OFF bit that `HudHideStyle` now subscribes to, seeded
 * from the SAME `?nohud=1` flag so a reload-time A/B and a panel-driven,
 * reload-free A/B agree on the starting state.
 *
 * LAZY SEED, NOT EAGER — same reasoning as `debugVisibility.ts`'s `ensureFlags`.
 * The initial value depends on a real function call (`launchFlag('nohud')`,
 * which parses the boot-time query string snapshot) — a call a minifier cannot
 * prove is side-effect-free. An eager top-level `let visible = init();` would
 * therefore survive production minification as a bare statement even once its
 * result becomes provably unused. Computing it lazily, inside a function that
 * is itself only reachable from `import.meta.env.DEV`-gated call sites, means
 * the whole chain — including this seed call — disappears when `DEV` folds to
 * `false`.
 */
import { launchFlag } from './urlFlags';

/** True when the launch query asked to hide the HUD. Absent or `0`/`false` = shown. */
function launchHidesHud(): boolean {
  const v = launchFlag('nohud');
  return v !== null && v !== '0' && v !== 'false';
}

let visible: boolean | undefined;
const listeners = new Set<() => void>();

function ensureVisible(): boolean {
  visible ??= !launchHidesHud();
  return visible;
}

/** Current HUD-visible state. Stable primitive — safe for `useSyncExternalStore`. */
export function getHudVisible(): boolean {
  return ensureVisible();
}

/** Set the HUD-visible state and notify subscribers (no-op if unchanged). */
export function setHudVisible(value: boolean): void {
  const current = ensureVisible();
  if (current === value) return;
  visible = value;
  for (const listener of listeners) listener();
}

/** Flip the HUD-visible state. */
export function toggleHudVisible(): void {
  setHudVisible(!ensureVisible());
}

/** Subscribe to HUD-visible changes; returns an unsubscribe function. */
export function subscribeHudVisible(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Seam for tests, which cannot re-trigger module evaluation per case (the same
 * problem `urlFlags.ts#overrideLaunchQuery` solves for the launch-query
 * snapshot itself). Without this, the lazily-cached `visible` from the first
 * test to touch this module would leak into every later test in the same
 * file. Naming it plainly is deliberate — see `overrideLaunchQuery`'s doc for
 * why a hidden `__test` back door would be its own small trap.
 */
export function resetHudVisibleForTests(): void {
  visible = undefined;
}
