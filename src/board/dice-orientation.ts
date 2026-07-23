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

// ---- Closest-yaw helper (also used by Dice3D for the kinematic snap) ---------
// Scratch quaternions reused across calls (no per-call allocation).
const _tmpBase = new THREE.Quaternion();
const _tmpYaw = new THREE.Quaternion();
const _tmpCand = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const YAW_STEPS = 4; // 0°, 90°, 180°, 270° about world-Y

/**
 * Returns the quaternion that shows `value`'s face up AND has the yaw (rotation
 * about world-Y) closest to the die's current orientation `current`. It does a
 * 4-step 90° yaw search (the four cube symmetries that keep the same face up) and
 * picks whichever candidate maximises |dot(candidate, current)|. The face shown is
 * ALWAYS `value` — only yaw varies, making the kinematic correction look like a
 * small settle rather than a jarring snap.
 */
export function resolveQuaternionNear(
  value: number,
  current: THREE.Quaternion,
): THREE.Quaternion {
  _tmpBase.copy(resolveQuaternion(value));
  let best = new THREE.Quaternion().copy(_tmpBase);
  let bestDot = -Infinity;
  for (let k = 0; k < YAW_STEPS; k++) {
    const angle = (k * Math.PI) / 2;
    _tmpYaw.setFromAxisAngle(_yAxis, angle);
    // Yaw is applied in WORLD space (pre-multiply): keeps `value` up, spins die.
    _tmpCand.copy(_tmpYaw).multiply(_tmpBase);
    // Quaternion "distance" is symmetric under q/-q; use abs(dot).
    const dot = Math.abs(_tmpCand.dot(current));
    if (dot > bestDot) {
      bestDot = dot;
      best = new THREE.Quaternion().copy(_tmpCand);
    }
  }
  return best;
}
