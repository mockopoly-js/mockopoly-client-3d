/**
 * DEV URL FLAGS — READ FROM THE LAUNCH URL, NOT FROM THE CURRENT ONE.
 *
 * *** THIS IS A BUG FIX, NOT PLUMBING. *** Reading `window.location.search` at
 * the moment a flag is consulted DOES NOT WORK in this app, and the failure is
 * completely silent.
 *
 * `useScreenRouting` mirrors the game-flow screen into the URL with
 * `navigate(SCREEN_TO_PATH[screen], …)`, and SCREEN_TO_PATH holds bare
 * pathnames ('/', '/lobby', '/game', '/game-over'). React Router's `navigate`
 * with a bare pathname REPLACES the whole location, query string included. So
 * `http://host/?glow=0` becomes `http://host/game` the instant the game starts,
 * and every consumer that reads `location.search` on the game screen — which is
 * all of them, because that is the only screen these flags describe — reads an
 * empty string and quietly does nothing.
 *
 * MEASURED, NOT INFERRED: `?glow=0` was verified on the real client and the
 * glow was still rendering; `?nohud=1` never emitted its rule at all. The
 * pre-existing `?glowNight=0|1` in ownedGlow.ts had the same defect and had
 * therefore never worked from a fresh load either.
 *
 * THE FIX IS A SNAPSHOT, NOT A ROUTER CHANGE. Making `useScreenRouting` carry
 * the search through would be the more general fix, but it changes real
 * navigation behaviour on every screen transition, in a hook whose comments
 * turn on a carefully argued loop-freedom property. A DEV-only snapshot is
 * contained, cannot affect production, and is strictly more correct for this
 * purpose anyway: these flags describe HOW THIS PAGE LOAD SHOULD RUN, so the
 * launch URL is the right authority and later navigation is irrelevant.
 *
 * WHEN THE SNAPSHOT IS TAKEN: at this module's first evaluation. `main.tsx`
 * imports `App.tsx`, which statically imports `dev/hudOverride.tsx`, which
 * statically imports this — so it is captured during module evaluation, before
 * `createRoot().render()` and therefore long before any effect can navigate.
 * `ownedGlow.ts` lives in the lazily loaded GameScene chunk and imports this
 * too; ES modules are singletons, so it reads the same boot-time snapshot
 * rather than re-reading a URL the router has already rewritten.
 *
 * PRODUCTION: `import.meta.env.DEV` is statically replaced with `false`, so the
 * snapshot folds to `''` and every lookup folds to `null`. Verified against a
 * real build — no flag name survives in dist/.
 */

/**
 * The query string as it was when the app booted. Never re-read: that is the
 * entire point (see above).
 */
let launchQuery: string = import.meta.env.DEV && typeof window !== 'undefined'
  ? window.location.search
  : '';

/**
 * Seam for tests, which cannot re-trigger module evaluation per case. Naming it
 * plainly is deliberate — a hidden `__test` back door in a module whose whole
 * subject is "the value you read is not the value you think" would be its own
 * small trap.
 */
export function overrideLaunchQuery(query: string): void {
  launchQuery = query;
}

/** A DEV flag's raw value from the launch URL, or null (always null in prod). */
export function launchFlag(name: string): string | null {
  if (!import.meta.env.DEV) return null;
  return new URLSearchParams(launchQuery).get(name);
}
