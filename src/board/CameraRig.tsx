import { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useGameStore, selectCurrentPlayer, selectMyPlayer } from '../state/gameStore';
import type { CameraReadout } from '../state/gameStore';
import { thirdPersonPose, thirdPersonPoseAt } from './positions';
import { getLiveTokenPosition } from './liveTokenPositions';
import { INITIAL_CAM_TARGET, INITIAL_CAM_OFFSET, MOBILE_INITIAL_CAM_OFFSET } from './cameraConstants';
import { useIsMobile } from '../ui/useIsMobile';
import { beginCameraMotion, endCameraMotion } from './mobileRender';

// Frame-rate-aware smoothing rate for the follow lerp. Higher = snappier.
// alpha = 1 - exp(-RATE * delta) → ease-out, no snapping, stable at any FPS.
const FOLLOW_LERP_RATE = 6;

// OrbitControls damping factor: how fast the inertial drift after a
// release decays (higher = faster stop). Desktop keeps the original feel;
// mobile uses a much faster decay so the inertial drift tail after a release
// clears in ~150-250ms instead of ~1s. Adaptive dpr is now driven by the
// 'start'/'end' gesture events (see onStart/onEnd below), so the settle timer
// is armed on gesture end — the faster mobile decay keeps the post-release
// drift short so the crisp dpr restores promptly after the camera stops.
const DESKTOP_DAMPING_FACTOR = 0.08;
const MOBILE_DAMPING_FACTOR = 0.25;

// ── MOBILE-ONLY camera-collision clamps (desktop FROZEN) ──────────────────────
// The free/Blender-style camera has NO scene collision, so on mobile the user
// could orbit/pan/zoom the camera BELOW the terrain floor or INTO the rocks/city.
// From inside a mesh, its backface-culled far side reads as see-through ("clip
// through the floor and rocks"). These clamps keep the camera above the ground
// plane and out of the props. They are all MOBILE-gated — desktop keeps the
// original relaxed clamps (the DESKTOP_* values below) so the desktop
// OrbitControls props AND runtime behavior stay byte-identical (no clamp listener
// ever mutates the desktop camera; see the isMobileRef guard in handleMount).
//
// The hard GUARANTEE against going under the floor is the per-'change' Y clamp
// (MOBILE_MIN_CAM_Y / MOBILE_MIN_TARGET_Y): polar/distance limits shape the feel
// but panning the pivot could still drag the camera down, so we also clamp world
// Y directly after every OrbitControls move. Terrain floor near the board sits at
// FOREST_Y ≈ -0.48 (board bottom) with the board top at y ≈ 0.02.
const MOBILE_MAX_POLAR_ANGLE = 1.52; // rad (~87°): a low, near-horizon board view so the starfield/Milky Way fills the upper view, just short of tipping under the floor
const MOBILE_MIN_DISTANCE = 4.0;     // world units: can't dolly INSIDE the city/rocks (initial mobile framing sits at MOBILE_CAM_DIST = 6.9, so zoom-in still works)
const MOBILE_MIN_CAM_Y = 1.0;        // world units: HARD floor — the camera's world Y can never dip below this (safely above the −0.48 terrain floor and low ground clutter)
const MOBILE_MIN_TARGET_Y = -0.3;    // world units: the orbit pivot can't be aimed below ~board level (aiming lower would drag the whole view under the terrain)

// Desktop clamps (UNCHANGED — hoisted to named consts so the mobile/desktop split
// in the OrbitControls props below is explicit and desktop stays byte-identical).
const DESKTOP_MAX_POLAR_ANGLE = 1.55;
const DESKTOP_MIN_DISTANCE = 2.5;

// ── MOBILE-ONLY free-look aim tuning (desktop FROZEN) ─────────────────────────
// Free-look DECOUPLES the aim from the orbit target: OrbitControls is disabled and
// the camera rotates IN PLACE (Euler YXZ) so the user can pitch fully up to the
// zenith without the camera ever orbiting under the terrain. Position only moves on
// two-finger pan/pinch and is always kept above the MOBILE_MIN_CAM_Y floor.
const FREELOOK_LOOK_SPEED = 0.005;               // rad per px of one-finger drag (yaw/pitch sensitivity)
const FREELOOK_PITCH_LIMIT = Math.PI / 2 - 0.01; // ~89.4°: essentially straight up/down, just shy of the pole so there is no gimbal flip
const FREELOOK_PAN_SPEED = 0.012;                // world units per px (two-finger drag → strafe/lift)
const FREELOOK_DOLLY_SPEED = 0.03;               // world units per px of pinch spread (two-finger pinch → dolly)
const FREELOOK_LOOK_RATE = 14;                   // frame-rate-aware easing rate for the aim (higher = snappier, no snap)

