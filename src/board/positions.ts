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
  const p: TilePos[] = new Array(40);
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

/** Map a tile index to a world-space [x, y=0, z] on the board plane, centered at origin. */
export function tileToWorld(index: number): [number, number, number] {
  const pos = SPACE_POSITIONS[index];
  return [(pos.x - 0.5) * BOARD_WORLD_SIZE, 0, (pos.y - 0.5) * BOARD_WORLD_SIZE];
}

/**
 * Ordered list of tile indices a token WALKS through moving `from` → `to`,
 * INCLUSIVE of both endpoints and following the ring clockwise (index+1),
 * wrapping past 39 → 0 so the token rounds corners and passes GO along the
 * track — it NEVER cuts diagonally across the board.
 *
 * Result shape: `[from, from+1, …, to]` (all mod 40). This is the polyline of
 * tile centers the walk animation glides along; consecutive entries are always
 * adjacent tiles on the ring, so segment tangents give clean per-segment facing.
 *
 * - `from === to` → `[from]` (a single vertex; no movement, token stays put).
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
export function buildTilePath(from: number, to: number): number[] {
  const a = ((from % 40) + 40) % 40;
  const b = ((to % 40) + 40) % 40;
  const path: number[] = [a];
  if (a === b) return path;
  let i = a;
  do {
    i = (i + 1) % 40;
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
 */
export function thirdPersonPose(tileIndex: number): ThirdPersonPose {
  const cur = ((tileIndex % 40) + 40) % 40;
  const next = (cur + 1) % 40;

  const curPos = tileToWorldRotated(cur);
  const nextPos = tileToWorldRotated(next);

  // Direction of travel in world space (planar; y is flat on the board).
  const forward = nextPos.clone().sub(curPos);
  forward.y = 0;
  if (forward.lengthSq() < 1e-8) {
    // Degenerate (should not happen for a 40-tile ring) — face +Z as a fallback.
    forward.set(0, 0, 1);
  } else {
    forward.normalize();
  }

  // Token position at its base height.
  const tokenPos = curPos.clone();
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
