import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { BOARD_WORLD_SIZE } from './positions';

/**
 * The low-poly FOREST environment (`public/models/forest.glb`, ~4 MB,
 * decoder-free) that SURROUNDS the board — the board sits in a clearing and the
 * forest's trees ring the outside, completing the "board-in-a-diorama" look.
 *
 * Self-normalizing: the source glb was optimized with instancing, so its
 * authored/static bounds are unreliable. We compute a `THREE.Box3` on the loaded
 * scene at RUNTIME and:
 *   1. RECENTER horizontally so the terrain's x/z center sits at world origin
 *      (the board is at origin too, so the board lands in the forest's middle).
 *   2. Drop its Y-min (ground surface) onto FOREST_Y, just below the board's
 *      bottom (board bottom = TOP_Y − DEPTH = 0.02 − 0.5 = −0.48) so the board
 *      slab rests ON the forest floor rather than floating above it.
 *   3. FIT it so the forest's footprint extends well BEYOND the 10×10 board on
 *      all sides: base scale = SURROUND_SIZE / min(boxSizeX, boxSizeZ) (min, so
 *      even the shorter axis comfortably exceeds the board). FOREST_SCALE is a
 *      tunable multiplier on top.
 *
 * FIRST-PASS NOTE (needs live tuning): the forest is dense flora everywhere,
 * INCLUDING the center where the board goes. That's fine here — the board slab
 * sits on top and hides the central trees under it — but a follow-up can prune
 * the central forest meshes in Blender for a clean clearing. See build report.
 *
 * ── TUNABLE CONSTS (iterate live with these three only) ─────────────────────
 *   FOREST_SCALE — multiplier on the auto-fit surround. 1.0 = forest's shorter
 *                  axis ≈ SURROUND_SIZE. Grow it to push trees further out;
 *                  shrink it to bring the treeline closer to the board.
 *   FOREST_Y     — world Y the forest GROUND rests on. Keep at/just below the
 *                  board bottom (−0.48) so the board sits in the clearing.
 *   FOREST_ROT   — Y-rotation (radians) to orient the treeline/landscape.
 */

/**
 * Target world size for the forest's shorter horizontal axis. The board is
 * 10 units; 2.6× gives a wide clearing with trees framing well outside the
 * board on every side.
 */
const SURROUND_SIZE = BOARD_WORLD_SIZE * 2.6; // 26 world units across (board is 10)

const FOREST_SCALE = 1.0;    // multiplier on the auto-fit surround
const FOREST_Y = -0.48;      // board bottom (TOP_Y − DEPTH); board rests in clearing
const FOREST_ROT = 0;        // radians; orient the landscape

const FOREST_URL = '/models/forest.glb';

export function ForestEnvironment(): React.JSX.Element {
  const gltf = useGLTF(FOREST_URL);

  const { object, groupScale } = useMemo(() => {
    const scene = gltf.scene.clone(true);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.receiveShadow = true; // ground/foliage takes the board's shadow
    });

    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Recenter horizontally at origin; drop ground (Y-min) to local 0 so the
    // outer group places the forest floor precisely at FOREST_Y.
    scene.position.set(-center.x, -box.min.y, -center.z);

    // Fit the SHORTER horizontal axis to SURROUND_SIZE so both axes exceed the
    // board footprint; multiply by the tunable factor.
    const shorterAxis = Math.min(size.x, size.z) || 1;
    const fit = SURROUND_SIZE / shorterAxis;

    return { object: scene, groupScale: fit * FOREST_SCALE };
  }, [gltf]);

  return (
    <group
      name="forest-environment"
      position={[0, FOREST_Y, 0]}
      rotation={[0, FOREST_ROT, 0]}
      scale={groupScale}
    >
      <primitive object={object} />
    </group>
  );
}

useGLTF.preload(FOREST_URL);
