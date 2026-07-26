import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { BOARD_WORLD_SIZE } from './positions';
import { rebuildForestAsChunks, isForestGroundMesh } from './forestChunking';

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

/**
 * World size of the forest's shorter horizontal axis (board is 10 units).
 *
 * COUPLED TO THE CROP: forest.glb is cropped to ±FOREST_CROP_HALF raw units in
 * scripts/gen-forest.mjs. Widening the crop to include the mountain ring makes
 * the cropped terrain's shorter axis grow by the same ratio, so we scale the fit
 * target by that ratio too. Result: groupScale (= SURROUND_SIZE / shorterAxis)
 * stays IDENTICAL, so the central clearing — and thus the board's relative size —
 * is preserved, and the newly-kept mountains simply ring the terrain edge.
 * 4.6× board = 46 world units at the base ±8000 crop; ×(16000/8000) → 92.
 */
const FOREST_CROP_HALF = 16000;      // MUST match CROP_HALF in scripts/gen-forest.mjs
const FOREST_CROP_HALF_BASE = 8000;  // crop the 4.6× fit was originally tuned against
const SURROUND_SIZE =
  BOARD_WORLD_SIZE * 4.6 * (FOREST_CROP_HALF / FOREST_CROP_HALF_BASE); // 46 → 92 world units

const FOREST_SCALE = 1.0;   // multiplier on the auto-fit surround
const FOREST_Y = -0.48;     // board bottom (TOP_Y − DEPTH); clearing surface meets it here
const FOREST_ROT = 0;       // radians; orient the landscape
const FOREST_PAN_X = 0;     // world units; slide terrain E/W under the board
const FOREST_PAN_Z = 0;     // world units; slide terrain N/S under the board

/**
 * ── NEAR-CAMERA FADE (per-fragment dither) ───────────────────────────────────
 * Trees that come CLOSE to the camera would block the view of the board, so the
 * forest material FADES OUT geometry near the camera and fills it back in as the
 * camera pulls away. This is done PER-FRAGMENT in the material's fragment shader
 * (via onBeforeCompile) rather than per-mesh, because the forest is GPU-instanced
 * (EXT_mesh_gpu_instancing) — hiding a mesh would hide a whole tree TYPE across
 * the scene, not just the trees physically near the camera.
 *
 * Distance source: `vViewPosition` — the built-in MeshStandardMaterial varying
 * (= vector from the fragment to the camera in view space, correctly transformed
 * through instanceMatrix). `length(vViewPosition)` = camera-to-fragment distance
 * in WORLD units (view space is unscaled). Works for instanced + non-instanced.
 *
 * The fade is a DITHER discard (ordered 4×4 Bayer threshold on gl_FragCoord):
 * surviving fragments stay fully OPAQUE and write depth — so NO transparency,
 * sorting, or blending is needed, and far trees are pixel-for-pixel unchanged.
 *
 *   fade = smoothstep(NEAR, FAR, dist)  → 0 up close (dissolved), 1 far (solid)
 *   if (fade < bayerThreshold) discard;  → closer ⇒ more fragments discarded
 *
 * Tunable (world units): trees within FOREST_FADE_FAR of the camera begin to
 * dither out; below FOREST_FADE_NEAR they are fully gone. Camera sits ~10 units
 * out at initial framing and can zoom closer, so ~0.5–4.5 dissolves only trees
 * the user has moved right up against.
 */
const FOREST_FADE_NEAR = 0.5; // world units: fully faded (dissolved) at/below this camera distance
const FOREST_FADE_FAR = 4.5;  // world units: fully solid (unchanged) at/beyond this camera distance

