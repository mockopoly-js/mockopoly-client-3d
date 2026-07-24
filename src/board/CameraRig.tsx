import { useCallback, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useGameStore, selectCurrentPlayer } from '../state/gameStore';
import { tileToWorld } from './positions';

/**
 * Per-turn board rotation tunables.
 *
 * When the turn passes to a new player, the camera azimuth eases a quarter-turn
 * so the board visibly rotates. Only the AZIMUTH (rotation about world-Y around
 * the OrbitControls target) changes — distance and pitch (polar) are preserved.
 */
const ROTATE_ON_TURN = true; // master switch for the per-turn rotation
const TURN_ROTATE_ANGLE = Math.PI / 2; // +90° = LEFT; flip the sign to reverse
const TURN_ROTATE_MS = 700; // ease duration for the quarter-turn

// Ease-out cubic: fast start, gentle settle. t in [0,1] → eased [0,1].
function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/**
 * CameraRig: free Blender-style viewport navigation + gentle first-turn auto-focus
 * + a per-turn quarter-turn board rotation.
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
 * Per-turn rotation: whenever `turn.currentPlayerId` CHANGES to a new value, we
 * kick off a TURN_ROTATE_MS eased sweep of the camera's azimuth by
 * TURN_ROTATE_ANGLE around the current target. Unlike the passive auto-focus,
 * this deliberate move runs REGARDLESS of `userTookControl`. While it animates it
 * OWNS the azimuth: it reads the camera's spherical coords relative to the target,
 * increments theta toward the goal, and rebuilds the camera position each frame,
 * preserving radius (distance) and phi (pitch). If the user grabs the camera
 * mid-sweep (`interacting`), the eased advance PAUSES (elapsed frozen) and resumes
 * on release — it is never cancelled.
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

  // ── Per-turn rotation animation state ──────────────────────────────────────
  // prevPlayerId starts undefined so the FIRST observed currentPlayerId (initial
  // render / first turn) does NOT trigger a rotation — only a real CHANGE does.
  const prevPlayerId = useRef<string | undefined>(undefined);
  const isRotating = useRef(false);
  const startTheta = useRef(0);
  const goalTheta = useRef(0);
  const elapsed = useRef(0); // ms of eased progress accumulated (pauses on drag)

  // Reusable scratch objects so the frame loop allocates nothing.
  const spherical = useRef(new THREE.Spherical());
  const offset = useRef(new THREE.Vector3());

  // Read active player from the store (selector keeps re-renders minimal).
  const activePlayer = useGameStore(selectCurrentPlayer);

  // Update the focus goal whenever the active player's id or position changes.
  // useEffect avoids mutating refs during render (safe under StrictMode).
  useEffect(() => {
    if (!activePlayer) return;
    const [wx, , wz] = tileToWorld(activePlayer.position);
    focusGoal.current.set(wx, 0, wz);
  }, [activePlayer?.id, activePlayer?.position]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect a TURN CHANGE and arm the per-turn rotation. We compare the current
  // player id against a prev-ref: the first non-undefined id just seeds the ref
  // (no rotation on initial render); any subsequent CHANGE arms an eased sweep.
  useEffect(() => {
    const id = activePlayer?.id;
    if (id === undefined) return;
    const prev = prevPlayerId.current;
    prevPlayerId.current = id;
    if (prev === undefined) return; // first observed turn → seed only, no rotate
    if (prev === id) return; // same player (re-render / position change) → ignore
    if (!ROTATE_ON_TURN) return;
    // Arm the rotation; the frame loop reads the live camera spherical at kickoff.
    isRotating.current = true;
    elapsed.current = 0;
    startTheta.current = NaN; // sentinel: capture live theta on the first frame
  }, [activePlayer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    // ── Per-turn azimuth rotation (owns the camera while it runs) ─────────────
    // Runs regardless of userTookControl — it's a deliberate, requested move.
    if (isRotating.current) {
      const camera = controls.object;
      if (camera) {
        const target = controls.target;
        // On the first frame of a sweep, capture the live spherical coords so the
        // rotation starts from wherever the camera actually is (post auto-focus /
        // post manual orbit). Preserve radius (distance) + phi (pitch); only theta
        // (azimuth) is animated.
        if (Number.isNaN(startTheta.current)) {
          offset.current.copy(camera.position).sub(target);
          spherical.current.setFromVector3(offset.current);
          startTheta.current = spherical.current.theta;
          goalTheta.current = spherical.current.theta + TURN_ROTATE_ANGLE;
        }

        // Don't fight the user: while they actively drag, PAUSE (freeze elapsed)
        // and resume on release. The sweep is never cancelled.
        if (!interacting.current) {
          // `delta` may be undefined in tests that call frame with no args — treat
          // a single call as one full step so a mocked frame still completes.
          elapsed.current += delta != null ? delta * 1000 : TURN_ROTATE_MS;
        }

        const t = TURN_ROTATE_MS > 0 ? Math.min(elapsed.current / TURN_ROTATE_MS, 1) : 1;
        const theta =
          startTheta.current + (goalTheta.current - startTheta.current) * easeOutCubic(t);

        // Rebuild the camera position from the (preserved) radius/phi + new theta.
        spherical.current.theta = theta;
        offset.current.setFromSpherical(spherical.current);
        camera.position.copy(target).add(offset.current);
        camera.lookAt(target);
        controls.update();

        if (t >= 1) {
          isRotating.current = false;
          startTheta.current = 0;
          elapsed.current = 0;
        }
      } else {
        // No camera available (shouldn't happen in the live app) — abandon the
        // sweep so we never spin forever.
        isRotating.current = false;
      }
      // While rotating we own the camera; skip the passive auto-focus this frame.
      return;
    }

    // ── Passive auto-focus (disabled after first manual interaction) ──────────
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
