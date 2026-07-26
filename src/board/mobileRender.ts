/**
 * ── MOBILE ON-DEMAND RENDER + ADAPTIVE-DPR BUS (MOBILE ONLY) ──────────────────
 *
 * On mobile the <Canvas> runs `frameloop="demand"`: NOTHING renders unless a
 * frame is explicitly requested via R3F's `invalidate()`. That gives us three
 * wins at once — a crisp board when the scene is STILL (render one frame at
 * native dpr, then idle), a cheap/fast render while MOVING (low dpr), and ZERO
 * work when idle (no sustained GPU load → no thermal throttle).
 *
 * This module is the tiny shared "bus" every animation source pokes so nothing
 * ever freezes on a stale frame. A single <MobileRenderController> (mounted only
 * on mobile, inside the Canvas) REGISTERS the R3F `invalidate` + a dpr applier
 * here; every animating component then calls the plain functions below WITHOUT
 * needing Canvas context of its own:
 *
 *   • bumpMotion() — "something is visibly MOVING this frame": renders now, drops
 *     to the cheap MOVING dpr, and (re)arms the settle timer. Called every active
 *     frame by the token walk, dice physics, character clips, and camera changes,
 *     plus on touch drag / wheel. While it keeps being called the scene keeps
 *     rendering at low dpr; SETTLE_MS after the LAST call the settle timer fires,
 *     bumps dpr back to native, and renders ONE crisp frame — then idles.
 *   • pokeRender(frames) — "a discrete change happened, paint a few frames at the
 *     CURRENT dpr" (no dpr drop). The safety net for store changes / taps.
 *   • isMobileRenderActive() — true only while the controller is mounted (mobile),
 *     so callers can early-out; OFF mobile every function here is a hard no-op, so
 *     desktop (frameloop="always") is completely untouched.
 *
 * Adaptive dpr note: the mobile post chain runs through a postprocessing
 * EffectComposer whose internal buffers are sized from the renderer's DRAWING
 * BUFFER (cssSize × pixelRatio). R3F's setDpr changes the pixel ratio but does
 * NOT resize the composer, so the `applyDpr` callback the controller registers
 * must ALSO call `composer.setSize()` — otherwise the scene would keep rendering
 * at the composer's mount-time resolution and dpr changes would be invisible.
 */

interface MobileRenderConfig {
  /** Cheap dpr used while anything is moving (fast, smooth, forest overdraw ok). */
  dprMoving: number;
  /** Native/crisp dpr used at rest (rendered ONCE per settle, then idle). */
  dprStill: number;
  /** Debounce (ms) of no-motion before dropping to the crisp still dpr. */
  settleMs: number;
}

type InvalidateFn = (frames?: number) => void;
/** Applies a device-pixel-ratio to the renderer AND resizes the post composer. */
type ApplyDprFn = (dpr: number) => void;
/** Reads R3F's LIVE viewport dpr (source of truth — never a stale local cache). */
type ReadDprFn = () => number;

let active = false;
let invalidateFn: InvalidateFn | null = null;
let applyDprFn: ApplyDprFn | null = null;
let readDprFn: ReadDprFn | null = null;
let config: MobileRenderConfig = { dprMoving: 1.3, dprStill: 2, settleMs: 250 };
let settleTimer: ReturnType<typeof setTimeout> | null = null;
// Sustained-render loop state (see sustainRender below). A single rAF handle +
// a deadline: while the handle is live, invalidate() is called every animation
// frame until performance.now() passes the deadline (or stopSustainRender()).
let sustainRaf: number | null = null;
let sustainDeadline = 0;

/**
 * Mount-time registration from <MobileRenderController> (mobile only). Wires the
 * live R3F `invalidate`, a dpr applier, and a live-dpr reader; seeds the STILL
 * (crisp) dpr; and paints an initial frame. Returns an unregister cleanup that
 * disarms everything so OFF mobile (or on unmount) every helper below hard no-ops.
 *
 * The dpr target is decided by comparing against `readDpr()` (R3F's LIVE dpr)
 * rather than a local cache: R3F's Canvas reconfigure re-applies the `dpr` PROP on
 * every Canvas re-render, which can reset the live dpr back to STILL mid-motion.
 * Reading the live value means bumpMotion re-asserts MOVING on the very next
 * frame, self-healing that reset instead of desyncing.
 */
