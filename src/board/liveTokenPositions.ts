import * as THREE from 'three';

/**
 * ── LIVE TOKEN WORLD-POSITION BUS ─────────────────────────────────────────────
 *
 * Per-frame LIVE world-space positions of every player token, keyed by player id.
 *
 * WHY THIS EXISTS: the third-person follow camera used to aim at the DISCRETE
 * board `position` tile (game state), which only updates when the token ARRIVES
 * at its destination. So while a token WALKED, the follow target never changed
 * and the camera only snapped to the character once it stopped. PlayerTokens is
 * the component that actually animates the token mesh smoothly between tiles, so
 * the real, live character position lives there — this bus publishes it.
 *
 * PlayerTokens writes each token's ACTUAL world-space position every frame — via
 * `group.getWorldPosition(...)`, so the rotated BOARD_ROTATION parent group is
 * accounted for and the value matches the space the camera / OrbitControls live
 * in (the same space `thirdPersonPose` returns). During a walk this is the
 * smoothly-interpolated mesh position; at rest it is the resting tile + stack
 * slot. CameraRig's third-person follow reads the ACTIVE player's live position
 * from here so the camera EASES along with the walking character in real time.
 *
 * A plain module-level map (NOT a zustand slice or React state) is used
 * deliberately: these values update every frame and must NEVER trigger a React
 * re-render. Reads and writes are synchronous field access — no store, no
 * subscribers. The stored Vector3 instances are reused via `.copy`, so the write
 * path allocates nothing on the per-frame hot path.
 */
const positions = new Map<string, THREE.Vector3>();

/**
 * Publish the LIVE world position for player `id`, copying into the reused stored
 * vector (no per-frame allocation). Called by PlayerTokens once per token, per
 * frame, after that token's group position has been updated.
 */
export function setLiveTokenPosition(id: string, pos: THREE.Vector3): void {
  const existing = positions.get(id);
  if (existing) {
    existing.copy(pos);
  } else {
    positions.set(id, pos.clone());
  }
}

/**
 * Read the LIVE world position for player `id`, or `undefined` if no position has
 * been published for that player yet (e.g. on the very first frame before
 * PlayerTokens has run). Callers MUST NOT mutate the returned vector — it is the
 * shared stored instance.
 */
export function getLiveTokenPosition(id: string): THREE.Vector3 | undefined {
  return positions.get(id);
}