/**
 * CameraRig: free Blender-style viewport navigation with a fixed initial framing.
 *
 * Navigation model (like Blender's viewport):
 * - LEFT-drag ORBITS the camera around the OrbitControls target ("rotate around
 *   an axis"). Holding SHIFT while left-dragging switches the drag to PAN, so the
 *   whole view (target + camera) slides across the diorama — travel anywhere.
 * - RIGHT and MIDDLE buttons are DISABLED — all interaction is via LEFT + Shift.
 * - Scroll wheel zooms (dolly). Distance clamps are relaxed so the user can get
 *   right up to a token or pull way back over the whole forest diorama.
 * - Polar clamps are relaxed to allow near-top-down through near-horizon, but
 *   stop just short of the horizon so the camera never dips under the board.
 *
 * SHIFT→pan wiring: OrbitControls has no built-in shift-to-pan, so we listen for
 * Shift keydown/keyup on window and swap `controls.mouseButtons.LEFT` between
 * THREE.MOUSE.ROTATE (default) and THREE.MOUSE.PAN (while Shift held). Listeners
 * are torn down on unmount.
 *
 * Initial snap: on first mount (when both OrbitControls and game state are ready),
 * controls.target is set to INITIAL_CAM_TARGET (a fixed world point, NOT the
 * active player's tile) and the camera is placed at INITIAL_CAM_TARGET +
 * INITIAL_CAM_OFFSET. After that the camera stays exactly where it is — there is
 * NO per-turn auto-focus drift. Only the user's manual orbit/pan/zoom moves it.
 *
 * The live camera debug overlay (throttled ~8x/sec) stays active so the user can
 * continue tuning the constants via the overlay readout.
 */
