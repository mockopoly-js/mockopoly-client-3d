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
 * The source city is a dense, near-symmetric filled RECTANGLE (raw footprint
 * ≈ 300 × 260 world units, X longer than Z — NOT square) with NO stray/detached
 * geometry: a vertex-density histogram stays a solid 300×260 block down to the
 * 5%-density level, and the vertex-mass centroid (123.5, -91.3) sits within ~4
 * units of the bbox center (120, -100). So the runtime Box3 center IS a
 * trustworthy footprint center and the plain recenter is correct.
 *
 * The previous off-center/overlap symptom was NOT a bbox skew — it was the old
 * CITY_SCALE=1.32 making the LONG (X) axis half-extent 3.96 spill ~0.30 over the
 * ±3.66 tile edge while the SHORT (Z) axis (half 3.43) left a gap: an oblique
 * camera reads that long-axis overhang + short-axis gap as a diagonal "overlap
 * one corner / cream gap the opposite corner." Fitting the LONG axis just inside
 * the tile edge fixes both at once.
 *
 * ── TUNABLE CONSTS (iterate live with these) ────────────────────────────────
 *   CITY_SCALE — multiplier on the auto-fit footprint. 1.0 = city LONG axis
 *                exactly fills INNER_SQUARE. Kept below the tile-overlap
 *                threshold so no geometry crosses onto the printed tiles.
 *   CITY_PAN_X — world-X fine-tune nudge (post-scale). 0 = bbox-centered.
 *   CITY_PAN_Z — world-Z fine-tune nudge (post-scale). 0 = bbox-centered.
 *   CITY_Y     — world Y the city GROUND rests on. Board top is 0.02; keep at/
 *                just above it so buildings sit on the board, not floating/sunk.
 *   CITY_ROT   — Y-rotation (radians) to aim the city's "front"/streets nicely
 *                for the default camera.
 */

/** World size of the board's inner empty square (inside the printed tile ring). */
const INNER_SQUARE = BOARD_WORLD_SIZE * 0.6; // 10 * 0.6 = 6 → empty center ≈ [-3, 3]

// The clear inner square (inside the tile ring) is CORNER=0.134 deep on each
// side → its edge sits at world ±(0.5-0.134)*10 = ±3.66. Non-uniform scale on X
// and Z fills both axes to the target half-extent (~3.45), while Y scale is tied
// to X to avoid vertical distortion. City footprint (model ~300×260) is recentered
// at origin, then each axis is scaled independently to fill the inner square equally.
// PANs stay 0 so the bbox stays perfectly centered (|centerX|,|centerZ| < 0.1).
const CITY_FILL_HALF = 3.45;  // target half-extent on X and Z axes (safely inside ±3.66 tile edge)
const CITY_PAN_X = 0;         // world-X fine-tune (post-scale); 0 = bbox-centered on origin
const CITY_PAN_Z = 0;         // world-Z fine-tune (post-scale); 0 = bbox-centered on origin
const CITY_Y = 0.02;          // rest the city ground on the board top (TOP_Y)
const CITY_ROT = 0;           // radians; nudge to aim streets toward the camera

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
        m.frustumCulled = false;

        // All 69 city materials are authored with alphaMode BLEND (even though
        // their baseColor alpha is 1.0). BLEND disables depth-write, causing
        // buildings to render translucent — you see roads/geometry through walls.
        // Force every material fully opaque + depth-writing + DoubleSide so any
        // open backfaces don't show through either.
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          if (mat) {
            (mat as THREE.MeshStandardMaterial).transparent = false;
            (mat as THREE.MeshStandardMaterial).opacity = 1;
            (mat as THREE.MeshStandardMaterial).depthWrite = true;
            (mat as THREE.MeshStandardMaterial).alphaTest = 0;
            (mat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
            mat.needsUpdate = true;
          }
        }
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

    // Compute per-axis half-extents from the recentered footprint.
    const halfX = size.x / 2;
    const halfZ = size.z / 2;

    // Scale each axis independently to fill the inner square target half-extent.
    // Y is tied to X scale to avoid vertical distortion (keep building height
    // proportional to width).
    const scaleX = CITY_FILL_HALF / (halfX || 1);
    const scaleZ = CITY_FILL_HALF / (halfZ || 1);
    const scaleY = scaleX;

    return { object: scene, groupScale: [scaleX, scaleY, scaleZ] };
  }, [gltf]);

  return (
    <group
      name="city-center"
      position={[CITY_PAN_X, CITY_Y, CITY_PAN_Z]}
      rotation={[0, CITY_ROT, 0]}
      scale={groupScale as [number, number, number] | number}
    >
      <primitive object={object} />
    </group>
  );
}

useGLTF.preload(CITY_URL);
