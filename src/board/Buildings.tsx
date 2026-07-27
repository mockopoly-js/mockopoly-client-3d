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

import React from 'react';
import { useGameStore } from '../state/gameStore';
import { ModelMesh } from './ModelMesh';
import { houseSlots, hotelSlot } from './buildingSlots';
import { useIsMobile } from '../ui/useIsMobile';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOUSE_URL = '/models/buildings/house.glb';
const HOTEL_URL = '/models/buildings/hotel.glb';

/** Scale applied to each model (keeps buildings proportional to tile size). */
const BUILDING_SCALE = 1.0;

// Placement math (houseSlots / hotelSlot) lives in ./buildingSlots so it stays
// pure/unit-testable and this file exports only the component.

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
export function Buildings(): React.JSX.Element {
  const properties = useGameStore((s) => s.state?.properties) ?? [];
  // MOBILE: buildings receive the static baked golden-hour shadow (see
  // MobileCrispBoardPipeline). Desktop passes false → byte-identical.
  const isMobile = useIsMobile();

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
              receiveShadow={isMobile}
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
              receiveShadow={isMobile}
            />
          ));
        }

        return [];
      })}
    </group>
  );
}
