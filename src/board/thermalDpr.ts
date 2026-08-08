/**
 * ── THERMAL DPR STEP-DOWN — TIER TABLE + DECISION LOGIC (MOBILE ONLY) ─────────
 *
 * WHAT THIS IS. An iPhone 13 Pro thermally throttles this scene over a long
 * session. iOS Safari exposes NO thermal API — no `navigator.thermal`, no
 * power-state event, nothing. The ONLY available proxy is how long frames are
 * taking. This module owns (a) the tier table of dpr reductions and (b) the pure
 * decision logic that reads a stream of rAF timestamps and says "demote".
 *
 * It is deliberately PURE and clock-injected: no rAF, no DOM, no renderer, no
 * module-level mutable state. `mobileRender.ts` owns the actual ratchet, wires a
 * rAF loop into `sample()`, and applies a tier by mutating its `config`. That
 * split is what makes the state machine unit-testable to the frame.
 *
 * ── WHY THE SCENE DPR HAS TO MOVE, NOT JUST THE STILL DPR ─────────────────────
 *
 * The obvious design — "step `MOBILE_DPR_STILL` 2.0 → 1.5" — under-delivers by a
 * factor of two, and the reason is not obvious. A measured pass census of a real
 * idle frame (844×390 CSS, dpr 2, 4 players, 14 passes, 9.32 MP of fill = 7.08×
 * the screen) splits as:
 *
 *     3 NATIVE passes   (board raster, composite, grade)   3 × 1.317 MP = 3.95 MP
 *     6 SCENE-res passes (scene + 4 helpers + city)        6 × 0.741 MP = 4.44 MP
 *     5 HALF-SCENE passes (N8AO loop + denoise)            5 × 0.185 MP = 0.93 MP
 *                                                                  total 9.32 MP
 *
 * Only the 3 NATIVE passes scale with the still dpr. The other 11 are already
 * pinned by `MOBILE_SCENE_DPR = 1.5` / `MOBILE_CITY_DPR = 1.5`. So still 2.0 →
 * 1.5 touches 42 % of the fill and saves 19 %, not the ~44 % the pixel count
 * suggests. Everything below 1.5 also drags the scene down through the pipeline's
 * `min(liveDpr, sceneDpr)`, which is why the scope's 1.3 tier jumps to 39 %.
 *
 * The tier table below exploits that asymmetry deliberately: it steps the SCENE
 * cap INDEPENDENTLY of the still dpr, so it can buy the scene saving WITHOUT
 * dragging the board pass down with it. Board text crispness at native dpr is the
 * entire reason `MobileCrispBoardPipeline` exists; the scene is low-frequency
 * organic geometry (forest, mountains, sky, low-poly city) and is far more
 * forgiving of a resolution drop than 8 px glyphs are.
 *
 * ── THE TIER TABLE (measured, /tmp/thermal/pass-census.mjs method) ────────────
 *
 *   tier  still   scene/city   fill/frame   saved   board pass
 *   ────  ──────  ──────────   ──────────   ─────   ──────────
 *      0  native      1.5        9.32 MP       —    native (dpr 2) ← today
 *      1    1.5       1.25       5.96 MP     36 %   dpr 1.5
 *      2    1.5       1.0        4.61 MP     51 %   dpr 1.5
 *
 * Tier 2 deliberately does NOT lower the still dpr again. Compare the two ways to
 * reach ~51 %:
 *   • still 1.3 / scene 1.1 → 4.56 MP (51.1 %) but the BOARD drops to 1.3
 *   • still 1.5 / scene 1.0 → 4.61 MP (50.5 %) and the BOARD stays at 1.5
 * Identical saving; one of them keeps the text 15 % sharper. Take that one.
 *
 * A useful side effect: because tier 1 → 2 does not change the still dpr, that
 * transition needs no `setDpr`, no canvas resize and no composer resize — only
 * the scene/city/AO FBOs re-allocate, which the pipeline already does every frame
 * from the live ratio. It is the cheapest of the two transitions.
 *
 * ── THE SIGNAL ────────────────────────────────────────────────────────────────
 *
 * A rolling **LOWER MEDIAN of rAF deltas over a 2 s wall-clock window**, required
 * to stay above threshold **continuously for 10 s**.
 *
 * Median, not mean: the mean has a breakdown point of 0 — one 400 ms GC pause
 * drags a 2 s mean over any threshold on its own. The median's breakdown point is
 * 50 %, the maximum possible, so a MAJORITY of the window has to be slow.
 *
 * LOWER median (`sorted[floor((n-1)/2)]`) specifically, not the even-n average of
 * the two central samples. That gives an exact, testable property:
 *
 *     lowerMedian > T   ⟺   strictly more than half the samples exceed T
 *
 * which is precisely the statement we want to make, and it avoids the even-n
 * average landing at (16.7+33.3)/2 = 25 ms — above any sane threshold — when the
 * device is at an exact 50/50 split and therefore NOT yet throttling.
 *
 * That property also explains why the threshold value barely matters on iOS. iOS
 * quantises a missed frame to exactly one refresh interval, so frame deltas are
 * bimodal at 16.7 ms and 33.3 ms with almost nothing between. ANY threshold
 * strictly inside (16.7, 33.3) is therefore the same predicate: "more than half
 * the frames in the last 2 s were late". `SLOW_FRAME_MS = 22` sits in the middle
 * of that dead band (≈45 fps) so it is maximally far from both modes; the value
 * only starts to matter on hardware with non-quantised pacing.
 */

