/**
 * ── MOBILE ADAPTIVE-DPR BUS (MOBILE ONLY) ─────────────────────────────────────
 *
 * The <Canvas> runs `frameloop="always"` on BOTH desktop and mobile, so physics
 * (Rapier) and every useFrame step run every frame exactly like desktop — there
 * is NO on-demand render gating. This tiny shared "bus" does ONE thing on mobile:
 * it drops the device-pixel-ratio while the CAMERA is moving (cheap render during
 * orbit/zoom/pan) and restores the crisp native dpr once the camera settles.
 *
 * It is a resolution knob, NOT a render trigger. A single <MobileRenderController>
 * (mounted only on mobile, inside the Canvas) REGISTERS a dpr applier + a live-dpr
 * reader here; camera-driven code then calls the plain functions below WITHOUT
 * needing Canvas context of its own:
 *
 *   • beginCameraMotion() — "the user STARTED a camera gesture": drop to the cheap
 *     MOVING dpr and CANCEL any pending settle timer. Called ONLY from the
 *     OrbitControls 'start' interaction event (CameraRig) — i.e. a real user
 *     drag / pinch / wheel.
 *   • endCameraMotion() — "the user ENDED a camera gesture": arm the settle timer
 *     so the crisp STILL dpr is restored SETTLE_MS after the gesture ends. Called
 *     ONLY from the OrbitControls 'end' interaction event (CameraRig).
 *
 * These fire on GENUINE user camera gestures only. OrbitControls' 'start'/'end'
 * events do NOT fire for programmatic controls.update(), so the third-person
 * follow-lerp, token walk, dice roll and character animation deliberately never
 * touch dpr — dpr changes on real user camera movement and nothing else. Hard
 * no-op off mobile.
 *
 * Because rendering is always-on, a dpr change applies on the very next frame
 * automatically — nothing here needs (or calls) R3F's invalidate().
 *
 * Adaptive dpr note: the mobile post chain runs through a postprocessing
 * EffectComposer whose internal buffers are sized from the renderer's DRAWING
 * BUFFER (cssSize × pixelRatio). R3F's setDpr changes the pixel ratio but does
 * NOT resize the composer, so the `applyDpr` callback the controller registers
 * must ALSO call `composer.setSize()` — otherwise the scene would keep rendering
 * at the composer's mount-time resolution and dpr changes would be invisible.
 *
 * ── THERMAL STEP-DOWN RATCHET (MOBILE ONLY) ───────────────────────────────────
 *
 * Layered ON TOP of the camera-motion knob above, sharing its `config` and its
 * `applyDpr`. The device thermally throttles over a long session and iOS Safari
 * has no thermal API, so a rolling frame-time median stands in for one.
 *
 * The tier table, the statistic, every threshold AND the ratchet state machine
 * live in `thermalDpr.ts` — pure, clock-injected and unit-tested to the frame.
 * This file is only the wiring: a rAF loop feeding it timestamps, and the four
 * things that need a real renderer.
 *
 *  1. THE RATCHET LIVES FOR THE PAGE, NOT THE MOUNT. The `ratchet` singleton is
 *     created once and deliberately NOT torn down on unregister, so the tier
 *     survives a GameScene remount — a rematch is not a cool phone. It has one
 *     assignment site (`advance()` in thermalDpr.ts), `Math.max`-clamped against
 *     the current tier, so no caller, ordering, remount or DEV override can walk
 *     it back down. Two further re-raise vectors are closed HERE:
 *     `registerMobileRender` re-clamps the fresh config to the live tier before
 *     its first `applyDpr`, and `reassertDpr` (4) only ever lowers.
 *
 *  2. MOTION GATING. An armed tier is committed inside `beginCameraMotion()`,
 *     i.e. at the exact instant the user starts an orbit and the renderer is
 *     dropping to `dprMoving` anyway. The step therefore lands underneath a
 *     resolution change the user already sees and already accepts, instead of
 *     popping on a still frame. `onTierChange` deliberately does NOT touch the
 *     live dpr while a gesture is in flight — it only rewrites `config`, and the
 *     existing `settle()` path picks up the new, lower still dpr when the gesture
 *     ends. Net cost to the user: zero extra resolution changes.
 *
 *  3. THE DEFERRAL DEADLINE (`MAX_DEFER_MS`, in thermalDpr.ts). Motion gating
 *     alone would make this feature inert for a player who never orbits — the
 *     worst outcome for exactly the player most likely to be sitting in a long,
 *     hot session. After the deadline the tier is applied anyway, pop and all: a
 *     one-off softening beats a whole session pinned at 30 fps.
 *
 *  4. THE R3F CLOBBER WATCHDOG. `<Canvas>`'s configure effect has NO dependency
 *     array, so every GameScene re-render re-runs it, and configure contains
 *     `if (dpr && viewport.dpr !== calculateDpr(dpr)) setDpr(dpr)`. The `dpr`
 *     prop is the constant `MOBILE_DPR_STILL` (2). So an ordinary store update
 *     would silently undo a landed tier and hand every saved pixel straight back.
 *     `reassertDpr` re-applies the intended dpr at 2 Hz whenever the live value
 *     has drifted ABOVE it. The `>` comparison is the safety property: it can
 *     lower, and has no branch that raises.
 *
 * FOR THE `frameloop="demand"` WORK (item 1): the sampler runs on its OWN rAF
 * loop, not `useFrame`, precisely so that it does not depend on the render mode.
 * Be aware of the consequence, though — rAF is display-driven, so under `demand`
 * the deltas stay at the display cadence even when nothing is rendered, and the
 * signal reads "cool". That is a safe failure (it under-triggers, never
 * over-triggers), but it does mean this signal will need revisiting once frames
 * and rAF ticks stop being the same thing.
 */