export function CameraRig() {
  // Mutable ref (not passed directly as JSX `ref=`) so `handleMount` can assign
  // `.current`. The `| null` initializer widens this to a MutableRefObject.
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  // Track whether we've snapped to the fixed initial view on first mount.
  const initialSnapDone = useRef(false);

  // Tracks physical Shift key state so the cameraMode restore can set LEFT correctly
  // even when Shift is held across a thirdPerson→free toggle.
  const shiftHeldRef = useRef(false);

  // Original orbit clamp values captured once on first cameraMode effect run.
  // Stored so thirdPerson can relax them and free-mode restores exactly the originals.
  const origClampsRef = useRef<{
    minDistance: number;
    maxDistance: number;
    maxPolarAngle: number;
  } | null>(null);

  const setCameraReadout = useGameStore((s) => s.setCameraReadout);
  // Throttle accumulator: only push readout ~every 0.12s (~8x/sec, not every frame).
  const readoutAccum = useRef(0);

  // Access the R3F camera for the initial snap (sets camera position too).
  const camera = useThree((s) => s.camera);
  // The WebGL canvas element — free-look attaches its own touch listeners here.
  // (undefined in the unit-test's useThree stub; the free-look effect guards for it.)
  const gl = useThree((s) => s.gl);

  // Mobile framing: dolly the initial view IN so the board fills the short
  // landscape viewport. Read into a ref so the (dependency-array-free) initial
  // snap effect always sees the current value without re-subscribing. Desktop
  // (isMobile === false) uses INITIAL_CAM_OFFSET exactly as before.
  const isMobile = useIsMobile();
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;

  // Active player = whose turn it is (NOT socket.id). Doubles as the store-hydration
  // guard for the initial snap below.
  const activePlayer = useGameStore(selectCurrentPlayer);
  // Fall back to MY player token when there is no active/current player.
  const myPlayer = useGameStore(selectMyPlayer);

  // ── Follow-mode state ────────────────────────────────────────────────────
  // cameraMode drives whether the useFrame loop follows a token or stays hands-off.
  const cameraMode = useGameStore((s) => s.cameraMode);

  // Refs mirror the reactive values so the single useFrame closure never goes stale.
  const cameraModeRef = useRef(cameraMode);
  cameraModeRef.current = cameraMode;
  const followTileRef = useRef<number | null>(null);
  followTileRef.current =
    activePlayer?.position ?? myPlayer?.position ?? null;
  // Id of the SAME follow-target player (active player, else my player), used to
  // look up that token's LIVE animated world position from the live-position bus.
  // Parallels followTileRef so the tile (for the behind-direction) and the live
  // position (for the location) always describe the same token.
  const followIdRef = useRef<string | null>(null);
  followIdRef.current = activePlayer?.id ?? myPlayer?.id ?? null;

  // Reusable scratch vectors so the follow lerp allocates nothing per frame.
  const scratchCamPos = useRef(new THREE.Vector3());
  const scratchTarget = useRef(new THREE.Vector3());

  // ── Free-look (mobile) aim state ─────────────────────────────────────────
  // yaw/pitch are the eased ACTUAL aim; *Target are the drag-driven goals. The
  // useFrame loop eases actual→target every frame (damped, no jitter/snap). All
  // preallocated so the per-frame free-look path allocates nothing.
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const yawTargetRef = useRef(0);
  const pitchTargetRef = useRef(0);
  const freeLookEuler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const flForward = useRef(new THREE.Vector3());
  const flRight = useRef(new THREE.Vector3());
  const flUp = useRef(new THREE.Vector3());
  // Tracks the previous cameraMode so we can re-frame the board exactly when
  // LEAVING free-look (return to normal gameplay framing).
  const prevModeRef = useRef(cameraMode);

  // Re-frame to the fixed board view (target = INITIAL_CAM_TARGET, camera =
  // target + the mobile/desktop initial offset). Shared by the first-mount snap
  // and the exit-from-free-look re-frame so both land on the identical framing.
  const frameToBoard = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const target = new THREE.Vector3(...INITIAL_CAM_TARGET);
    controls.target.copy(target);
    const offset = isMobileRef.current ? MOBILE_INITIAL_CAM_OFFSET : INITIAL_CAM_OFFSET;
    camera.position.set(
      target.x + offset[0],
      target.y + offset[1],
      target.z + offset[2],
    );
    controls.update();
  }, [camera]);

  // Initial snap: on first mount, snap the OrbitControls target to the fixed
  // INITIAL_CAM_TARGET and place the camera at target + INITIAL_CAM_OFFSET.
  // This fires each render until both controls and state are ready, then locks.
  // No dependency array — intentional: re-checks cheaply until the snap fires.
  useEffect(() => {
    if (initialSnapDone.current) return;
    if (!activePlayer) return;          // wait for store hydration
    if (!controlsRef.current) return;   // wait for OrbitControls mount
    frameToBoard();                     // target = INITIAL_CAM_TARGET, camera = target + offset
    initialSnapDone.current = true;
  });
  // Intentionally no dependency array: re-checks each render until both controls
  // and activePlayer are ready (may arrive after first render due to Suspense /
  // store hydration). Once initialSnapDone is set it exits immediately.

  // SHIFT → pan: swap the LEFT mouse button action while Shift is held. Right
  // stays PAN and middle stays DOLLY (set once when the controls mount below).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return;
      // Always keep shiftHeldRef accurate so the cameraMode restore reads correct state.
      shiftHeldRef.current = true;
      // While the camera is locked in third-person follow, Shift-pan is inert on controls.
      if (cameraModeRef.current === 'thirdPerson') return;
      const controls = controlsRef.current;
      if (controls) controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return;
      // Always keep shiftHeldRef accurate so the cameraMode restore reads correct state.
      shiftHeldRef.current = false;
      if (cameraModeRef.current === 'thirdPerson') return;
      const controls = controlsRef.current;
      if (controls) controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Orbit-lock toggle: when third-person follow is ON, disable the LEFT mouse
  // rotate/pan so manual orbit cannot fight the follow; when returning to free,
  // restore LEFT to PAN or ROTATE based on current Shift state (Fix 1). Also
  // relaxes orbit clamps while following so pose tuning never hits a silent
  // clamp; restores exact originals on return to free (Fix 2).
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    // Capture originals once on first run (controls is mounted by this point).
    origClampsRef.current ??= {
      minDistance: controls.minDistance,
      maxDistance: controls.maxDistance,
      maxPolarAngle: controls.maxPolarAngle,
    };

    if (cameraMode === 'thirdPerson') {
      // Lock LEFT so orbit cannot fight the follow lerp.
      controls.mouseButtons.LEFT = undefined;
      // Relax clamps so the follow pose lands cleanly across any tuning range.
      controls.minDistance = 0.5;
      controls.maxPolarAngle = Math.PI / 2 - 0.01;
      // maxDistance left unchanged — no need to constrain far bound while following.
    } else {
      // 'free' OR 'freeLook': restore LEFT respecting current physical Shift state
      // (Fix 1). In 'freeLook' OrbitControls is DISABLED (see `enabled` prop), so
      // these mouse-button/clamp values are inert until we return to 'free' — but
      // restoring them here means orbit is already correctly configured the instant
      // free-look exits and OrbitControls re-enables.
      controls.mouseButtons.LEFT = shiftHeldRef.current
        ? THREE.MOUSE.PAN
        : THREE.MOUSE.ROTATE;
      // Restore exact original clamps so free scroll-zoom + orbit are unchanged.
      const orig = origClampsRef.current;
      controls.minDistance = orig.minDistance;
      controls.maxDistance = orig.maxDistance;
      controls.maxPolarAngle = orig.maxPolarAngle;
    }

    // Leaving free-look → snap back to the normal board framing for gameplay, so
    // the user never resumes orbit stuck aimed at empty sky. (Entering free-look
    // does NOT re-frame — it seamlessly keeps the current aim; see the touch effect.)
    if (prevModeRef.current === 'freeLook' && cameraMode !== 'freeLook') {
      frameToBoard();
    }
    prevModeRef.current = cameraMode;
  }, [cameraMode, frameToBoard]);

  // ── MOBILE-ONLY free-look touch controller ───────────────────────────────
  // Active ONLY while cameraMode === 'freeLook' on mobile. OrbitControls is
  // disabled (see `enabled` prop) so drei never re-aims the camera at the target;
  // we own the camera orientation. One finger = look (rotate the view in place →
  // full pitch/yaw incl. straight up). Two fingers = pinch-dolly + pan. The camera
  // POSITION never moves while looking, so pitching to the zenith can never drag it
  // under the terrain; pan/dolly are hard-clamped to the MOBILE_MIN_CAM_Y floor.
  useEffect(() => {
    if (!isMobile) return;
    if (cameraMode !== 'freeLook') return;
    if (!gl || !gl.domElement) return;
    const el = gl.domElement;

    // Seed yaw/pitch from the camera's CURRENT orientation so entering free-look is
    // seamless — we keep looking exactly where the orbit view left off (no snap).
    const e0 = freeLookEuler.current.setFromQuaternion(camera.quaternion, 'YXZ');
    yawRef.current = yawTargetRef.current = e0.y;
    pitchRef.current = pitchTargetRef.current = THREE.MathUtils.clamp(
      e0.x, -FREELOOK_PITCH_LIMIT, FREELOOK_PITCH_LIMIT,
    );

    let mode: 'none' | 'look' | 'multi' = 'none';
    let lastX = 0, lastY = 0;
    let lastDist = 0, lastMidX = 0, lastMidY = 0;

    const dist2 = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const midX = (t: TouchList) => (t[0].clientX + t[1].clientX) / 2;
    const midY = (t: TouchList) => (t[0].clientY + t[1].clientY) / 2;

    const onStart = (ev: TouchEvent) => {
      beginCameraMotion();
      if (ev.touches.length >= 2) {
        mode = 'multi';
        lastDist = dist2(ev.touches);
        lastMidX = midX(ev.touches); lastMidY = midY(ev.touches);
      } else {
        mode = 'look';
        lastX = ev.touches[0].clientX; lastY = ev.touches[0].clientY;
      }
    };

    const onMove = (ev: TouchEvent) => {
      if (mode === 'none') return;
      ev.preventDefault();
      if (ev.touches.length >= 2) {
        // Two fingers → pinch-dolly along the view dir + pan in the view plane.
        const d = dist2(ev.touches);
        const mx = midX(ev.touches), my = midY(ev.touches);
        camera.getWorldDirection(flForward.current).normalize();
        flRight.current.crossVectors(flForward.current, camera.up).normalize();
        flUp.current.crossVectors(flRight.current, flForward.current).normalize();
        // Pinch spread → move forward; two-finger drag → strafe/lift (grab-the-world).
        camera.position.addScaledVector(flForward.current, (d - lastDist) * FREELOOK_DOLLY_SPEED);
        camera.position.addScaledVector(flRight.current, -(mx - lastMidX) * FREELOOK_PAN_SPEED);
        camera.position.addScaledVector(flUp.current, (my - lastMidY) * FREELOOK_PAN_SPEED);
        if (camera.position.y < MOBILE_MIN_CAM_Y) camera.position.y = MOBILE_MIN_CAM_Y;
        lastDist = d; lastMidX = mx; lastMidY = my;
      } else if (mode === 'look') {
        // One finger → rotate the view in place. Drag up looks up (toward the sky),
        // drag right looks right. Pitch is clamped just shy of the pole (no flip).
        const x = ev.touches[0].clientX, y = ev.touches[0].clientY;
        yawTargetRef.current -= (x - lastX) * FREELOOK_LOOK_SPEED;
        pitchTargetRef.current = THREE.MathUtils.clamp(
          pitchTargetRef.current - (y - lastY) * FREELOOK_LOOK_SPEED,
          -FREELOOK_PITCH_LIMIT, FREELOOK_PITCH_LIMIT,
        );
        lastX = x; lastY = y;
      }
    };

    const onEnd = (ev: TouchEvent) => {
      if (ev.touches.length === 0) {
        mode = 'none';
        endCameraMotion();
      } else if (ev.touches.length === 1) {
        // Dropped from two fingers to one → resume single-finger look cleanly.
        mode = 'look';
        lastX = ev.touches[0].clientX; lastY = ev.touches[0].clientY;
      } else {
        mode = 'multi';
        lastDist = dist2(ev.touches);
        lastMidX = midX(ev.touches); lastMidY = midY(ev.touches);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [cameraMode, isMobile, gl, camera]);

  useFrame((_state, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    // ── Free-look aim (mobile) ───────────────────────────────────────────────
    // Ease the actual yaw/pitch toward the drag-driven targets and write the
    // camera orientation directly. OrbitControls is disabled in this mode, so drei
    // never calls controls.update() here (see its `if (controls.enabled)` guard) —
    // nothing fights this quaternion. Position is untouched except the Y floor.
    if (cameraModeRef.current === 'freeLook') {
      const a = 1 - Math.exp(-FREELOOK_LOOK_RATE * delta);
      yawRef.current += (yawTargetRef.current - yawRef.current) * a;
      pitchRef.current += (pitchTargetRef.current - pitchRef.current) * a;
      freeLookEuler.current.set(pitchRef.current, yawRef.current, 0, 'YXZ');
      camera.quaternion.setFromEuler(freeLookEuler.current);
      if (camera.position.y < MOBILE_MIN_CAM_Y) camera.position.y = MOBILE_MIN_CAM_Y;
    }

    // ── Third-person follow (only when the mode is on) ───────────────────────
    // When 'free' we do NO work here and never touch the camera/target, so the
    // user's manual orbit/pan/zoom is never overridden. When 'thirdPerson' we
    // ease the camera + target toward the over-the-shoulder pose behind the
    // active player's token every frame. The pose is world-space (already
    // BOARD_ROTATION-applied via tileToWorldRotated), matching the camera space.
    if (cameraModeRef.current === 'thirdPerson') {
      const tile = followTileRef.current;
      if (tile != null) {
        // Follow the LIVE animated token world position (published every frame by
        // PlayerTokens) so the camera eases along WITH the walking character —
        // not just snapping to the destination tile once the walk stops. The
        // behind-direction still comes from the discrete ring tile. Fall back to
        // the discrete-tile pose before any live position has been published
        // (e.g. the very first frame). getLiveTokenPosition returns the shared
        // stored vector; thirdPersonPoseAt clones it and never mutates it.
        const followId = followIdRef.current;
        const livePos = followId != null ? getLiveTokenPosition(followId) : undefined;
        const pose = livePos ? thirdPersonPoseAt(livePos, tile) : thirdPersonPose(tile);
        // Frame-rate-aware ease-out: alpha grows with delta, capped at 1.
        const alpha = 1 - Math.exp(-FOLLOW_LERP_RATE * delta);
        const cam = controls.object;
        scratchCamPos.current.copy(pose.cameraPos);
        scratchTarget.current.copy(pose.target);
        cam.position.lerp(scratchCamPos.current, alpha);
        controls.target.lerp(scratchTarget.current, alpha);
        controls.update();
      }
      // If tile is null (no active/my player), no-op: stay put (effectively free).
    }

    // ── Throttled camera debug readout (~8x/sec, not every frame) ────────────
    readoutAccum.current += delta;
    if (readoutAccum.current >= 0.12) {
      readoutAccum.current = 0;
      const cam = controls.object;
      const tgt = controls.target;
      const readout: CameraReadout = {
        pos: [cam.position.x, cam.position.y, cam.position.z],
        target: [tgt.x, tgt.y, tgt.z],
        offset: [cam.position.x - tgt.x, cam.position.y - tgt.y, cam.position.z - tgt.z],
        dist: cam.position.distanceTo(tgt),
      };
      setCameraReadout(readout);
    }
    // Auto-focus drift is intentionally removed. The camera loads at the fixed
    // initial framing and stays there — only the user's orbit/pan/zoom moves it.
  });

  // Set the mouse button roles once the controls instance is available.
  // LEFT = ROTATE by default, toggled to PAN by Shift (see listeners above).
  // MIDDLE and RIGHT are disabled (undefined) so only LEFT + optional Shift controls the camera.
  const handleMount = useCallback((controls: OrbitControlsImpl | null) => {
    controlsRef.current = controls;
    if (!controls) return;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = undefined;
    controls.mouseButtons.RIGHT = undefined;

    // MOBILE-ONLY camera-collision clamp. OrbitControls fires 'change' after EVERY
    // move — user gesture (orbit/pan/zoom) OR programmatic update() — so clamping
    // the camera + pivot world-Y here is the hard guarantee that no interaction can
    // push the camera under the terrain (or the pivot below board level), which is
    // what made the floor/rocks read as see-through from inside. Reads isMobileRef
    // inside the handler so it self-enables/disables on rotate/resize, and
    // early-returns on desktop → the desktop camera is NEVER touched (byte-identical).
    // Idempotent (only lowers-nothing, raises to the floor), so re-firing every
    // damped frame — or under StrictMode double-invoke — is harmless and stable:
    // the next update() recomputes the orbit offset from the already-clamped
    // camera/target, so the camera simply rests against the floor with no creep.
    // Guarded by a typeof check so the unit-test fake (no addEventListener) is safe.
    if (typeof controls.addEventListener === 'function') {
      controls.addEventListener('change', () => {
        if (!isMobileRef.current) return;
        const cam = controls.object;
        if (controls.target.y < MOBILE_MIN_TARGET_Y) controls.target.y = MOBILE_MIN_TARGET_Y;
        if (cam.position.y < MOBILE_MIN_CAM_Y) cam.position.y = MOBILE_MIN_CAM_Y;
      });
    }
  }, []);

  return (
    <OrbitControls
      ref={handleMount}
      // MOBILE-ONLY: disable OrbitControls while in free-look so drei stops calling
      // controls.update() (it guards on controls.enabled) and its own pointer
      // handlers no-op — the free-look touch controller then owns the camera. On
      // desktop this is `undefined` → three-stdlib default (true): byte-identical.
      enabled={isMobile ? cameraMode !== 'freeLook' : undefined}
      enablePan
      screenSpacePanning
      enableDamping
      dampingFactor={isMobile ? MOBILE_DAMPING_FACTOR : DESKTOP_DAMPING_FACTOR}
      minPolarAngle={0.05}
      // MOBILE tightens the low-angle + zoom-in limits so the camera can't tip
      // under the floor or dolly into the city/rocks; DESKTOP keeps the original
      // relaxed values (byte-identical). The hard world-Y floor is enforced by the
      // 'change' clamp in handleMount (mobile only).
      maxPolarAngle={isMobile ? MOBILE_MAX_POLAR_ANGLE : DESKTOP_MAX_POLAR_ANGLE}
      minDistance={isMobile ? MOBILE_MIN_DISTANCE : DESKTOP_MIN_DISTANCE}
      maxDistance={70}
      // MOBILE adaptive dpr: driven ONLY by genuine user camera gestures. The
      // 'start' event (real drag / pinch / wheel) drops to the cheap MOVING dpr;
      // the 'end' event arms the settle timer that restores the crisp dpr once the
      // gesture finishes (see mobileRender.ts). Crucially, these interaction events
      // do NOT fire for programmatic controls.update() — so the third-person
      // follow-lerp (which moves the camera via controls.update() while a token
      // walks), token walk, dice and character anim never touch dpr. Desktop passes
      // undefined → OrbitControls behaves exactly as before (byte-identical).
      onStart={isMobile ? beginCameraMotion : undefined}
      onEnd={isMobile ? endCameraMotion : undefined}
    />
  );
}