/** One rung of the step-down ladder. Both fields are CAPS, never targets. */
export interface ThermalTier {
  /**
   * Ceiling on the at-rest present dpr (`config.dprStill`). `Infinity` = no cap,
   * i.e. keep whatever the controller registered. Applied as
   * `min(registeredStill, stillDpr)` so a device whose native dpr is already
   * below the cap is unaffected, and so tier 0 is provably an identity.
   */
  stillDpr: number;
  /**
   * Ceiling on the pipeline's scene AND city dpr props. `Infinity` = no cap.
   * Applied as `min(prop, sceneDpr)` by `thermalSceneDprCap()`, which
   * `MobileCrispBoardPipeline` calls each frame — it already re-derives every FBO
   * size from the live ratio, so there is no resize plumbing to add.
   */
  sceneDpr: number;
}

/**
 * The ladder. Index === tier. MUST start with an all-`Infinity` identity row:
 * tier 0 is today's behaviour byte-for-byte, and "first load is identical" is a
 * hard requirement, not an aspiration.
 */
export const THERMAL_TIERS: readonly ThermalTier[] = [
  { stillDpr: Infinity, sceneDpr: Infinity },
  { stillDpr: 1.5, sceneDpr: 1.25 },
  { stillDpr: 1.5, sceneDpr: 1.0 },
];

/** Highest reachable tier index. */
export const MAX_THERMAL_TIER = THERMAL_TIERS.length - 1;

/**
 * Rolling window the median is taken over, in WALL CLOCK ms (not a fixed sample
 * count). Time-based matters: at 30 fps a 120-sample window would span 4 s and
 * silently double every timing below. 2 s is long enough that the median is a
 * stable statistic (≈120 samples at 60 fps, ≈60 at 30 fps) and short enough that
 * it recovers immediately once a hitch ends — which is what makes the dwell timer
 * below a real filter rather than a rubber stamp.
 */
export const WINDOW_MS = 2000;

/**
 * "This frame was late." ≈45 fps. See the header: on iOS's bimodal 16.7/33.3 ms
 * distribution any value in the dead band behaves identically, so this sits in
 * the middle of it.
 */
export const SLOW_FRAME_MS = 22;

/**
 * The 2 s median must stay above `SLOW_FRAME_MS` CONTINUOUSLY for this long
 * before a tier is armed. Reset to zero the instant the median recovers.
 *
 * This is the whole answer to "a dice roll must not permanently degrade the
 * session". Combined with the 2 s window, a hitch has to hold a majority of
 * frames late for ~10 s — a full second longer than the longest measured
 * continuous gameplay-motion burst (dice roll + token walk tops out at 4.2 s in
 * the duty-cycle capture; a takeover panel is <1 s; a forest chunk stream is
 * ~2 s; the one-shot shadow bake is a single frame). None of them can reach 10 s,
 * and each one that ends resets the timer to zero rather than accumulating.
 *
 * Cost of being this conservative: ~32 s from a cold, already-throttling start to
 * the first demotion (20 s warm-up + 2 s to fill the window + 10 s dwell). For a
 * phenomenon that develops over minutes and never recovers on its own, that is
 * free.
 */