import { THERMAL_TIERS, createThermalRatchet, type ThermalRatchet } from './thermalDpr';
import { launchFlag } from '../dev/urlFlags';

interface MobileRenderConfig {
  /** Cheap dpr used while the camera is moving (fast, smooth orbit/zoom/pan). */
  dprMoving: number;
  /** Native/crisp dpr used at rest (restored once the camera settles). */
  dprStill: number;
  /** Debounce (ms) of no camera motion before restoring the crisp still dpr. */
  settleMs: number;
}

/** Applies a device-pixel-ratio to the renderer AND resizes the post composer. */
type ApplyDprFn = (dpr: number) => void;
/** Reads R3F's LIVE viewport dpr (source of truth — never a stale local cache). */
type ReadDprFn = () => number;

let active = false;
let applyDprFn: ApplyDprFn | null = null;
let readDprFn: ReadDprFn | null = null;
let config: MobileRenderConfig = { dprMoving: 1.3, dprStill: 2, settleMs: 250 };
let settleTimer: ReturnType<typeof setTimeout> | null = null;

/** How often the R3F-clobber watchdog checks the live dpr. Idle when tier 0. */
const REASSERT_INTERVAL_MS = 500;

/**
 * The ratchet — created ONCE and never destroyed, so it outlives
 * `registerMobileRender`: a GameScene remount is not a cool phone. All of its
 * decision logic, its thresholds and the no-step-up invariant live in
 * `thermalDpr.ts`, clock-injected and unit-tested; this file only reacts to
 * `onTierChange`.
 */
let ratchet: ThermalRatchet | null = null;
/** True between `beginCameraMotion()` and the settle that follows it. */
let motionActive = false;
/**
 * The un-throttled dpr pair the controller registered. Tiers are applied as
 * `min(base, cap)` against THESE, never against the already-clamped live config
 * — otherwise re-registering would compound the clamp on every remount.
 */
let baseStill = 2;
let baseMoving = 1.3;

let rafHandle: number | null = null;
let lastAssertMs = 0;
let visibilityHandler: (() => void) | null = null;

/** DEV kill-switch: `?thermal=0` disables the monitor (the tier stays 0). */
function thermalEnabled(): boolean {
  return launchFlag('thermal') !== '0';
}

/** Current ratchet position (0 = untouched). For the DEV readout and harnesses. */
export function getThermalTier(): number {
  return ratchet?.tier() ?? 0;
}

/**
 * Live frame-time median in ms, or NaN before the window fills. DEV readout only
 * — nothing in the render path reads this.
 */
export function getThermalMedianMs(): number {
  return ratchet?.medianDeltaMs() ?? NaN;
}

/**
 * DEV/measurement seam: jump straight to a tier, bypassing the signal and the
 * motion gating. Drives the `?thermalTier=N` launch flag (on-device A/B) and the
 * pixel-census + screenshot harnesses, which need each rung deterministically.
 * Routed through the ratchet, so it can raise a tier but never lower one.
 * No-op in production and no-op before the controller has mounted.
 */
export function devForceThermalTier(tier: number): void {
  if (!import.meta.env.DEV) return;
  ratchet?.force(tier, performance.now());
}

