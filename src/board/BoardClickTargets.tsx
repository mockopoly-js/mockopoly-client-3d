import { useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useGameStore } from '../state/gameStore';
import { CLICK_TARGET_SPACES, clickTargetSpaceIndex, clickTargetMatrix, TILE_SIZE } from './clickTargets';

/**
 * Invisible, flat, horizontal click targets above each of the 28 purchasable
 * board spaces (property / railroad / utility) — used ONLY for picking, never
 * drawn.
 *
 * PERF: these 28 pickers used to be 28 separate <mesh> planes, i.e. 28 draw
 * calls on an otherwise bare board (the bulk of it). They are now collapsed into
 * ONE <instancedMesh> — a single draw call — while still raycasting per instance
 * so a click resolves to the exact board space it covers. Instance `i` is the
 * picker for CLICK_TARGET_SPACES[i]; a raycast hit carries that `instanceId`,
 * which maps straight back to the space via clickTargetSpaceIndex (see
 * clickTargets.ts). Behavior-identical to the old per-mesh planes: same
 * footprint, same y, same onClick → openDeedCard, same hover cursor.
 *
 * onClick (not onPointerDown) is used so that a pointer-drag (orbit) does NOT
 * trigger the deed card: R3F / @react-three/fiber only fires onClick when the
 * pointer-up lands on the same object it went down on without the camera moving
 * more than the drag threshold, matching the behavior users expect.
 *
 * The material stays transparent + opacity 0 (invisible) — raycasting is
 * geometry-based and unaffected by material opacity, so picking still works.
 * Cursor changes to 'pointer' on hover for affordance and is cleaned up on
 * component unmount.
 */
export function BoardClickTargets() {
  const openDeedCard = useGameStore((s) => s.openDeedCard);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Lay out one invisible picking-plane INSTANCE per purchasable space. The
  // layout is static, so this runs once — no per-frame cost. useLayoutEffect so
  // the instance matrices (and hence the raycast targets) are correct before the
  // first frame.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < CLICK_TARGET_SPACES.length; i++) {
      clickTargetMatrix(i, m);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, []);

  // Ensure cursor is reset if the component unmounts while hovering.
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
    };
  }, []);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, CLICK_TARGET_SPACES.length]}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        // instanceId identifies WHICH tile was hit; map it back to the board
        // space and open exactly the deed the old per-mesh planes would have.
        if (e.instanceId === undefined) return;
        e.stopPropagation();
        openDeedCard(clickTargetSpaceIndex(e.instanceId));
      }}
      onPointerOver={() => {
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      <planeGeometry args={[TILE_SIZE, TILE_SIZE]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </instancedMesh>
  );
}
