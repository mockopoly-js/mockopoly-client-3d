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

/** Map a tile index to a world-space [x, y=0, z] on the board plane, centered at origin. */
export function tileToWorld(index: number): [number, number, number] {
  const pos = SPACE_POSITIONS[index];
  return [(pos.x - 0.5) * BOARD_WORLD_SIZE, 0, (pos.y - 0.5) * BOARD_WORLD_SIZE];
}
