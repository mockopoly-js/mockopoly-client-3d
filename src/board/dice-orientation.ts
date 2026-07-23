import * as THREE from 'three';

/**
 * Local-space face normals for a standard right-handed die, chosen so that
 * opposite faces sum to 7. This layout is the single source of truth: the pip
 * meshes in `Dice3D` are placed along these exact normals, so orienting a face
 * toward +Y (the overhead-ish camera) is guaranteed to display that value.
 *
 * Layout (unit, axis-aligned, distinct):
 *   1 → +Y   (top)        6 → -Y   (bottom)   (1 + 6 = 7)
 *   2 → +Z   (front)      5 → -Z   (back)     (2 + 5 = 7)
 *   3 → +X   (right)      4 → -X   (left)     (3 + 4 = 7)
 */
export const FACE_NORMAL: Record<number, [number, number, number]> = {
  1: [0, 1, 0],
  6: [0, -1, 0],
  2: [0, 0, 1],
  5: [0, 0, -1],
  3: [1, 0, 0],
  4: [-1, 0, 0],
};

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Returns a quaternion `q` such that applying it to `FACE_NORMAL[value]` yields
 * (0, 1, 0) — i.e. the given face points straight up toward the camera. The
 * tumble in `Dice3D` is purely cosmetic; slerping the die to this quaternion is
 * what deterministically shows the server-decided value.
 */
export function resolveQuaternion(value: number): THREE.Quaternion {
  const n = FACE_NORMAL[value];
  const from = new THREE.Vector3(n[0], n[1], n[2]);
  return new THREE.Quaternion().setFromUnitVectors(from, UP);
}
