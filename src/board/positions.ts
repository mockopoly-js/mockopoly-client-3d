import * as THREE from 'three';

/**
 * Normalized (0–1) center of each of the 40 board tiles, ported verbatim from
 * the 2D client's Board.ts ring math. Renderer-invariant.
 * Ring is clockwise from GO at bottom-right (index 0).
 */
const CORNER = 0.134;
const CC = CORNER / 2;            // near-corner center  ≈0.067
const CE = 1 - CORNER / 2;        // far-corner center   ≈0.933
const SW = (1 - 2 * CORNER) / 9;  // regular tile width
const S: number[] = [];
for (let i = 0; i < 9; i++) S.push(CORNER + SW / 2 + i * SW);

export interface TilePos { x: number; y: number }

function buildPositions(): TilePos[] {
  const p: TilePos[] = new Array<TilePos>(40);
  p[0] = { x: CE, y: CE };                                 // GO
  for (let i = 1; i <= 9; i++) p[i] = { x: S[9 - i], y: CE };   // bottom row
  p[10] = { x: CC, y: CE };                                // Jail
  for (let i = 11; i <= 19; i++) p[i] = { x: CC, y: S[19 - i] }; // left column
  p[20] = { x: CC, y: CC };                                // Free Parking
  for (let i = 21; i <= 29; i++) p[i] = { x: S[i - 21], y: CC }; // top row
  p[30] = { x: CE, y: CC };                                // Go To Jail
  for (let i = 31; i <= 39; i++) p[i] = { x: CE, y: S[i - 31] }; // right column
  return p;
}

export const SPACE_POSITIONS: TilePos[] = buildPositions();

/** World-plane size of the board (three.js units). */
export const BOARD_WORLD_SIZE = 10;

/**
 * BOARD_ROTATION — Y-axis rotation (radians) applied to all board content as a group,
 * physically rotating GO from bottom-left to bottom-right.
 *
 * Reasoning: camera sits at [0, 8.5, 12], looking toward origin along -Z.
 * +X is screen-right, +Z is screen-toward-camera (bottom of screen).
 * GO starts at the bottom-left corner of the printed board texture.
 * A -90° (clockwise from above) rotation about +Y swings bottom-left → bottom-right.
 *
 * Single source of truth shared by GameScene (the board group) and CameraRig
 * (which must apply the same rotation when computing world-space focus targets).
 */
export const BOARD_ROTATION = -Math.PI / 2;

/**
 * BOARD_LAYER — dedicated three.js render LAYER for the board slab (edge box +
 * artwork plane), used by the MOBILE crisp-board pipeline ONLY.
 *
 * On mobile, MobileCrispBoardPipeline renders the board in its own pass at NATIVE
 * device-pixel-ratio by pointing the camera at this layer, and renders the
 * expensive scene (forest / city / tokens / sky) at dpr 2 with the camera on the
 * default layer 0 — which EXCLUDES the board (so the board is drawn exactly once,
 * native). The two linear-HDR passes are then depth-composited and graded once.
 *
 * LIGHTING PARITY: three gates lights by layer too (a light is only collected if
 * `light.layers.test(camera.layers)`), so the pipeline additively enables this
 * layer on every scene light. The board therefore inherits the SAME lights and
 * the SAME scene.environment (HDRI IBL) as the main pass and is lit identically.
 *
 * Desktop never touches this: the board stays on the default layer 0 and renders
 * in the normal single pass, so this constant is inert there.
 */
export const BOARD_LAYER = 1;

/** Map a tile index to a world-space [x, y=0, z] on the board plane, centered at origin. */
export function tileToWorld(index: number): [number, number, number] {
  const pos = SPACE_POSITIONS[index];
  return [(pos.x - 0.5) * BOARD_WORLD_SIZE, 0, (pos.y - 0.5) * BOARD_WORLD_SIZE];
}

/** Mutable planar (x, z) pair — the board plane is at y=0 so y is never stored. */
export interface WorldXZ { x: number; z: number }