export function registerMobileRender(
  invalidate: InvalidateFn,
  applyDpr: ApplyDprFn,
  readDpr: ReadDprFn,
  cfg: MobileRenderConfig,
): () => void {
  invalidateFn = invalidate;
  applyDprFn = applyDpr;
  readDprFn = readDpr;
  config = cfg;
  active = true;
  applyDpr(cfg.dprStill);
  invalidate();
  return () => {
    active = false;
    invalidateFn = null;
    applyDprFn = null;
    readDprFn = null;
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    stopSustainRender();
  };
}

/** True only while the mobile controller is mounted (mobile on-demand active). */
export function isMobileRenderActive(): boolean {
  return active;
}

function settle(): void {
  settleTimer = null;
  if (!active || !applyDprFn || !invalidateFn || !readDprFn) return;
  // No motion for SETTLE_MS → bump to native dpr (if not already) and render ONE
  // crisp frame, then idle.
  if (readDprFn() !== config.dprStill) applyDprFn(config.dprStill);
  invalidateFn();
}

/**
 * Mark visible motion THIS frame. Requests a render, ensures the cheap MOVING dpr
 * (resizing the composer only when the LIVE dpr isn't already MOVING — so it also
 * self-heals a reconfigure reset), and (re)arms the settle debounce so the crisp
 * frame lands SETTLE_MS after motion stops. Called every active frame by an
 * animation this self-perpetuates the demand loop (invalidate() from inside a
 * useFrame schedules the next frame). Hard no-op off mobile.
 */
export function bumpMotion(): void {
  if (!active || !invalidateFn || !applyDprFn || !readDprFn) return;
  if (readDprFn() !== config.dprMoving) applyDprFn(config.dprMoving);
  invalidateFn();
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, config.settleMs);
}

/**
 * Request a short BURST of frames at the CURRENT dpr without forcing the MOVING
 * state (used for discrete changes: store updates, taps). Ensures the scene
 * repaints even when a change is applied imperatively (outside React
 * reconciliation, which R3F would otherwise auto-invalidate). Hard no-op off
 * mobile.
 */
export function pokeRender(frames = 3): void {
  if (!active || !invalidateFn) return;
  invalidateFn(frames);
}

/**
 * Start (or extend) a SUSTAINED render loop: an independent requestAnimationFrame
 * loop that calls invalidate() EVERY frame until `durationMs` elapses (or
 * stopSustainRender() is called). Use this for animations that MUST render
 * continuously and cannot rely on the per-frame self-perpetuation pattern
 * (bumpMotion() from inside a useFrame requesting the next frame): the dice roll
 * is PHYSICS-driven — Rapier only steps the world when a frame renders — and the
 * self-bump has a startup race where the first frames aren't sustained, so the
 * physics never starts stepping and the dice freeze mid-spawn. Driving frames
 * from this deadline-bounded rAF loop guarantees Rapier steps every frame for the
 * whole roll, independent of any useFrame timing. Calling it again while a loop
 * is live just extends the deadline. Hard no-op off mobile. NOTE: this loop only
 * requests renders (invalidate) — it does NOT touch dpr; the animation source
 * still uses bumpMotion()/the settle debounce to control moving↔still dpr.
 */
export function sustainRender(durationMs: number): void {
  if (!active || !invalidateFn) return;
  sustainDeadline = Math.max(sustainDeadline, performance.now() + durationMs);
  if (sustainRaf !== null) return; // loop already running — deadline just extended
  const tick = (): void => {
    if (!active || !invalidateFn || performance.now() >= sustainDeadline) {
      sustainRaf = null;
      sustainDeadline = 0;
      return;
    }
    invalidateFn();
    sustainRaf = requestAnimationFrame(tick);
  };
  sustainRaf = requestAnimationFrame(tick);
}

/** Stop the sustained render loop early (before its deadline). Safe to call when
 *  no loop is running. The settle debounce then paints the final crisp frame. */
export function stopSustainRender(): void {
  if (sustainRaf !== null) {
    cancelAnimationFrame(sustainRaf);
    sustainRaf = null;
  }
  sustainDeadline = 0;
}
