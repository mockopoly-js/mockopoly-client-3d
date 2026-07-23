import { useRef } from 'react';
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
 *   Only the target is moved — never the camera position/zoom.
 * - Suspend-on-interaction: OrbitControls 'start'/'end' events set an
 *   `interacting` flag. While true, auto-focus is skipped so the user's
 *   drag is never fought.
 */
export function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);

  // Lerp goal for the auto-focus (updated when currentPlayerId changes).
  const focusGoal = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const prevPlayerId = useRef<string | undefined>(undefined);
  const interacting = useRef(false);

  // Read active player from the store (selector keeps re-renders minimal).
  const currentPlayer = useGameStore(selectCurrentPlayer);

  // Update the focus goal whenever the active player changes.
  if (currentPlayer && currentPlayer.id !== prevPlayerId.current) {
    prevPlayerId.current = currentPlayer.id;
    const [wx, , wz] = tileToWorld(currentPlayer.position);
    focusGoal.current.set(wx, 0, wz);
  }

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (interacting.current) return;

    // Gently ease the orbit target toward the active player's tile.
    controls.target.lerp(focusGoal.current, 0.05);
    controls.update();
  });

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
      onStart={() => { interacting.current = true; }}
      onEnd={() => { interacting.current = false; }}
    />
  );
}