/**
 * DEV-ONLY escape hatch for the `DebugTogglePanel` tier selector: puts the
 * ratchet back to a clean tier-0 state, LIVE, without adding any decrement
 * path to the production state machine.
 *
 * `advance()` in thermalDpr.ts (the ratchet's ONE assignment site, shared by
 * the automatic tick() path and `force()`) is completely untouched by this
 * function — its `clamped <= tier → return` guard still makes every real
 * caller one-way. This works instead by DISCARDING the ratchet instance and
 * letting the existing cold-start line in `startThermalMonitor`
 * (`ratchet ??= createThermalRatchet(...)`) build a fresh one — the exact same
 * code path a brand-new page load takes, not a new "go down" branch grafted
 * onto the ratchet. A fresh ratchet starts at tier 0 with its warm-up timer
 * re-armed, so the automatic sampler resumes driving it exactly as it would
 * from a cool session — which is what makes this the "Auto" option in the
 * panel, not just a reset button: it hands control back to the normal
 * ratcheting behaviour, it does not freeze anything at 0.
 *
 * Also re-applies the tier-0 (un-throttled) dpr caps to the live renderer
 * immediately via `onTierChange(0)`, rather than waiting for the next natural
 * tier-change callback, so the resolution change is visible on the very next
 * frame — a control you can't see take effect is useless for on-device A/B.
 *
 * No-op in production. Safe to call before/after the controller has
 * (un)mounted: `onTierChange` already no-ops without a live `applyDprFn`, and
 * `startThermalMonitor`/`stopThermalMonitor` are idempotent.
 */
export function devResetThermalTier(): void {
  if (!import.meta.env.DEV) return;
  stopThermalMonitor();
  ratchet = null;
  onTierChange(0);
  if (thermalEnabled()) startThermalMonitor();
}

/**
 * The scene/city dpr the pipeline should actually use this frame: the prop it was
 * given, capped by the live tier. Called once per frame per pass by
 * <MobileCrispBoardPipeline>, which already re-derives every FBO size from the
 * live pixel ratio — so lowering the cap resizes the scene, city and AO targets
 * on the next frame with no extra plumbing and no resource rebuild.
 *
 * At tier 0 the cap is Infinity and this is the identity function, which is what
 * makes "first load is byte-identical to today" a property of the code rather
 * than a claim. Off mobile the pipeline does not exist, so this is never called.
 */
export function thermalSceneDprCap(baseSceneDpr: number): number {
  return Math.min(baseSceneDpr, THERMAL_TIERS[getThermalTier()].sceneDpr);
}

/**
 * The ratchet's `onTierChange` sink. Rewrites `config` from the UNCLAMPED base
 * values, then applies the new still dpr immediately ONLY when no gesture is in
 * flight — during a gesture `beginCameraMotion` is about to set `dprMoving`
 * anyway and `settle()` will pick the new still dpr up, which is the whole point
 * of the motion gating.
 */
function onTierChange(tier: number): void {
  const t = THERMAL_TIERS[tier];
  config.dprStill = Math.min(baseStill, t.stillDpr);
  // A tier must never leave the moving dpr ABOVE the still dpr — that would make
  // orbiting more expensive than resting and invert the whole knob. A no-op for
  // the shipped table (its still caps sit at 1.5, above MOBILE_DPR_MOVING = 1.3);
  // load-bearing the moment anyone adds a rung below 1.3.
  config.dprMoving = Math.min(baseMoving, config.dprStill);
  if (!motionActive && applyDprFn && readDprFn && readDprFn() !== config.dprStill) {
    applyDprFn(config.dprStill);
  }
}

/**
 * Downward-only re-assert of the intended dpr — see (4) in the header. The `>`
 * comparison is the safety property: this can lower the live dpr back to the
 * tier, and it has no branch that can raise it. Skipped entirely at tier 0 (there
 * is nothing to defend) and during the settle debounce (the timer owns the dpr).
 */
function reassertDpr(): void {
  if (getThermalTier() === 0) return;
  if (!active || !applyDprFn || !readDprFn) return;
  if (settleTimer !== null) return;
  const want = motionActive ? config.dprMoving : config.dprStill;
  if (readDprFn() > want + 1e-3) applyDprFn(want);
}

/**
 * The monitor's own rAF loop. Deliberately NOT a `useFrame` subscription: this
 * has to keep measuring wall-clock frame cadence independently of how (or
 * whether) R3F decides to render — see the note on item 1 in the header. One
 * extra rAF callback per frame next to 165 draw calls is not a measurable cost.
 */
function monitorTick(nowMs: number): void {
  rafHandle = requestAnimationFrame(monitorTick);
  ratchet?.tick(nowMs);
  if (nowMs - lastAssertMs >= REASSERT_INTERVAL_MS) {
    lastAssertMs = nowMs;
    reassertDpr();
  }
}

function startThermalMonitor(): void {
  if (rafHandle !== null) return;
  if (typeof requestAnimationFrame !== 'function') return;
  const now = performance.now();
  ratchet ??= createThermalRatchet({ startedAtMs: now, onTierChange });
  lastAssertMs = now;
  // Returning from a backgrounded tab / locked screen: rAF stopped, so the window
  // is stale and the first delta on resume is a discontinuity. Drop both. The
  // ratchet refuses to shorten an in-flight warm-up here, so a background/resume
  // cycle cannot be used to skip the warm-up hold.
  visibilityHandler = (): void => {
    if (document.visibilityState === 'visible') ratchet?.clear(performance.now());
  };
  document.addEventListener('visibilitychange', visibilityHandler);
  rafHandle = requestAnimationFrame(monitorTick);
}