export const DWELL_MS = 10000;

/**
 * Nothing is sampled for this long after the monitor starts. The first seconds of
 * a session are the LEAST representative frames in it: asset streaming, shader
 * warm-up (`ShaderWarmup`), the one-shot shadow bake, forest chunk mounts and
 * HDRI decode all land here. Demoting on those would permanently degrade a
 * session that was never actually hot.
 *
 * 20 s, chosen from measurement rather than taste: every scope harness settles
 * for 14 s before it trusts a frame (`pass-census.mjs`, `idle-audit.mjs`). 20 s
 * clears that with margin, and the dwell timer adds another 12 s on top, so
 * nothing can demote inside the first ~32 s of a session under any circumstances.
 */
export const WARMUP_MS = 20000;

/**
 * After a tier lands, discard the window and sample nothing for this long.
 * Two reasons, both real:
 *  1. Applying a tier re-allocates the canvas backing store and every FBO. Those
 *     frames are slow BECAUSE of the change, and feeding them back in would
 *     cascade 0 → 1 → 2 in about a second.
 *  2. The point of a tier is to make frames cheaper. Judging whether it worked
 *     requires frames rendered under the new tier, not frames straddling it.
 */
export const COOLDOWN_MS = 15000;

/**
 * A rAF delta longer than this is not a slow frame, it is a discontinuity — tab
 * backgrounded, screen locked, the app suspended. Dropped outright rather than
 * recorded. (A single huge sample could not move a 120-sample median anyway, but
 * at a resume the window is nearly empty, which is exactly when it could.)
 */
export const MAX_PLAUSIBLE_DELTA_MS = 1000;

/**
 * How long an ARMED tier waits for a camera gesture to hide it under before it is
 * applied regardless. Motion gating alone would leave this feature completely
 * inert for a player who never orbits — the worst possible outcome, since that is
 * exactly the player most likely to sit in one long, hot session. A one-off
 * resolution pop is strictly better than a whole session pinned at 30 fps.
 */
export const MAX_DEFER_MS = 45000;

/** How often `tick()` turns the frame-time window into a decision. */
export const EVAL_INTERVAL_MS = 250;

/**
 * Minimum samples before the median means anything. Low on purpose: a
 * time-based window holds ~120 samples at 60 fps and ~60 at 30 fps, so this bar
 * only ever guards the first ~200 ms after a clear. Setting it high would create
 * the perverse failure where a REALLY badly throttled device (few samples per
 * window) can never qualify to be helped. 12 samples in a 2 s window = a 6 fps
 * floor.
 */
export const MIN_SAMPLES = 12;

/** Tunables, all overridable per-instance so tests can compress the timeline. */
export interface ThermalSamplerOptions {
  /** Monitor start time; the warm-up hold is measured from here. */
  startedAtMs: number;
  windowMs?: number;
  slowFrameMs?: number;
  dwellMs?: number;
  warmupMs?: number;
  cooldownMs?: number;
  maxPlausibleDeltaMs?: number;
  minSamples?: number;
}

export interface ThermalSampler {
  /**
   * Record a rAF timestamp. Implausible deltas and the very first timestamp
   * (which has no predecessor) are dropped.
   */
  sample: (nowMs: number) => void;
  /**
   * True exactly once per sustained slow episode: the window is populated, the
   * warm-up and any cooldown have elapsed, and the lower median has been above
   * threshold continuously for `dwellMs`. Returning true does NOT mutate the
   * ratchet — the caller owns that — but it DOES consume the episode (starts the
   * cooldown and clears the window), so it cannot fire twice for the same one.
   */
  shouldDemote: (nowMs: number) => boolean;
  /**
   * Start a cooldown and drop the window. Called by the owner both when a tier is
   * armed and when it is actually committed, so the frames spent re-allocating
   * FBOs never feed the next decision.
   */
  noteTierChange: (nowMs: number) => void;
  /** Drop all history and restart the dwell. Used on tab-visibility resume. */
  clear: (nowMs: number) => void;
  /** Lower median of the live window in ms, or NaN when under-populated. */
  medianDeltaMs: () => number;
  /**
   * ms the median has been continuously above threshold, or 0. Exposed for the
   * DEV readout and for tests that assert the dwell resets rather than
   * accumulates.
   */
  slowForMs: (nowMs: number) => number;
}