/**
 * ── MOBILE-ONLY FOREST CHUNKING + DISTANCE THINNING (revertable experiment) ──
 * See `forestChunking.ts` for the mechanism. These are the live tunables; ALL of
 * this is gated on `isMobile` — when !isMobile the forest is byte-identical to
 * before (one island-wide InstancedMesh per type, frustumCulled=false, no
 * thinning — ground AND trees alike).
 *
 * The forest DENSELY fills the ~92-unit box (23 prop types / ~1162 instances) and
 * the "floor" is itself instanced ground patches (Meadow, Grass, Meadow_Path,
 * Lake_Ground). On mobile EVERY type is rebuilt into local-bounded, frustum-cullable
 * chunks (so the island-wide floor + edge mountains cull when off-screen); GROUND
 * types are chunked but NEVER thinned (thinning holes the far floor), only
 * trees/foliage/rocks are thinned. See forestChunking.ts rules for why.
 *
 *   FOREST_CHUNK_GRID    — grid resolution per horizontal axis (N×N cells over
 *       the ~92-unit scene box). 4 → ~23-unit cells (~2 board widths). Combined
 *       with the min-chunk floor + cell-defrag below, the mobile forest lands at
 *       roughly ~90 InstancedMeshes (~59 for trees/foliage + ~30 now that the
 *       GROUND floor is chunked too) instead of the ~6-7× a naive per-cell split
 *       of every type produced — well under the culling savings, since a 50° FOV
 *       looking across the board (or up at empty sky) leaves most of the dense
 *       ring + all the floor behind/beside/below the camera for three to cull.
 *       Bump to 5–6 for finer culling at the cost of thinner (more fragmented)
 *       chunks.
 *   FOREST_MIN_CHUNK_INSTANCES — a type with FEWER total instances than this is
 *       NOT spatially partitioned but is still emitted as ONE local-bounded,
 *       cullable chunk (partitioning a low-count type wastes draw calls; making
 *       it cullable costs the same one draw call it already had).
 *   FOREST_MERGE_CELL_MIN — a grid cell with FEWER surviving instances than this
 *       is folded into its nearest populated cell instead of becoming its own
 *       near-empty chunk (defrag). 3 keeps the total at ~2.5× baseline while
 *       preserving real spatial partitioning of the dense types; 2 leaves it at
 *       ~3.2×. If no cell of a type clears it, that type becomes ONE local-bounded,
 *       cullable chunk (never left island-wide with culling off).
 *   FOREST_THIN_DISTANCE — world-unit radius from board center; only TREE/FOLIAGE
 *       instances BEYOND this are thinned (ground is never thinned). 30 leaves the
 *       near/mid forest around the board completely untouched.
 *   FOREST_THIN_KEEP     — fraction of FAR-ring TREE/FOLIAGE instances to keep
 *       (0<f≤1); ground is excluded entirely so the far terrain floor is never
 *       holed. The near-camera dither-fade is NEAR-ONLY (far trees stay solid),
 *       so 0.5 statically drops every other far tree with no fade masking it —
 *       keep it conservative. Set to 1.0 to DISABLE thinning entirely (chunking
 *       still applies) — one line: keepEvery collapses to 1.
 */
const FOREST_CHUNK_GRID = 4;
const FOREST_MIN_CHUNK_INSTANCES = 8;
const FOREST_MERGE_CELL_MIN = 3;
const FOREST_THIN_DISTANCE = 30;
const FOREST_THIN_KEEP = 0.5;

/**
 * ── BOARD-FOOTPRINT CLIP (poke-through removal) ───────────────────────────────
 * The forest terrain is one continuous low-poly mesh; a hump/mound of it can rise
 * ABOVE the board's top surface INSIDE the board footprint, clipping up through
 * the board (a green mountain poking through). We discard any forest fragment
 * whose WORLD position falls inside the board's axis-aligned XZ footprint AND
 * above the board top surface. Forest OUTSIDE the footprint (the surrounding
 * treeline/hills) and forest BELOW the board top (hidden ground under the slab)
 * are untouched.
 *
 * The board slab is 10×10 centered at origin (its rotated content still has the
 * same axis-aligned world footprint), so the footprint is x∈[-HALF,HALF],
 * z∈[-HALF,HALF]. Because the city fills the inner square, clipping the whole
 * 10×10 footprint above the surface is safe — no legit forest belongs there.
 *
 * Needs the fragment's WORLD position, computed INSTANCING-AWARE in the vertex
 * shader (the trees are GPU-instanced, so we must fold in instanceMatrix before
 * modelMatrix — mirroring three's own worldpos_vertex logic) and passed through
 * as the `vWorldPos` varying.
 *
 * Tunable:
 *   BOARD_CLIP_HALF   — half-width of the clip box (board is 10 wide → 5.0).
 *   BOARD_CLIP_TOP_Y  — clip fragments above this world Y. Board top is 0.02;
 *                       0.03 sits just above it to avoid z-fighting at the seam.
 */
