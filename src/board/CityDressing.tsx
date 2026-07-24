import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { BOARD_WORLD_SIZE } from './positions';

/**
 * The real low-poly city (SimplePoly City → `public/models/city.glb`, ~5.5 MB,
 * decoder-free) that sits in the board's empty CENTER — the middle of the
 * printed 40-space ring — giving the "board-in-a-diorama" look.
 *
 * Self-normalizing: the source glb carries baked authoring offsets (its runtime
 * Box3 center is NOT at origin, and it uses EXT_mesh_gpu_instancing which three
 * loads natively). So instead of trusting authored numbers we compute a
 * `THREE.Box3` on the loaded scene at RUNTIME and:
 *   1. RECENTER horizontally so the city's x/z center sits at world origin.
 *   2. Drop its Y-min (ground) onto the board top (CITY_Y ≈ board top 0.02).
 *   3. FIT it: base scale = INNER_SQUARE / max(boxSizeX, boxSizeZ), so the city's
 *      footprint fills the board's inner empty square regardless of raw scale.
 *      CITY_SCALE is a tunable multiplier ON TOP of that auto-fit.
 *
 * The inner empty square (inside the tile ring) spans roughly world [-3, 3] on
 * a 10×10 board, so INNER_SQUARE defaults to ~6. Buildings then grow UP from the
 * board top, sitting INSIDE the ring — they must not cover the printed tiles.
 *
 * ── TUNABLE CONSTS (iterate live with these three only) ─────────────────────
 *   CITY_SCALE — multiplier on the auto-fit footprint. 1.0 = city footprint
 *                exactly fills INNER_SQUARE. <1 shrinks it inside the ring, >1
 *                grows it (risk of spilling onto the tiles).
 *   CITY_Y     — world Y the city GROUND rests on. Board top is 0.02; keep at/
 *                just above it so buildings sit on the board, not floating/sunk.
 *   CITY_ROT   — Y-rotation (radians) to aim the city's "front"/streets nicely
 *                for the default camera.
 */

/** World size of the board's inner empty square (inside the printed tile ring). */
const INNER_SQUARE = BOARD_WORLD_SIZE * 0.6; // 10 * 0.6 = 6 → empty center ≈ [-3, 3]

const CITY_SCALE = 0.9;   // fill 90% of the inner square (small margin off the tiles)
const CITY_Y = 0.02;      // rest the city ground on the board top (TOP_Y)
const CITY_ROT = 0;       // radians; nudge to aim streets toward the camera

const CITY_URL = '/models/city.glb';

export function CityDressing(): React.JSX.Element {
  const gltf = useGLTF(CITY_URL);

  // Clone the cached scene so recenter/scale never mutates drei's shared cache.
  const { object, groupScale } = useMemo(() => {
    const scene = gltf.scene.clone(true);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Recenter horizontally at origin; drop Y-min (ground) to local 0 so the
    // outer group can place the ground precisely at CITY_Y.
    scene.position.set(-center.x, -box.min.y, -center.z);

    // Auto-fit the footprint to the inner square, then apply the tunable factor.
    const footprint = Math.max(size.x, size.z) || 1;
    const fit = INNER_SQUARE / footprint;

    return { object: scene, groupScale: fit * CITY_SCALE };
  }, [gltf]);

  return (
    <group
      name="city-center"
      position={[0, CITY_Y, 0]}
      rotation={[0, CITY_ROT, 0]}
      scale={groupScale}
    >
      <primitive object={object} />
    </group>
  );
}

useGLTF.preload(CITY_URL);