/**
 * Lower median: `sorted[floor((n-1)/2)]`. See the header for why this exact
 * definition — `lowerMedian > T` ⟺ strictly more than half the samples exceed T.
 */
function lowerMedian(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * The decision state machine. No timers, no globals, no I/O — the caller supplies
 * every timestamp, which is what lets the tests drive a whole simulated session
 * (warm-up, a dice-roll spike, a real throttle, a resume) in microseconds.
 */
export function createThermalSampler(opts: ThermalSamplerOptions): ThermalSampler {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const slowFrameMs = opts.slowFrameMs ?? SLOW_FRAME_MS;
  const dwellMs = opts.dwellMs ?? DWELL_MS;
  const warmupMs = opts.warmupMs ?? WARMUP_MS;
  const cooldownMs = opts.cooldownMs ?? COOLDOWN_MS;
  const maxDelta = opts.maxPlausibleDeltaMs ?? MAX_PLAUSIBLE_DELTA_MS;
  const minSamples = opts.minSamples ?? MIN_SAMPLES;

  /** Parallel ring of (timestamp, delta). Trimmed by AGE, never by count. */
  const stamps: number[] = [];
  const deltas: number[] = [];

  let lastStampMs = NaN;
  /** Wall clock before which sampling is suppressed (warm-up, then cooldowns). */
  let suppressedUntilMs = opts.startedAtMs + warmupMs;
  /** When the median first went slow in the current unbroken episode, or -1. */
  let slowSinceMs = -1;

  function trim(nowMs: number): void {
    const cutoff = nowMs - windowMs;
    let drop = 0;
    while (drop < stamps.length && stamps[drop] < cutoff) drop++;
    if (drop > 0) {
      stamps.splice(0, drop);
      deltas.splice(0, drop);
    }
  }

  function dropHistory(): void {
    stamps.length = 0;
    deltas.length = 0;
    lastStampMs = NaN;
    slowSinceMs = -1;
  }

  return {
    sample(nowMs: number): void {
      const prev = lastStampMs;
      lastStampMs = nowMs;
      // No predecessor (first tick, or the first tick after a clear) → no delta.
      if (Number.isNaN(prev)) return;
      if (nowMs <= suppressedUntilMs) return;
      const delta = nowMs - prev;
      // A discontinuity, not a slow frame. Also drops the sample that straddles
      // the end of a suppression window, which would otherwise be a huge delta.
      if (delta <= 0 || delta > maxDelta) return;
      stamps.push(nowMs);
      deltas.push(delta);
      trim(nowMs);
    },

    shouldDemote(nowMs: number): boolean {
      if (nowMs <= suppressedUntilMs) return false;
      trim(nowMs);
      if (deltas.length < minSamples) {
        // Under-populated window: no opinion, and crucially do NOT let the dwell
        // keep running on stale evidence.
        slowSinceMs = -1;
        return false;
      }
      const median = lowerMedian(deltas);
      if (median <= slowFrameMs) {
        // Recovered. The dwell resets to zero — it never accumulates across
        // separate slow episodes, which is what stops a string of unrelated
        // hitches from adding up to a demotion.
        slowSinceMs = -1;
        return false;
      }
      if (slowSinceMs < 0) {
        slowSinceMs = nowMs;
        return false;
      }
      if (nowMs - slowSinceMs < dwellMs) return false;
      // Sustained. Consume the episode so a caller polling at 4 Hz gets exactly
      // one demotion out of it, then hold off until the new tier has settled.
      suppressedUntilMs = nowMs + cooldownMs;
      dropHistory();
      return true;
    },

    noteTierChange(nowMs: number): void {
      suppressedUntilMs = Math.max(suppressedUntilMs, nowMs + cooldownMs);
      dropHistory();
    },

    clear(nowMs: number): void {
      dropHistory();
      // Do NOT shorten an in-flight suppression: a resume must not be able to
      // buy its way out of the warm-up hold.
      suppressedUntilMs = Math.max(suppressedUntilMs, nowMs);
    },

    medianDeltaMs(): number {
      return deltas.length < minSamples ? NaN : lowerMedian(deltas);
    },

    slowForMs(nowMs: number): number {
      return slowSinceMs < 0 ? 0 : nowMs - slowSinceMs;
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * THE RATCHET
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ThermalRatchetOptions extends ThermalSamplerOptions {
  /**
   * Called with the new tier index each time the ratchet advances, and only
   * then. The owner applies the dpr caps; this module never touches a renderer.
   */
  onTierChange: (tier: number) => void;
  maxDeferMs?: number;
  evalIntervalMs?: number;
}

export interface ThermalRatchet {
  /** Feed one rAF timestamp: samples, and re-decides at the eval cadence. */
  tick: (nowMs: number) => void;
  /**
   * The user just started a camera gesture. Commits an armed tier if there is
   * one — this is the motion gate. No-op when nothing is armed.
   */
  commitOnCameraMotion: (nowMs: number) => void;
  /** Drop the frame-time history (tab resume). Never shortens the warm-up. */
  clear: (nowMs: number) => void;
  /** DEV / measurement override. Goes through the ratchet, so it cannot lower. */
  force: (tier: number, nowMs: number) => void;
  /** Committed tier. */
  tier: () => number;
  /** Armed-but-uncommitted tier; equals `tier()` when nothing is armed. */
  pendingTier: () => number;
  /** Live frame-time median for the DEV readout, NaN when under-populated. */
  medianDeltaMs: () => number;
}

/**
 * The one-way step-down ratchet.
 *
 * ── FAILURE MODE 1, OSCILLATION — HANDLED STRUCTURALLY ────────────────────────
 * `tier` has exactly one assignment site (`advance`), guarded by
 * `next <= tier → return`. There is no decrement anywhere, no reset, no
 * "recovered" branch and no path that reads a lower tier back out. `force()`
 * routes through the same guard, so even the DEV override cannot walk it back.
 * Oscillation is therefore impossible by construction rather than by tuning: the
 * step-up test that would be needed to hunt does not exist.
 *
 * The reasoning behind having no step-up at all: a phone that got hot enough to
 * throttle will get hot again as soon as the load returns, so a step-up is a
 * request to oscillate on a several-minute period. And a resolution change that
 * happens repeatedly is far more objectionable than a frame that is permanently
 * slightly softer — the eye locks onto the change, not the absolute sharpness.
 */
export function createThermalRatchet(opts: ThermalRatchetOptions): ThermalRatchet {
  const maxDeferMs = opts.maxDeferMs ?? MAX_DEFER_MS;
  const evalIntervalMs = opts.evalIntervalMs ?? EVAL_INTERVAL_MS;
  const sampler = createThermalSampler(opts);

  let tier = 0;
  let pending = 0;
  let pendingSinceMs = 0;
  let lastEvalMs = opts.startedAtMs;

  function advance(next: number, nowMs: number): void {
    const clamped = Math.max(tier, Math.min(next, MAX_THERMAL_TIER));
    if (clamped <= tier) return;
    tier = clamped;
    pending = tier;
    sampler.noteTierChange(nowMs);
    opts.onTierChange(tier);
  }

  return {
    tick(nowMs: number): void {
      sampler.sample(nowMs);
      if (nowMs - lastEvalMs < evalIntervalMs) return;
      lastEvalMs = nowMs;
      // Arm at most one tier ahead, and only while nothing is already armed —
      // otherwise a long slow episode could queue 0 → 2 before the user ever gets
      // a chance to have the first step hidden.
      if (pending === tier && tier < MAX_THERMAL_TIER && sampler.shouldDemote(nowMs)) {
        pending = tier + 1;
        pendingSinceMs = nowMs;
      }
      if (pending > tier && nowMs - pendingSinceMs >= maxDeferMs) advance(pending, nowMs);
    },

    commitOnCameraMotion(nowMs: number): void {
      if (pending > tier) advance(pending, nowMs);
    },

    clear(nowMs: number): void {
      sampler.clear(nowMs);
    },

    force(tierIndex: number, nowMs: number): void {
      advance(tierIndex, nowMs);
    },

    tier: () => tier,
    pendingTier: () => pending,
    medianDeltaMs: () => sampler.medianDeltaMs(),
  };
}
