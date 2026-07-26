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
 */

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
 */
export function registerMobileRender(
  applyDpr: ApplyDprFn,
  readDpr: ReadDprFn,
  cfg: MobileRenderConfig,
): () => void {
  applyDprFn = applyDpr;
  readDprFn = readDpr;
  config = cfg;
  active = true;
  applyDpr(cfg.dprStill);
  return () => {
    active = false;
    applyDprFn = null;
    readDprFn = null;
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  };
}

function settle(): void {
  settleTimer = null;
  if (!active || !applyDprFn || !readDprFn) return;
  // No camera motion for SETTLE_MS → restore native dpr (if not already). Under
  // always-render the crisp frame draws on the next tick automatically.
  if (readDprFn() !== config.dprStill) applyDprFn(config.dprStill);
}

/**
 * User STARTED a camera gesture (OrbitControls 'start': drag / pinch / wheel).
 * Immediately drops to the cheap MOVING dpr (resizing the composer only when the
 * LIVE dpr isn't already MOVING — so it also self-heals a reconfigure reset) and
 * CANCELS any pending settle timer so the crisp dpr cannot restore mid-gesture.
 * Fires ONLY on genuine user camera movement — never on programmatic
 * controls.update() (the third-person follow-lerp). Hard no-op off mobile.
 */
export function beginCameraMotion(): void {
  if (!active || !applyDprFn || !readDprFn) return;
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
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
