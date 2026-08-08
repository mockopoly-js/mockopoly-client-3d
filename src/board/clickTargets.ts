import * as THREE from 'three';
import { PURCHASABLE_SPACES } from '../constants/board';
import { tileToWorld } from './positions';

/**
 * Pure geometry/mapping logic for the board click targets, split out from the
 * R3F component (BoardClickTargets.tsx) so it can be unit-tested — including a
 * real raycast — without a Three renderer, and kept Fast-Refresh clean.
 *
 * The 28 purchasable-space pickers are ONE InstancedMesh (one draw call). This
 * module owns the instanceId ↔ board-space contract: instance `i` is the picker
 * for CLICK_TARGET_SPACES[i], sized/positioned exactly like the old per-space
 * planes, and a raycast hit's `instanceId` maps back via clickTargetSpaceIndex.
 */

export const PLANE_Y = 0.03;   // just above board top face (0.02)
export const TILE_SIZE = 0.95; // square footprint ≈ regular tile width

/**
 * Ordered board-space index for each click-target INSTANCE. Instance `i` of the
 * InstancedMesh is the picking plane for `CLICK_TARGET_SPACES[i]`. Frozen to the
 * purchasable spaces (28) in board order — the single source of truth for the
 * instanceId ↔ board-space mapping.
 */
export const CLICK_TARGET_SPACES: readonly number[] = PURCHASABLE_SPACES;

/**
 * Map an InstancedMesh raycast hit's `instanceId` back to the board-space index
 * it represents. This is the behavior-critical contract that replaces the old
 * one-mesh-per-space closure (each mesh captured its own spaceIndex): the single
 * instanced mesh instead resolves the clicked space from the hit instance id.
 */
export function clickTargetSpaceIndex(instanceId: number): number {
  return CLICK_TARGET_SPACES[instanceId];
}

// Flat, unit-scale transform for a horizontal picking plane: rotated -90° about
// X so the plane lies parallel to the board top (matching the old planes'
// rotation={[-Math.PI/2, 0, 0]}). Module-level scratch reused by
// clickTargetMatrix — this only runs once at mount + in tests, never per frame.
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _flat = new THREE.Euler(-Math.PI / 2, 0, 0);

/**
 * Compose the local transform for click-target instance `i` into `out`:
 * positioned over its board space at y=PLANE_Y and laid flat (−90° about X) —
 * identical to the per-mesh planes' position/rotation. Shared by the component
 * (fills instanceMatrix) and the raycast unit test so both agree exactly.
 */
export function clickTargetMatrix(i: number, out: THREE.Matrix4): THREE.Matrix4 {
  const [wx, , wz] = tileToWorld(CLICK_TARGET_SPACES[i]);
  _pos.set(wx, PLANE_Y, wz);
  _quat.setFromEuler(_flat);
  return out.compose(_pos, _quat, _scale);
}
