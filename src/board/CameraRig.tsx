import { useCallback, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useGameStore, selectCurrentPlayer } from '../state/gameStore';
import { tileToWorld } from './positions';

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

  // Read active player from the store (selector keeps re-renders minimal).
  const activePlayer = useGameStore(selectCurrentPlayer);

  // Update the focus goal whenever the active player's id or position changes.
  // useEffect avoids mutating refs during render (safe under StrictMode).
  useEffect(() => {
    if (!activePlayer) return;
    const [wx, , wz] = tileToWorld(activePlayer.position);
    focusGoal.current.set(wx, 0, wz);
  }, [activePlayer?.id, activePlayer?.position]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Stop fighting the user once they've taken manual control.
    if (userTookControl.current) return;
    if (interacting.current) return;

    // Gently ease the orbit target toward the active player's tile.
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
