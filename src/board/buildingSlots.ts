/**
 * Pure (R3F-free) placement math for houses and hotels on the board. Extracted
 * from Buildings.tsx so it can be unit-tested without any React/Three, and so
 * Buildings.tsx exports ONLY its component (keeping React Fast Refresh happy).
 *
 * See Buildings.tsx's header for the full placement algorithm description.
 */

import { tileToWorld, BOARD_WORLD_SIZE } from './positions';

/** Buildings rest on the board surface (matches the tile top in the 3D scene). */
export const TILE_SURFACE_Y = 0.02;

/**
 * Actual regular-tile width in world units.
 * Derived from positions.ts: CORNER=0.134, SW = (1 - 2*CORNER) / 9,
 * so TILE_WIDTH = SW * BOARD_WORLD_SIZE ≈ 0.813.
 */
const TILE_WIDTH = ((1 - 2 * 0.134) / 9) * BOARD_WORLD_SIZE;

/** Push buildings this far inward (toward origin) from the tile center. */
const INWARD_OFFSET = TILE_WIDTH * 0.35;

/** Spread multiple houses along the inner edge: total span for 4 houses. */
const HOUSE_SPREAD = TILE_WIDTH * 0.70;

export interface BuildingSlot {
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

/**
 * Compute world positions + rotationY for `count` houses on tile `tileIndex`.
 * Returns an array of `count` slots spread along the tile's inner edge.
 */
export function houseSlots(tileIndex: number, count: number): BuildingSlot[] {
  const [cx, , cz] = tileToWorld(tileIndex);

  // Inward direction: from tile toward board center (origin).
  const len = Math.sqrt(cx * cx + cz * cz);
  // Corner tiles like GO (index 0) sit at (CE-0.5)*10, (CE-0.5)*10 — they are
  // never purchasable properties, but guard against zero-length just in case.
  const inwardX = len > 1e-9 ? -cx / len : 0;
  const inwardZ = len > 1e-9 ? -cz / len : 1;

  // Perpendicular to inward (90-degree CCW rotation in xz-plane):  (-inwardZ, inwardX)
  const perpX = -inwardZ;
  const perpZ = inwardX;

  // Base position: tile center shifted inward by INWARD_OFFSET.
  const baseX = cx + inwardX * INWARD_OFFSET;
  const baseZ = cz + inwardZ * INWARD_OFFSET;

  // Rotation so model's +Z front faces the inward direction (board center).
  const rotationY = Math.atan2(inwardX, inwardZ);

  const slots: BuildingSlot[] = [];

  if (count === 1) {
    slots.push({ x: baseX, y: TILE_SURFACE_Y, z: baseZ, rotationY });
  } else {
    // Spread evenly: step = HOUSE_SPREAD / (count - 1), centered on baseX/Z.
    const step = HOUSE_SPREAD / (count - 1);
    const halfSpan = HOUSE_SPREAD / 2;
    for (let i = 0; i < count; i++) {
      const t = -halfSpan + i * step;
      slots.push({
        x: baseX + perpX * t,
        y: TILE_SURFACE_Y,
        z: baseZ + perpZ * t,
        rotationY,
      });
    }
  }

  return slots;
}

/**
 * Compute the single world position for a hotel on tile `tileIndex`.
 * Hotels are centered (no perpendicular spread).
 */
export function hotelSlot(tileIndex: number): BuildingSlot {
  const [cx, , cz] = tileToWorld(tileIndex);
  const len = Math.sqrt(cx * cx + cz * cz);
  const inwardX = len > 1e-9 ? -cx / len : 0;
  const inwardZ = len > 1e-9 ? -cz / len : 1;
  const rotationY = Math.atan2(inwardX, inwardZ);
  return {
    x: cx + inwardX * INWARD_OFFSET,
    y: TILE_SURFACE_Y,
    z: cz + inwardZ * INWARD_OFFSET,
    rotationY,
  };
}