/**
 * Zero-allocation variant of {@link tileToWorld}: writes the tile's world (x, z)
 * into the provided `out` and returns it. Identical math to tileToWorld (y is
 * always 0 on the board plane, so it is omitted). Use in hot per-frame paths
 * (e.g. the PlayerTokens idle reconcile) to avoid the fresh tuple tileToWorld
 * allocates on every call.
 */
export function tileToWorldXZInto(index: number, out: WorldXZ): WorldXZ {
  const pos = SPACE_POSITIONS[index];
  out.x = (pos.x - 0.5) * BOARD_WORLD_SIZE;
  out.z = (pos.y - 0.5) * BOARD_WORLD_SIZE;
  return out;
}

/**
 * Ordered list of tile indices a token WALKS through moving `from` → `to`,
 * INCLUSIVE of both endpoints and following the ring, wrapping around 39↔0 so
 * the token rounds corners and passes GO along the track — it NEVER cuts
 * diagonally across the board.
 *
 * Direction:
 * - `backward === false` (default): clockwise (index+1), shape
 *   `[from, from+1, …, to]` — the normal direction of travel for rolls,
 *   "advance to" cards, and forward moves that wrap past GO. Byte-for-byte
 *   the original behavior.
 * - `backward === true`: counter-clockwise (index-1), shape
 *   `[from, from-1, …, to]` — for "Go back N spaces" style moves where the
 *   server DECREMENTED the position. Wraps 0 → 39.
 *
 * All indices are mod 40. Consecutive entries are always adjacent tiles on the
 * ring, so segment tangents give clean per-segment facing in either direction.
 *
 * - `from === to` → `[from]` (a single vertex; no movement, token stays put),
 *   regardless of `backward`.
 * - A full lap (`from === to` is treated as no-op, NOT a 40-tile loop) — the
 *   server sends distinct from/to for real moves, so a same-tile event means
 *   "already there". Callers that want a full lap must pass distinct indices.
 *
 * Differs from `hopPath` (which returns from+1..to, EXCLUSIVE of `from`): this
 * helper includes the start vertex so the caller can build the walk polyline
 * directly without prepending the origin.
 *
 * Exported + pure so it can be unit-tested independently of Three.js.
 */
export function buildTilePath(from: number, to: number, backward = false): number[] {
  const a = ((from % 40) + 40) % 40;
  const b = ((to % 40) + 40) % 40;
  const path: number[] = [a];
  if (a === b) return path;
  const step = backward ? -1 : 1;
  let i = a;
  do {
    i = ((i + step) % 40 + 40) % 40;
    path.push(i);
  } while (i !== b);
  return path;
}

/**
 * Like tileToWorld but applies BOARD_ROTATION about the world-Y axis, so the
 * returned Vector3 matches the token's ACTUAL rendered world position.
 *
 * Tokens are children of the rotated board group; callers such as CameraRig are
 * NOT inside that group — they must rotate the raw tileToWorld position by the
 * same angle to aim at the correct world location.
 */
export function tileToWorldRotated(index: number): THREE.Vector3 {
  const [x, y, z] = tileToWorld(index);
  return new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), BOARD_ROTATION);
}

// ── Third-person (over-the-shoulder) framing constants ────────────────────────
// Tuned to the reference screenshot: camera sits behind the token, slightly
// above, aimed at the token's upper body. Easy to tune — change here only.
//
// THIRD_PERSON_DIST   — how far BEHIND the token the camera sits (world units).
// THIRD_PERSON_HEIGHT — how far ABOVE the token base the camera floats.
// THIRD_PERSON_TARGET_Y — look-at height above the token base (upper body).
export const THIRD_PERSON_DIST = 3.4;
export const THIRD_PERSON_HEIGHT = 1.5;
export const THIRD_PERSON_TARGET_Y = 0.8;

