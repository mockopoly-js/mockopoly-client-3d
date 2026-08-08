/**
 * DEV-ONLY forest LOD-tier TINT toggle (see `DebugTogglePanel` + `ForestEnvironment`).
 *
 * When ON, the mobile forest's per-frame LOD loop paints each eligible relief
 * chunk by the geometry tier it is CURRENTLY rendering — full = normal, LOD1
 * (~30%) = green, LOD2 (~5%) = red — via a per-chunk material swap. This lets a
 * dev CONFIRM ON-DEVICE that the dynamic camera-distance LOD is actually swapping
 * `chunk.geometry` (the tint tracks the tier as the camera dollies/orbits) and SEE
 * exactly which chunks are decimated. Non-LOD chunks (mountains / ground / rocks)
 * stay normal — they have no tiers, so "full" is correct for them.
 *
 * A minimal dependency-free boolean store with a subscribe/notify contract,
 * mirroring `debugVisibility.ts`: it is throwaway dev/perf tooling, never app
 * state. Default OFF (`false`) so the game renders exactly as today until a dev
 * taps the toggle. Every call site is gated behind `import.meta.env.DEV`, which
 * folds to a compile-time `false` in production — so nothing here is reachable and
 * the whole module (plus its per-chunk tint materials) is tree-shaken out of the
 * production bundle.
 */

let enabled = false;
const listeners = new Set<() => void>();

/** Current tint-on state. Stable primitive — safe for `useSyncExternalStore`. */
export function getLodTintEnabled(): boolean {
  return enabled;
}

/** Set the tint-on state and notify subscribers (no-op if unchanged). */
export function setLodTintEnabled(value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  for (const listener of listeners) listener();
}

/** Flip the tint-on state. */
export function toggleLodTint(): void {
  setLodTintEnabled(!enabled);
}

/** Subscribe to tint-state changes; returns an unsubscribe function. */
export function subscribeLodTint(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