const BOARD_CLIP_HALF = 5.2;    // board half-width; clip box is [-HALF,HALF]² in world XZ
const BOARD_CLIP_TOP_Y = 0.02;  // clip forest above this world Y inside the box (board top ≈ 0.02)

/**
 * Injects BOTH the near-camera dither-fade AND the board-footprint poke-through
 * clip into a MeshStandardMaterial's shaders. Idempotent per material (guarded
 * by a flag) so shared/instanced materials are patched exactly once.
 */
function applyForestFade(material: THREE.Material): void {
  const mat = material as THREE.Material & { userData: { forestFadeApplied?: boolean } };
  if (mat.userData.forestFadeApplied) return;
  mat.userData.forestFadeApplied = true;

  // three.js always provides a default onBeforeCompile (a no-op function), so
  // it is safe to bind and chain unconditionally.
  const prevOnBeforeCompile = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prevOnBeforeCompile(shader, renderer);

    // ── VERTEX: compute the fragment's WORLD position, INSTANCING-AWARE ────────
    // Declare the varying on the always-present <common> include.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */ `#include <common>
        varying vec3 vWorldPos;
      `,
    );
    // After <project_vertex>, `transformed` holds the object-space position with
    // all displacements applied. Fold in instanceMatrix (GPU-instanced trees)
    // THEN modelMatrix — mirroring three's worldpos_vertex — so vWorldPos is the
    // correct world position for BOTH instanced and non-instanced meshes.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `#include <project_vertex>
        vec4 forestWorldPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          forestWorldPos = instanceMatrix * forestWorldPos;
        #endif
        forestWorldPos = modelMatrix * forestWorldPos;
        vWorldPos = forestWorldPos.xyz;
      `,
    );

    // Fragment header: constants + ordered 4×4 Bayer dither helper. Injected by
    // extending the always-present <common> include (stable across three builds).
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `#include <common>
        varying vec3 vWorldPos;
        const float FOREST_FADE_NEAR = ${FOREST_FADE_NEAR.toFixed(4)};
        const float FOREST_FADE_FAR  = ${FOREST_FADE_FAR.toFixed(4)};
        const float BOARD_CLIP_HALF  = ${BOARD_CLIP_HALF.toFixed(2)};
        const float BOARD_CLIP_TOP_Y = ${BOARD_CLIP_TOP_Y.toFixed(2)};
        // Ordered 4×4 Bayer matrix → screen-space dither threshold in [0,1).
        float forestBayer(vec2 fragCoord) {
          int x = int(mod(fragCoord.x, 4.0));
          int y = int(mod(fragCoord.y, 4.0));
          int i = y * 4 + x;
          float m =
            i == 0  ?  0.0 : i == 1  ?  8.0 : i == 2  ?  2.0 : i == 3  ? 10.0 :
            i == 4  ? 12.0 : i == 5  ?  4.0 : i == 6  ? 14.0 : i == 7  ?  6.0 :
            i == 8  ?  3.0 : i == 9  ? 11.0 : i == 10 ?  1.0 : i == 11 ?  9.0 :
            i == 12 ? 15.0 : i == 13 ?  7.0 : i == 14 ? 13.0 :               5.0;
          return (m + 0.5) / 16.0;
        }
      `,
    );

    // Discard near-camera fragments BEFORE dithering_fragment (always present in
    // the MeshStandardMaterial fragment shader). vViewPosition = fragment→camera
    // vector in view space; its length is the camera distance in world units.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      /* glsl */ `
        {
          // Board-footprint poke-through clip FIRST: drop any forest fragment
          // inside the board's XZ footprint that rises above the board top.
          if (
            vWorldPos.x > -BOARD_CLIP_HALF && vWorldPos.x < BOARD_CLIP_HALF &&
            vWorldPos.z > -BOARD_CLIP_HALF && vWorldPos.z < BOARD_CLIP_HALF &&
            vWorldPos.y > BOARD_CLIP_TOP_Y
          ) discard;

          // Near-camera dither-fade: closer fragments are more likely to discard.
          float forestCamDist = length(vViewPosition);
          float forestFade = smoothstep(FOREST_FADE_NEAR, FOREST_FADE_FAR, forestCamDist);
          if (forestFade < forestBayer(gl_FragCoord.xy)) discard;
        }
        #include <dithering_fragment>
      `,
    );
  };

  // Changing onBeforeCompile requires a program recompile.
  mat.needsUpdate = true;
}

const FOREST_URL = '/models/forest.glb';

/**
 * @param isMobile When true, the forest is rebuilt into frustum-cullable spatial
 *   chunks and the far ring is statically thinned (see forestChunking.ts). When
 *   false/absent, the forest is byte-identical to the pre-experiment behavior.
 */
export function ForestEnvironment({ isMobile = false }: { isMobile?: boolean }): React.JSX.Element {
  const gltf = useGLTF(FOREST_URL);

  const { object, groupScale } = useMemo(() => {
    const scene = gltf.scene.clone(true);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: o is Object3D; only actual meshes have isMesh===true
      if (m.isMesh) {
        m.receiveShadow = true; // ground/foliage takes the board's shadow
        m.frustumCulled = false;
        // Per-fragment near-camera dither-fade + board-footprint clip so trees
        // close to the camera dissolve out of the way of the board and no terrain
        // hump pokes up through it (see applyForestFade). The forest likely shares
        // one material across all meshes, but handle arrays too; applyForestFade
        // is idempotent so a shared material is patched once.
        //
        // Applied on MOBILE too (identical to desktop): the see-through fade and
        // the board-footprint clip are load-bearing for the look (without them
        // near trees block the view and terrain clips through the board). The
        // extra overdraw the per-fragment `discard` reintroduces (it defeats
        // early-Z on the overlapping tree ring) is kept affordable by the mobile
        // adaptive dpr in GameScene: it renders at the cheap MOVING dpr while the
        // camera moves and at the capped STILL dpr (min(devicePixelRatio, 2)) at
        // rest, so the sustained overdraw stays within thermal budget.
        const material: THREE.Material | THREE.Material[] = m.material;
        const mats: THREE.Material[] = Array.isArray(material) ? material : [material];
        for (const mat of mats) applyForestFade(mat);
      }
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: o is Object3D; only actual InstancedMeshes have isInstancedMesh===true
      if (!im.isInstancedMesh) return;
      if (!isForestGroundMesh(im.name)) return; // same ground classifier as the chunker
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

    // MOBILE-ONLY: rebuild each island-wide InstancedMesh into a frustum-cullable
    // spatial grid of chunks (local bounds) and statically thin the far ring.
    // Runs BEFORE scene.position.set so each InstancedMesh.matrixWorld still
    // reflects only the glb's internal hierarchy (the frame `box`/`center` use).
    // Desktop skips this entirely → byte-identical to the pre-experiment forest.
    if (isMobile) {
      rebuildForestAsChunks({
        scene,
        boxMin: box.min,
        size,
        center,
        groupScale,
        gridN: FOREST_CHUNK_GRID,
        thinDistance: FOREST_THIN_DISTANCE,
        keepFraction: FOREST_THIN_KEEP,
        minChunkInstances: FOREST_MIN_CHUNK_INSTANCES,
        mergeCellMin: FOREST_MERGE_CELL_MIN,
      });
    }

    // Recenter x/z at origin (+ optional pan) and place the CENTER surface at
    // local 0 so the outer group drops it precisely onto FOREST_Y.
    scene.position.set(
      -center.x + FOREST_PAN_X / groupScale,
      -centerSurfaceY,
      -center.z + FOREST_PAN_Z / groupScale,
    );

    return { object: scene, groupScale };
  }, [gltf, isMobile]);

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
