import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { BOARD_WORLD_SIZE } from './positions';

/**
 * The low-poly FOREST environment (`public/models/forest.glb`, ~1.7 MB,
 * decoder-free) that SURROUNDS the board — the board sits in a natural CLEARING
 * and the forest's trees ring the outside, completing the "board-in-a-diorama"
 * look (isometric board resting in nature).
 *
 * The committed glb is a CROPPED, GPU-INSTANCED slice of the Sketchfab low-poly
 * forest (see `scripts/gen-forest.mjs`): ~20 instanced prop types / 579
 * placements — 26 trees, rocks, meadow patches, dirt paths, flowers, mushrooms
 * — over a gently rolling terrain. It carries only EXT_mesh_gpu_instancing
 * (decoder-free; three/drei load it natively as InstancedMesh).
 *
 * Self-normalizing at RUNTIME (authored bounds are unreliable post-instancing):
 *   1. RECENTER horizontally so the terrain's x/z center sits at world origin
 *      (the board is at origin too → board lands in the forest's middle, which
 *      is a natural clearing with the trees rimming it).
 *   2. FIT the SHORTER horizontal axis to SURROUND_SIZE so the forest overspreads
 *      the 10×10 board on every side; FOREST_SCALE is a tunable multiplier.
 *   3. ANCHOR VERTICALLY on the terrain SURFACE UNDER THE BOARD (not the global
 *      Box3 min — that's a distant low spot / lake basin ~30 units below). We
 *      sample the median top-Y of the GROUND props near the center and drop that
 *      surface onto FOREST_Y so the clearing floor meets the board bottom. This
 *      prevents a terrain hump poking up THROUGH the board.
 *
 * ── TUNABLE CONSTS (iterate live) ───────────────────────────────────────────
 *   SURROUND_SIZE — world size of the forest's shorter axis. 4.6× board (=46)
 *                   puts the treeline just outside the 10-unit board with NO
 *                   trees inside the board footprint (measured). Shrink to pull
 *                   trees inward (they start overlapping the board < ~4.4×),
 *                   grow to widen the clearing / push trees further out.
 *   FOREST_SCALE  — extra multiplier on the auto-fit. 1.0 = exactly SURROUND_SIZE.
 *   FOREST_Y      — world Y the CENTER clearing surface rests on. Board bottom is
 *                   TOP_Y − DEPTH = 0.02 − 0.5 = −0.48; keep at/just below it so
 *                   the board slab caps the clearing (no ground poking through).
 *   FOREST_ROT    — Y-rotation (radians) to orient the treeline/landscape.
 *   FOREST_PAN_X/Z — pan (world units) to slide a specific flat patch of terrain
 *                    under the board if the auto-centered spot is bumpy.
 */

/** World size of the forest's shorter horizontal axis (board is 10 units). */
const SURROUND_SIZE = BOARD_WORLD_SIZE * 4.6; // 46 world units → treeline just off the board edge

const FOREST_SCALE = 1.0;   // multiplier on the auto-fit surround
const FOREST_Y = -0.48;     // board bottom (TOP_Y − DEPTH); clearing surface meets it here
const FOREST_ROT = 0;       // radians; orient the landscape
const FOREST_PAN_X = 0;     // world units; slide terrain E/W under the board
const FOREST_PAN_Z = 0;     // world units; slide terrain N/S under the board

const FOREST_URL = '/models/forest.glb';

export function ForestEnvironment(): React.JSX.Element {
  const gltf = useGLTF(FOREST_URL);

  const { object, groupScale } = useMemo(() => {
    const scene = gltf.scene.clone(true);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.receiveShadow = true; // ground/foliage takes the board's shadow
    });
    scene.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Fit the SHORTER horizontal axis to SURROUND_SIZE, then the tunable factor.
    const shorterAxis = Math.min(size.x, size.z) || 1;
    const groupScale = (SURROUND_SIZE / shorterAxis) * FOREST_SCALE;

    // Vertical anchor: find the terrain SURFACE height at the center (where the
    // board sits), NOT the global Box3 min (a distant low spot). We take the
    // median top-Y of GROUND props (meadow/grass/path/lake) whose instance
    // center falls within a board-sized radius of the scene center, in the
    // scene's own (pre-scale) units. Falls back to box.min.y if none found.
    const CENTER_RADIUS = shorterAxis * 0.15; // ~board-footprint radius, pre-scale
    const groundTops: number[] = [];
    const m4 = new THREE.Matrix4();
    const instPos = new THREE.Vector3();
    scene.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh) return;
      if (!/meadow|grass|path|lake/i.test(im.name)) return;
      im.geometry.computeBoundingBox();
      const gbMaxY = im.geometry.boundingBox?.max.y ?? 0;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m4);
        m4.premultiply(im.matrixWorld);
        instPos.setFromMatrixPosition(m4);
        const dx = instPos.x - center.x;
        const dz = instPos.z - center.z;
        if (Math.hypot(dx, dz) > CENTER_RADIUS) continue;
        // Approx surface = instance origin Y + geometry top offset (uniform-ish scale).
        const scaleY = new THREE.Vector3().setFromMatrixScale(m4).y;
        groundTops.push(instPos.y + gbMaxY * scaleY);
      }
    });
    let centerSurfaceY = box.min.y;
    if (groundTops.length) {
      groundTops.sort((a, b) => a - b);
      centerSurfaceY = groundTops[groundTops.length >> 1]; // median
    }

    // Recenter x/z at origin (+ optional pan) and place the CENTER surface at
    // local 0 so the outer group drops it precisely onto FOREST_Y.
    scene.position.set(
      -center.x + FOREST_PAN_X / groupScale,
      -centerSurfaceY,
      -center.z + FOREST_PAN_Z / groupScale,
    );

    return { object: scene, groupScale };
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
