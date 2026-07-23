/**
 * Buildings — renders houses and hotels on the board from server state.
 *
 * Placement algorithm
 * -------------------
 * For tile index `i`:
 *   1. `[cx, , cz] = tileToWorld(i)` — tile world center (y always 0).
 *   2. Inward direction (toward board origin) = normalize([-cx, -cz]).
 *      Corner tiles (cx==0 && cz==0 is impossible; board origin is center) are
 *      handled naturally — the resulting unit vector points toward (0,0).
 *   3. Offset the building 35 % of a tile (~0.35 * TILE_WIDTH) inward from the
 *      tile center so it sits on the color-strip area, not the center of the space.
 *   4. Houses spread perpendicular to the inward direction (along the tile's
 *      inner edge). Up to 4 houses spaced evenly within the inner-edge width.
 *   5. Hotel: single model centered at the same inward-offset point.
 *   6. rotationY = Math.atan2(inwardX, inwardZ)
 *      Model-forward axis is +Z (three.js) / +Y (Blender) — the gable faces +Z
 *      in three.js space. This atan2 formula rotates the model so its +Z front
 *      aligns with the inward direction (facing board center). No π adjustment
 *      needed because the pyramid roof is symmetric and the color scheme makes
 *      orientation unambiguous.
 *   7. y = TILE_SURFACE_Y — buildings rest on the board surface.
 *
 * Buildings are NOT tinted (tint stays default white) because they bake their
 * own multi-color COLOR_0 (green/dark-roof for house, red/dark-roof for hotel).
 *
 * This component is mounted by GameScene (Task 4). It compiles clean even before
 * mounting since it has no side-effects at the module level.
 */

import { useGameStore } from '../state/gameStore';
import { tileToWorld, BOARD_WORLD_SIZE } from './positions';
import { ModelMesh } from './ModelMesh';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOUSE_URL = '/models/buildings/house.glb';
const HOTEL_URL = '/models/buildings/hotel.glb';

/** Buildings rest on the board surface (matches the tile top in the 3D scene). */
const TILE_SURFACE_Y = 0.02;

/**
 * Fractional tile size in world units.
 * The board spans BOARD_WORLD_SIZE units across 11 cells (9 regular + 2 corners).
 * A regular tile's center-to-center spacing is BOARD_WORLD_SIZE / 11 ≈ 0.909.
 */
const TILE_WIDTH = BOARD_WORLD_SIZE / 11;

/** Push buildings this far inward (toward origin) from the tile center. */
const INWARD_OFFSET = TILE_WIDTH * 0.35;

/** Spread multiple houses along the inner edge: total span for 4 houses. */
const HOUSE_SPREAD = TILE_WIDTH * 0.70;

/** Scale applied to each model (keeps buildings proportional to tile size). */
const BUILDING_SCALE = 1.0;

// ---------------------------------------------------------------------------
// Placement helper — pure, no R3F, unit-testable
// ---------------------------------------------------------------------------

export interface BuildingSlot {
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

/**
 * Compute world positions + rotationY for `count` houses on tile `tileIndex`.
 * Returns an array of `count` slots spread along the tile's inner edge.
 *
 * Exported so it can be unit-tested without any R3F.
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

// ---------------------------------------------------------------------------
// Preload both building models so they are cached before first render.
// ---------------------------------------------------------------------------
ModelMesh.preload(HOUSE_URL);
ModelMesh.preload(HOTEL_URL);

// ---------------------------------------------------------------------------
// Buildings component
// ---------------------------------------------------------------------------

/**
 * Renders house and hotel models for all properties that have them.
 *
 * - `houses > 0` and no hotel: render `houses` house models spread along the
 *   tile's inner edge.
 * - `hasHotel`: render a single hotel model centered on the inner edge
 *   (hotel replaces houses per Monopoly rules).
 * - Mortgaged or no buildings: render nothing.
 *
 * Models carry baked COLOR_0 (green/red + dark roof), so tint stays '#ffffff'.
 * Mounted by GameScene (Task 4) inside a `<Suspense fallback={null}>`.
 */
export function Buildings(): JSX.Element {
  const properties = useGameStore((s) => s.state?.properties) ?? [];

  return (
    <group>
      {properties.flatMap((prop) => {
        if (prop.isMortgaged) return [];

        if (prop.hasHotel) {
          const slot = hotelSlot(prop.spaceIndex);
          return [
            <ModelMesh
              key={`hotel-${prop.spaceIndex}`}
              url={HOTEL_URL}
              position={[slot.x, slot.y, slot.z]}
              rotation={[0, slot.rotationY, 0]}
              scale={BUILDING_SCALE}
            />,
          ];
        }

        if (prop.houses > 0) {
          const slots = houseSlots(prop.spaceIndex, prop.houses);
          return slots.map((slot, idx) => (
            <ModelMesh
              key={`house-${prop.spaceIndex}-${idx}`}
              url={HOUSE_URL}
              position={[slot.x, slot.y, slot.z]}
              rotation={[0, slot.rotationY, 0]}
              scale={BUILDING_SCALE}
            />
          ));
        }

        return [];
      })}
    </group>
  );
}
