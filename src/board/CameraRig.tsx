import { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useGameStore, selectCurrentPlayer } from '../state/gameStore';
import { tileToWorldRotated, BOARD_ROTATION as _BOARD_ROTATION } from './positions';

// Re-export so callers can assert the shared constant is wired in.
export { BOARD_ROTATION } from './positions';

// ── Tunable initial-framing constants ─────────────────────────────────────────
// Camera is positioned at boardCenter + INITIAL_CAM_OFFSET and aims at the
// board center. This puts the GO corner (world +X, -Z after BOARD_ROTATION)
// at the front-bottom-RIGHT of screen while the whole board fills the frame.
//
// INITIAL_CAM_OFFSET — world-space offset from board origin (0,0,0):
//   X: right (positive = camera moves screen-right → GO shifts right in frame)
//   Y: height (larger = steeper downward tilt)
//   Z: toward-camera (+Z is screen-bottom; larger = more "in front" of board)
// A value of [-8, 12, -8] gives ~47° elevation, rotated 180° so GO appears
// front-bottom-RIGHT of screen with Free Parking receding top-LEFT.
//
// INITIAL_CAM_TARGET — orbit target on first mount. [0,0,0] = board center so
// the whole board fills the frame. Auto-focus lerps this toward the active
// player each frame until the user manually interacts.
export const INITIAL_CAM_OFFSET: [number, number, number] = [-8, 12, 8];
export const INITIAL_CAM_TARGET: [number, number, number] = [0, 0, 0];

/**
 * CameraRig: free Blender-style viewport navigation + gentle first-turn auto-focus.
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
 * Auto-focus: before the user takes manual control, the current player's tile is
 * gently eased into the OrbitControls target (~0.05/frame), so the camera follows
 * the active player at turn start. As soon as the user manually interacts with the
 * camera (OrbitControls 'start' — any orbit/pan/zoom), auto-focus is disabled for
 * the rest of the session so the free camera is never yanked back.
 *
 * Focus targets are rotation-aware: tokens live inside a group rotated by
 * BOARD_ROTATION about the world-Y axis. CameraRig is OUTSIDE that group, so raw
 * tileToWorld() positions are pre-rotation and aim at empty space. We call
 * tileToWorldRotated() to apply Ry(BOARD_ROTATION) and get the token's actual
 * rendered world position.
 *
 * Initial snap: on first mount (when the game screen loads) the OrbitControls
 * target and camera are immediately aimed at the active player's tile (typically
 * GO at game start) so the board is correctly framed from frame 1 — no first-turn
 * change is needed to trigger the focus.
 */
export function CameraRig() {
  // Mutable ref (not passed directly as JSX `ref=`) so `handleMount` can assign
  // `.current`. The `| null` initializer widens this to a MutableRefObject.
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  // Lerp goal for the auto-focus (updated via useEffect when id or position changes).
  const focusGoal = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const interacting = useRef(false);
  // Once the user manually moves the camera, auto-focus is permanently off.
  const userTookControl = useRef(false);
  // Track whether we've snapped to the initial player tile on first mount.
  const initialSnapDone = useRef(false);

  // Read active player from the store (selector keeps re-renders minimal).
  const activePlayer = useGameStore(selectCurrentPlayer);

  // Access the R3F camera for the initial snap (sets camera position too).
  const camera = useThree((s) => s.camera);

  // Update the focus goal whenever the active player's id or position changes.
  // Uses tileToWorldRotated so the target matches the token's ACTUAL world position
  // (tokens are inside the BOARD_ROTATION group; CameraRig is not).
  useEffect(() => {
    if (!activePlayer) return;
    const rotated = tileToWorldRotated(activePlayer.position);
    focusGoal.current.set(rotated.x, 0, rotated.z);
  }, [activePlayer?.id, activePlayer?.position]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial snap: on first mount, snap the OrbitControls target to the board
  // center (INITIAL_CAM_TARGET) and position the camera at board-center +
  // INITIAL_CAM_OFFSET. Targeting the board center frames the whole board in
  // view — GO corner appears front-bottom-right, Free Parking recedes top-left.
  // Auto-focus then gently pulls the target toward the active player each frame.
  // This is driven by useEffect (not useFrame) so it fires on mount / first render.
  useEffect(() => {
    if (initialSnapDone.current) return;
    if (!activePlayer) return;
    const controls = controlsRef.current;
    if (!controls) return;

    // Orbit target: board center gives the best whole-board framing.
    const target = new THREE.Vector3(...INITIAL_CAM_TARGET);
    controls.target.copy(target);

    // Camera: board center + isometric offset (GO ends up front-bottom-right).
    camera.position.set(
      target.x + INITIAL_CAM_OFFSET[0],
      target.y + INITIAL_CAM_OFFSET[1],
      target.z + INITIAL_CAM_OFFSET[2],
    );
    controls.update();

    // Prime focusGoal at the player's tile so auto-focus lerps from the correct goal.
    const rotated = tileToWorldRotated(activePlayer.position);
    focusGoal.current.set(rotated.x, 0, rotated.z);

    initialSnapDone.current = true;
  });
  // Intentionally no dependency array: we want this to keep re-checking each
  // render until both controls and activePlayer are ready (they may arrive after
  // the first render due to Suspense / store hydration). Once initialSnapDone is
  // set it exits immediately, so subsequent re-renders are a cheap no-op.

  // SHIFT → pan: swap the LEFT mouse button action while Shift is held. Right
  // stays PAN and middle stays DOLLY (set once when the controls mount below).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return;
      const controls = controlsRef.current;
      if (controls) controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return;
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

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    // ── Passive auto-focus (disabled after first manual interaction) ──────────
    if (userTookControl.current) return;
    if (interacting.current) return;

    // Gently ease the orbit target toward the active player's tile.
    // focusGoal is already in rotation-corrected world space (set by the
    // useEffect above via tileToWorldRotated), so this aims at the token's
    // actual rendered position, not the pre-rotation tile coordinate.
    controls.target.lerp(focusGoal.current, 0.05);
    controls.update();
  });

  // Any manual interaction (orbit / pan / zoom) permanently disables auto-focus.
  const handleStart = useCallback(() => {
    interacting.current = true;
    userTookControl.current = true;
  }, []);
  const handleEnd = useCallback(() => { interacting.current = false; }, []);

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
      onStart={handleStart}
      onEnd={handleEnd}
    />
  );
}
