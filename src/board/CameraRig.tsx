import { useCallback, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useGameStore, selectCurrentPlayer } from '../state/gameStore';
import { tileToWorld } from './positions';

/**
 * CameraRig: tabletop-feel OrbitControls + gentle auto-focus.
 *
 * - OrbitControls configured for overhead tabletop viewing: pan disabled,
 *   polar angle clamped to keep camera above the board, zoom clamped near
 *   the default ~14-unit eye distance.
 * - Auto-focus: reads the current player's tile index from the store and
 *   eases the OrbitControls target toward that world position at ~0.05/frame.
 *   Only the target is moved — never the camera position/zoom. The focus goal
 *   updates whenever the active player's id OR position changes, so the camera
 *   follows the player to the tile they land on (not just at turn start).
 * - Suspend-on-interaction: OrbitControls 'start'/'end' events set an
 *   `interacting` flag. While true, auto-focus is skipped so the user's
 *   drag is never fought.
 */
export function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);

  // Lerp goal for the auto-focus (updated via useEffect when id or position changes).
  const focusGoal = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const interacting = useRef(false);

  // Read active player from the store (selector keeps re-renders minimal).
  const activePlayer = useGameStore(selectCurrentPlayer);

  // Update the focus goal whenever the active player's id or position changes.
  // useEffect avoids mutating refs during render (safe under StrictMode).
  useEffect(() => {
    if (!activePlayer) return;
    const [wx, , wz] = tileToWorld(activePlayer.position);
    focusGoal.current.set(wx, 0, wz);
  }, [activePlayer?.id, activePlayer?.position]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (interacting.current) return;

    // Gently ease the orbit target toward the active player's tile.
    controls.target.lerp(focusGoal.current, 0.05);
    controls.update();
  });

  const handleStart = useCallback(() => { interacting.current = true; }, []);
  const handleEnd = useCallback(() => { interacting.current = false; }, []);

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minPolarAngle={0.2}
      maxPolarAngle={Math.PI / 2.4}
      minDistance={7}
      maxDistance={20}
      onStart={handleStart}
      onEnd={handleEnd}
    />
  );
}