function stopThermalMonitor(): void {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  // NOTE: the ratchet itself is NOT torn down — see (1) in the header. Only the
  // rAF loop and the listener stop; the tier it reached persists for the page.
}

/**
 * Mount-time registration from <MobileRenderController> (mobile only). Wires the
 * dpr applier + a live-dpr reader and seeds the STILL (crisp) dpr. Returns an
 * unregister cleanup that disarms everything so OFF mobile (or on unmount)
 * begin/endCameraMotion() hard no-op.
 *
 * The dpr target is decided by comparing against `readDpr()` (R3F's LIVE dpr)
 * rather than a local cache: R3F's Canvas reconfigure re-applies the `dpr` PROP on
 * every Canvas re-render, which can reset the live dpr back to STILL mid-motion.
 * Reading the live value means beginCameraMotion re-asserts MOVING on the very
 * next gesture, self-healing that reset instead of desyncing.
 *
 * THERMAL: the incoming cfg is the UN-throttled pair, so it is copied (never
 * aliased — this file mutates `config`) and stashed as the base the tier caps are
 * applied to. If a tier has already landed earlier in the page's life, it is
 * re-clamped onto the fresh config BEFORE the first applyDpr — otherwise a
 * GameScene remount would seed the renderer at the un-throttled dpr and quietly
 * hand back every pixel the ratchet had saved.
 */
export function registerMobileRender(
  applyDpr: ApplyDprFn,
  readDpr: ReadDprFn,
  cfg: MobileRenderConfig,
): () => void {
  applyDprFn = applyDpr;
  readDprFn = readDpr;
  baseStill = cfg.dprStill;
  baseMoving = cfg.dprMoving;
  const tier = THERMAL_TIERS[getThermalTier()];
  const still = Math.min(cfg.dprStill, tier.stillDpr);
  config = {
    dprStill: still,
    dprMoving: Math.min(cfg.dprMoving, still),
    settleMs: cfg.settleMs,
  };
  motionActive = false;
  active = true;
  applyDpr(config.dprStill);
  if (thermalEnabled()) startThermalMonitor();
  const forced = launchFlag('thermalTier');
  if (forced !== null) devForceThermalTier(Number(forced));
  return () => {
    active = false;
    applyDprFn = null;
    readDprFn = null;
    stopThermalMonitor();
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  };
}

function settle(): void {
  settleTimer = null;
  motionActive = false;
  if (!active || !applyDprFn || !readDprFn) return;
  // No camera motion for SETTLE_MS → restore native dpr (if not already). Under
  // always-render the crisp frame draws on the next tick automatically.
  // THERMAL: `config.dprStill` may have been lowered by a tier committed at the
  // START of this very gesture, so what is restored here is the NEW still dpr.
  // The user sees one resolution change (crisp → moving) and one restore, exactly
  // as they always do; only the height of the restore differs, and they have no
  // reference frame for it because the view moved in between.
  if (readDprFn() !== config.dprStill) applyDprFn(config.dprStill);
}

/**
 * User STARTED a camera gesture (OrbitControls 'start': drag / pinch / wheel).
 * Immediately drops to the cheap MOVING dpr (resizing the composer only when the
 * LIVE dpr isn't already MOVING — so it also self-heals a reconfigure reset) and
 * CANCELS any pending settle timer so the crisp dpr cannot restore mid-gesture.
 * Fires ONLY on genuine user camera movement — never on programmatic
 * controls.update() (the third-person follow-lerp). Hard no-op off mobile.
 *
 * THERMAL: this is also the gate an armed tier waits for. Order matters —
 * `motionActive` is set FIRST so `applyTier` knows a gesture is in flight and
 * leaves the live dpr alone, then the tier is committed (rewriting `config`),
 * then the normal drop to `dprMoving` runs. Net effect: the step-down costs the
 * user zero extra resolution changes, because the one it needs was already
 * happening.
 */
export function beginCameraMotion(): void {
  if (!active || !applyDprFn || !readDprFn) return;
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  motionActive = true;
  ratchet?.commitOnCameraMotion(performance.now());
  if (readDprFn() !== config.dprMoving) applyDprFn(config.dprMoving);
}

/**
 * User ENDED a camera gesture (OrbitControls 'end': release / pinch-end / wheel
 * settle). Arms the settle debounce so the crisp STILL dpr is restored SETTLE_MS
 * after the gesture ends. Fires ONLY on genuine user camera movement. Hard no-op
 * off mobile.
 */
export function endCameraMotion(): void {
  if (!active || !applyDprFn || !readDprFn) return;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, config.settleMs);
}
