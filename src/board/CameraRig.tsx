import { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useGameStore, selectCurrentPlayer, selectMyPlayer } from '../state/gameStore';
import type { CameraReadout } from '../state/gameStore';
import { thirdPersonPose } from './positions';

// Re-export so callers can assert the shared constant is wired in.
export { BOARD_ROTATION } from './positions';

// Frame-rate-aware smoothing rate for the follow lerp. Higher = snappier.
// alpha = 1 - exp(-RATE * delta) → ease-out, no snapping, stable at any FPS.
const FOLLOW_LERP_RATE = 6;

// ── Tunable initial-framing constants ─────────────────────────────────────────
// These values were dialed in live via the debug overlay.
//
// INITIAL_CAM_TARGET — fixed orbit target. The camera always loads aimed here
// and stays here unless the user manually pans. NOT tied to any player tile.
//
// INITIAL_CAM_OFFSET — world-space offset from the target. Camera position =
// INITIAL_CAM_TARGET + INITIAL_CAM_OFFSET → [-11.04, 7.64, 0.91]; distance ~10.12.
export const INITIAL_CAM_TARGET: [number, number, number] = [-3.77, 0.61, 0.67];
export const INITIAL_CAM_OFFSET: [number, number, number] = [-7.27, 7.04, 0.24];

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

  const setCameraReadout = useGameStore((s) => s.setCameraReadout);
  // Throttle accumulator: only push readout ~every 0.12s (~8x/sec, not every frame).
  const readoutAccum = useRef(0);

  // Access the R3F camera for the initial snap (sets camera position too).
  const camera = useThree((s) => s.camera);

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

    camera.position.set(
      target.x + INITIAL_CAM_OFFSET[0],
      target.y + INITIAL_CAM_OFFSET[1],
      target.z + INITIAL_CAM_OFFSET[2],
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
      // While the camera is locked in third-person follow, Shift-pan is inert.
      if (cameraModeRef.current === 'thirdPerson') return;
      const controls = controlsRef.current;
      if (controls) controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return;
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
  // restore LEFT=ROTATE. The mode button (a React onClick) is unaffected. The
  // camera keeps whatever position the follow left it in — free orbit resumes
  // from there rather than snapping back to the fixed initial view.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.mouseButtons.LEFT =
      cameraMode === 'thirdPerson' ? undefined : THREE.MOUSE.ROTATE;
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
      dampingFactor={0.08}
      minPolarAngle={0.05}
      maxPolarAngle={1.55}
      minDistance={2.5}
      maxDistance={70}
    />
  );
}