// Token base Y in world space (mirrors PlayerTokens BASE_Y — the group sits here
// at rest, so the visible feet rest on the tile top at y≈0). Kept local so this
// pure helper has no dependency on the token component.
const TOKEN_BASE_Y = 0.15;

export interface ThirdPersonPose {
  /** World-space camera position, behind + above the token. */
  cameraPos: THREE.Vector3;
  /** World-space look-at point, at the token's upper body. */
  target: THREE.Vector3;
}

/**
 * Ring "direction of travel" for `tileIndex`: the normalized, planar, world-space
 * vector from the current tile to the NEXT tile in the ring. World-space because
 * it comes from `tileToWorldRotated` (BOARD_ROTATION already applied), matching
 * the camera's space. Falls back to +Z on the (impossible for a 40-tile ring)
 * degenerate case.
 */
function ringForward(tileIndex: number): THREE.Vector3 {
  const cur = ((tileIndex % 40) + 40) % 40;
  const next = (cur + 1) % 40;
  const forward = tileToWorldRotated(next).sub(tileToWorldRotated(cur));
  forward.y = 0;
  if (forward.lengthSq() < 1e-8) {
    forward.set(0, 0, 1);
  } else {
    forward.normalize();
  }
  return forward;
}

/**
 * Compute the over-the-shoulder camera pose for a token at an EXPLICIT world
 * position `tokenWorldPos`, with the "behind" direction taken from the ring
 * (tile → next) via `tileIndex`.
 *
 * This is the LIVE-position variant used by the third-person follow cam: the
 * token LOCATION comes from the actual animated mesh position (so the camera
 * eases along with the walking character every frame), while the behind-direction
 * still tracks the discrete ring tile the token is moving along.
 *
 * `tokenWorldPos` MUST be the token's ACTUAL world-space position (BOARD_ROTATION
 * applied — i.e. `group.getWorldPosition(...)`), so it lives in the same world
 * space the camera / OrbitControls do and the returned pose must NOT be rotated
 * again by the caller. `tokenWorldPos` is treated as read-only (it is cloned).
 */
export function thirdPersonPoseAt(
  tokenWorldPos: THREE.Vector3,
  tileIndex: number,
): ThirdPersonPose {
  const forward = ringForward(tileIndex);

  // Token position at its base height (do NOT mutate the caller's vector).
  const tokenPos = tokenWorldPos.clone();
  tokenPos.y = TOKEN_BASE_Y;

  // Camera sits BEHIND the token (−forward) and ABOVE it.
  const cameraPos = tokenPos
    .clone()
    .addScaledVector(forward, -THIRD_PERSON_DIST);
  cameraPos.y = TOKEN_BASE_Y + THIRD_PERSON_HEIGHT;

  // Look at the token's upper body.
  const target = tokenPos.clone();
  target.y = TOKEN_BASE_Y + THIRD_PERSON_TARGET_Y;

  return { cameraPos, target };
}

/**
 * Compute the over-the-shoulder camera pose for a token sitting on `tileIndex`.
 *
 * The pose is derived PURELY from tile indices — no dependency on any token
 * facing rotation (the token has none at rest). The forward direction is the
 * normalized world-space vector from the current tile to the NEXT tile in the
 * ring, i.e. the token's direction of travel.
 *
 * CRITICAL: every position here comes from `tileToWorldRotated`, which already
 * applies BOARD_ROTATION and therefore returns the token's ACTUAL visual world
 * position. The returned pose is in that same world space — the space the camera
 * and OrbitControls live in — so it must NOT be rotated again by the caller.
 *
 * This is the DISCRETE-tile pose (used as the follow-cam fallback before a live
 * token position has been published, and everywhere else the tile is the source
 * of truth); `thirdPersonPoseAt` is the live-position variant. Delegating keeps
 * the two byte-for-byte consistent.
 */
export function thirdPersonPose(tileIndex: number): ThirdPersonPose {
  const cur = ((tileIndex % 40) + 40) % 40;
  return thirdPersonPoseAt(tileToWorldRotated(cur), tileIndex);
}
