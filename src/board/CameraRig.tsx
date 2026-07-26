import { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useGameStore, selectCurrentPlayer, selectMyPlayer } from '../state/gameStore';
import type { CameraReadout } from '../state/gameStore';
import { thirdPersonPose } from './positions';
import { INITIAL_CAM_TARGET, INITIAL_CAM_OFFSET, MOBILE_INITIAL_CAM_OFFSET } from './cameraConstants';
import { useIsMobile } from '../ui/useIsMobile';
import { bumpMotion } from './mobileRender';

// Frame-rate-aware smoothing rate for the follow lerp. Higher = snappier.
// alpha = 1 - exp(-RATE * delta) → ease-out, no snapping, stable at any FPS.
const FOLLOW_LERP_RATE = 6;

// OrbitControls damping factor: how fast the inertial drift after a
// release decays (higher = faster stop). Desktop keeps the original feel;
// mobile uses a much faster decay so the drift tail (which keeps calling
// bumpMotion via onChange) clears in ~150-250ms instead of ~1s, letting the
// short MOBILE_SETTLE_MS debounce (see GameScene.tsx) land right as the
// camera actually stops instead of firing mid-drift.
const DESKTOP_DAMPING_FACTOR = 0.08;
const MOBILE_DAMPING_FACTOR = 0.25;

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

  // Reusable scratch vectors so the follow lerp allocates nothing per frame.
  const scratchCamPos = useRef(new THREE.Vector3());
  const scratchTarget = useRef(new THREE.Vector3());

  // Initial snap: on first mount, snap the OrbitControls target to the fixed
  // INITIAL_CAM_TARGET and place the camera at target + INITIAL_CAM_OFFSET.
  // This fires each render until both controls and state are ready, then locks.
  // No dependency array — intentional: re-checks cheaply until the snap fires.
  useEffect(() => {
    if (initialSnapDone.current) return;
    if (!activePlayer) return;          // wait for store hydration
    const controls = controlsRef.current;
    if (!controls) return;             // wait for OrbitControls mount

    const target = new THREE.Vector3(...INITIAL_CAM_TARGET);
    controls.target.copy(target);

    // Same aim/angle on both; mobile just dollies closer (MOBILE_CAM_DIST).
    const offset = isMobileRef.current ? MOBILE_INITIAL_CAM_OFFSET : INITIAL_CAM_OFFSET;
    camera.position.set(
      target.x + offset[0],
      target.y + offset[1],
      target.z + offset[2],
    );
    controls.update();

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
      // Restore LEFT respecting current physical Shift state (Fix 1).
      controls.mouseButtons.LEFT = shiftHeldRef.current
        ? THREE.MOUSE.PAN
        : THREE.MOUSE.ROTATE;
      // Restore exact original clamps so free scroll-zoom + orbit are unchanged.
      const orig = origClampsRef.current;
      controls.minDistance = orig.minDistance;
      controls.maxDistance = orig.maxDistance;
      controls.maxPolarAngle = orig.maxPolarAngle;
    }
  }, [cameraMode]);

  useFrame((_state, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    // ── Third-person follow (only when the mode is on) ───────────────────────
    // When 'free' we do NO work here and never touch the camera/target, so the
    // user's manual orbit/pan/zoom is never overridden. When 'thirdPerson' we
    // ease the camera + target toward the over-the-shoulder pose behind the
    // active player's token every frame. The pose is world-space (already
    // BOARD_ROTATION-applied via tileToWorldRotated), matching the camera space.
    if (cameraModeRef.current === 'thirdPerson') {
      const tile = followTileRef.current;
      if (tile != null) {
        const pose = thirdPersonPose(tile);
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
  }, []);

  return (
    <OrbitControls
      ref={handleMount}
      enablePan
      screenSpacePanning
      enableDamping
      dampingFactor={isMobile ? MOBILE_DAMPING_FACTOR : DESKTOP_DAMPING_FACTOR}
      minPolarAngle={0.05}
      maxPolarAngle={1.55}
      minDistance={2.5}
      maxDistance={70}
      // MOBILE adaptive dpr: fires on EVERY camera change — orbit, zoom, pan, the
      // damping tail after release, AND the third-person follow lerp (which moves
      // the camera via controls.update()). Drops to the cheap MOVING dpr; when the
      // camera stops changing the settle timer restores the crisp dpr (see
      // mobileRender.ts). This is the ONLY per-frame dpr trigger — token walk /
      // dice / character anim never touch dpr. Desktop passes undefined →
      // OrbitControls behaves exactly as before (byte-identical).
      onChange={isMobile ? bumpMotion : undefined}
    />
  );
}
