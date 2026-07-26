import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
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
 * ── MOBILE-ONLY: OPAQUE-vs-FADE PER-CHUNK MATERIAL SWAP (overdraw kill) ───────
 * The near-camera fade is a per-fragment `discard`, and the mere PRESENCE of
 * `discard` in a shader disables the GPU's early-Z, so EVERY forest fragment
 * overdraws — even far trees whose fade math provably resolves to "keep" every
 * time (smoothstep clamps to 1 at/beyond FOREST_FADE_FAR, and the Bayer max is
 * 0.969 < 1). Fix (mobile only): chunks whose bounding sphere is entirely beyond
 * FOREST_FADE_FAR from the CAMERA are swapped to a discard-free OPAQUE material
 * so early-Z culls their hidden fragments; chunks within the fade range keep the
 * fade material. Since a tree at the boundary is already fully opaque under the
 * fade, the swap is a VISUAL NO-OP (desktop parity preserved) — it only removes
 * the fill cost. The swap thresholds sit strictly BEYOND FOREST_FADE_FAR so a
 * chunk is opaque in BOTH materials at the boundary → no pop; the ENTER/EXIT gap
 * is hysteresis to stop boundary flip-flop as the camera orbits/pans.
 *
 * FAST-ZOOM POP HARDENING: the revert (opaque→fade) is only rechecked every
 * FOREST_SWAP_INTERVAL, so a fast pinch-zoom can travel far between checks — if
 * EXIT sat just above FADE_FAR (e.g. +0.25), a re-entering chunk could stay opaque
 * for one interval AFTER its trees re-enter the fade band, giving a brief "too
 * solid" pop. Two mitigations: (1) recheck ~20x/s (0.05s) — the loop is only a
 * distanceTo + compares per ~322 chunks, cheap; and (2) widen the revert margin so
 * EXIT (FADE_FAR+1.0) sits well above FADE_FAR. Even at fast zoom a chunk reverts
 * to fade a full unit before its nearest tree could begin fading, while ENTER
 * (FADE_FAR+2.0) keeps switch-TO-opaque strictly beyond the fade range and
 * preserves the 1.0 hysteresis gap.
 *
 * The test uses (cameraDist to chunk sphere center − sphere radius) = distance to
 * the chunk's NEAREST possible fragment, so a chunk only goes opaque once EVERY
 * one of its trees is provably past the fade range (never opaque while any tree
 * could still be fading). Near-board chunks whose sphere overlaps the board's
 * footprint are excluded from the swap entirely (they must keep the poke-through
 * clip regardless of camera distance) — see buildForestChunkMetas.
 */
const FOREST_OPAQUE_ENTER = FOREST_FADE_FAR + 2.0;  // 6.5: go opaque once the nearest fragment is beyond this
const FOREST_OPAQUE_EXIT = FOREST_FADE_FAR + 1.0;   // 5.5: revert to fade well ABOVE FADE_FAR (fast-zoom margin → no pop)
const FOREST_SWAP_INTERVAL = 0.05;                   // s: throttle the per-chunk distance recheck (~20x/s)

/**
 * ── MOBILE-ONLY: MINECRAFT-STYLE RENDER DISTANCE (distance-from-CAMERA cull) ──
 * The forest.glb spans a ~92-unit island, so even with per-chunk frustum culling a
 * chunk that is FAR from the camera but still IN VIEW (the far map edge — distant
 * trees, rocks, mountains, and the ground/terrain tiles out there) keeps drawing
 * for no visible benefit. On TOP of frustum culling we add a dynamic
 * distance-from-CAMERA cull: any forest chunk whose TRUE nearest point sits beyond
 * FOREST_RENDER_DISTANCE from the camera is not rendered at all
 * (`InstancedMesh.visible = false` → three skips it entirely: no draw call, no
 * geometry submit, no fill). As the camera moves closer, chunks inside the radius
 * render (Minecraft-style POP-IN at the edge — intended; no fog is added to hide
 * it, per the no-extra-cost constraint).
 *
 * CONSISTENCY (why it is a CLEAN ring, not ragged): the nearest distance is measured
 * against each chunk's INSTANCED world AABB (covers ALL of the chunk's instances)
 * via `Box3.clampPoint` — the TRUE nearest point on the chunk's extent, not a loose
 * bounding-sphere proxy. A sphere's `distanceTo(center) − radius` over-estimates
 * closeness for tall/elongated/flat chunks (a mountain's radius folds in its full
 * height; a flat ground cell's folds in its half-diagonal), so the 32u cut used to
 * land at a DIFFERENT true distance per chunk → ragged, with tall relief culling
 * inconsistently. The AABB clamp makes every chunk cull at the SAME true distance
 * (uniform ring) and guarantees a chunk with ANY instance within the radius always
 * renders (no close-culling).
 *
 * The check runs in the SAME throttled loop as the opaque/fade swap and reuses a
 * module-level scratch vector for the clamp → no new loop, no per-frame allocation.
 *
 * Applies to ALL mobile forest chunks INCLUDING the ground/terrain tiles and the
 * edge mountains (culling the far terrain is the whole point). It NEVER touches the
 * board/tokens/city (those are not forest chunks). The camera sits ~7u from the
 * board center and the island extends to ~46u; 32u keeps the near/mid forest that
 * rings the board rendered (no bald ring around the board) while the far island
 * edge/mountains cull. Tunable (world units).
 */
const FOREST_RENDER_DISTANCE = 32;

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
 *       the ~92-unit scene box). MEASURED against the real forest.glb instance
 *       positions: at the previous 4/8/3 tuning, chunk world-radius was median
 *       ~13u / max ~65u — while the mobile camera sits only ~6.9u away, so ~20
 *       chunks' bounding spheres literally CONTAINED the camera and intersected
 *       every possible frustum, drawing from ANY orientation (an empty-screen
 *       view still rendered ~250K tris — frustum culling ran but did nothing).
 *       10 → ~9.2-unit cells, and combined with the lower min-chunk floor + the
 *       disabled cell-defrag below, lands at ~322 total chunks and an
 *       EMPTY-VIEW render of ~5.1K tris (-98%) — the tightest practical culling
 *       ("only what's on screen"). More total chunks than before is EXPECTED
 *       and correct here: culling now keeps the per-frame DRAWN count low, and
 *       draw-call cost is only paid for chunks actually rendered — do not
 *       re-cap the chunk count, that is exactly what defeated culling
 *       previously.
 *   FOREST_MIN_CHUNK_INSTANCES — a type with FEWER total instances than this is
 *       NOT spatially partitioned but is still emitted as ONE local-bounded,
 *       cullable chunk (partitioning a low-count type wastes draw calls; making
 *       it cullable costs the same one draw call it already had). Lowered from
 *       8 to 4 so sparse-but-not-tiny types (e.g. the two Forest_Mountain_Moss
 *       types at 9-11 instances) grid-split into several small local bounds
 *       instead of emitting ONE island-wide chunk spanning the whole ~55-65u
 *       ring (which is exactly the kind of fat bound that defeated culling).
 *   FOREST_MERGE_CELL_MIN — a grid cell with FEWER surviving instances than this
 *       is folded into its nearest populated cell instead of becoming its own
 *       near-empty chunk (defrag). The OLD value (3) re-inflated bounds by
 *       re-folding small cells back into big ones, undoing the grid split. 1
 *       means the fold threshold is never met (every occupied cell has ≥1
 *       instance) — defrag is effectively OFF, so every cell keeps its own
 *       tight local bound. If a type has NO instances in ANY cell it still
 *       becomes ONE local-bounded, cullable chunk (never left island-wide).
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
const FOREST_CHUNK_GRID = 10;
const FOREST_MIN_CHUNK_INSTANCES = 4;
const FOREST_MERGE_CELL_MIN = 1;
const FOREST_THIN_DISTANCE = 18;
const FOREST_THIN_KEEP = 0.25;

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

/**
 * MOBILE-ONLY: prepend a FRAGMENT-only `precision mediump float;` override.
 * three prepends `precision highp float;` to the fragment prefix; redeclaring the
 * default float precision at the top of the material's own fragment source drops
 * the (per-fragment, overdrawn) fade/lighting fill math to mediump — cheaper fill,
 * visually identical on the low-poly forest. VERTEX precision is left at highp so
 * world-space positions (used for the board-clip compare, up to ~92 units) never
 * jitter. Both mobile variants get the SAME mediump treatment so their shading is
 * identical at the opaque↔fade swap boundary (no pop). Desktop is never touched.
 */
function injectMobileMediump(material: THREE.Material): void {
  const prev = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.fragmentShader = `precision mediump float;\n${shader.fragmentShader}`;
  };
}

/**
 * MOBILE-ONLY fade material: the EXACT desktop fade+clip program (built by the
 * shared {@link applyForestFade}, so the near-tree see-through look is identical)
 * plus the mobile mediump fragment override. Cloned from the shared base material
 * so all textures/uniforms are shared — only the compiled program differs.
 */
function buildMobileForestFadeMaterial(base: THREE.Material): THREE.Material {
  const mat = base.clone();
  applyForestFade(mat); // same fade + board-clip discard program as desktop
  injectMobileMediump(mat);
  mat.needsUpdate = true;
  return mat;
}

/**
 * MOBILE-ONLY opaque material: NO discard at all (no fade, no board clip) so the
 * GPU's early-Z culls the chunk's hidden fragments. Only ever assigned to chunks
 * proven beyond the fade range AND outside the board footprint, where both
 * discards are dead code — so it is pixel-identical to the fade material there.
 * Same mediump fragment precision as the fade variant (shading-identical → no pop
 * at the swap). Cloned from the base so textures/uniforms are shared.
 */
function buildMobileForestOpaqueMaterial(base: THREE.Material): THREE.Material {
  const mat = base.clone();
  injectMobileMediump(mat);
  mat.needsUpdate = true;
  return mat;
}

/** Per-chunk cache for the mobile render-distance cull + opaque/fade swap (built once). */
interface ForestChunkMeta {
  mesh: THREE.InstancedMesh;
  /** World-space center of the chunk's INSTANCED bounding sphere (static after mount). */
  worldCenter: THREE.Vector3;
  /** World-space radius of that sphere (static after mount). */
  worldRadius: number;
  /**
   * World-space AABB covering ALL of the chunk's instances (static after mount).
   * Used by the render-distance cull to measure the TRUE nearest point on the
   * chunk's extent (`Box3.clampPoint`), which is tighter and more uniform than the
   * bounding-sphere proxy for tall/elongated/flat chunks → a clean cull ring.
   */
  worldBox: THREE.Box3;
  /**
   * True if the chunk's world sphere overlaps the board's ±BOARD_CLIP_HALF XZ
   * footprint. Such chunks MUST keep the poke-through clip no matter where the
   * camera is, so they are pinned to the fade material and never swapped.
   */
  needsBoardClip: boolean;
  /** Current material state (which variant `mesh.material` points at). */
  isOpaque: boolean;
}

/**
 * Module-level scratch for the per-frame render-distance clamp (`Box3.clampPoint`
 * writes the nearest point here). Reused across every chunk and every frame so the
 * throttled loop performs ZERO per-frame allocation. Safe because the loop runs
 * synchronously on the main thread (there is one ForestEnvironment instance).
 */
const _forestNearestPoint = new THREE.Vector3();

/**
 * Build the static per-chunk metadata for the mobile render-distance cull + swap.
 *
 * Each chunk is an InstancedMesh; its bound MUST cover ALL of its instances, not
 * the single-instance geometry bound. `InstancedMesh.computeBoundingSphere()` /
 * `computeBoundingBox()` are instanced-aware (they iterate every instance transform
 * and union), so we call them here explicitly — the meta then never depends on when
 * `emitChunk` ran, on a stale/null cached bound, or on which geometry (full vs LOD)
 * the chunk ended up with. Both bounds are LOCAL to the chunk; the outer group
 * transform is fixed for the session, so we resolve `matrixWorld` (updateWorldMatrix)
 * and bake each into WORLD space once here:
 *   • worldCenter/worldRadius — sphere center transformed by matrixWorld, radius
 *     scaled by the max world-scale axis (conservative). Kept for the opaque/fade
 *     swap exactly as before.
 *   • worldBox — the instanced AABB transformed to world (`Box3.applyMatrix4`
 *     re-bounds all 8 corners, so it is correct under the group scale/rotation).
 *     Used by the render-distance cull for a TRUE nearest-point test.
 *
 * Returns `null` if any chunk's world matrix is not ready yet (degenerate/empty
 * bound) so the caller can retry on a later frame rather than cache a wrong meta.
 * No per-frame allocation: the built vectors/box are reused in-place by `useFrame`.
 */
function buildForestChunkMetas(chunks: THREE.InstancedMesh[]): ForestChunkMeta[] | null {
  const scale = new THREE.Vector3(); // reused across chunks during this one-time build
  const metas: ForestChunkMeta[] = [];
  for (const mesh of chunks) {
    mesh.updateWorldMatrix(true, false); // resolve the full group→chunk transform
    // Guarantee INSTANCED bounds covering every instance (instanced-aware in three).
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    const bs = mesh.boundingSphere;
    const bb = mesh.boundingBox;
    // Not ready this frame (matrixWorld/instances not settled) → retry next frame.
    if (!bs || !bb || bb.isEmpty()) return null;

    // Sphere → world (kept for the opaque/fade swap, unchanged behavior).
    const worldCenter = new THREE.Vector3().copy(bs.center).applyMatrix4(mesh.matrixWorld);
    scale.setFromMatrixScale(mesh.matrixWorld);
    const worldRadius = bs.radius * Math.max(scale.x, scale.y, scale.z);

    // AABB → world (used for the render-distance TRUE nearest-point test).
    const worldBox = new THREE.Box3().copy(bb).applyMatrix4(mesh.matrixWorld);

    // Conservative (box-of-sphere) overlap with the board's ±HALF world footprint.
    // Over-marking is safe (the chunk simply keeps the clip); under-marking would
    // let terrain poke through the board, so bias inclusive.
    const needsBoardClip =
      Math.abs(worldCenter.x) - worldRadius < BOARD_CLIP_HALF &&
      Math.abs(worldCenter.z) - worldRadius < BOARD_CLIP_HALF;
    metas.push({ mesh, worldCenter, worldRadius, worldBox, needsBoardClip, isOpaque: false });
  }
  return metas;
}

const FOREST_URL = '/models/forest.glb';

/**
 * MOBILE-ONLY variant of the forest (`scripts/gen-forest-mobile.mjs`): the same
 * diorama with (A) EXT_meshopt_compression (smaller download, zero visual change;
 * the decoder is bundled in three-stdlib and auto-installed by drei's useGLTF, so
 * NO draco/decoder wiring is needed here), (B) the flat ground tiles decimated
 * ~90%, and (C) a decimated `<name>_LOD` sibling mesh for every relief type that
 * the chunker points FAR chunks at. Desktop keeps `forest.glb` byte-identical.
 */
const FOREST_URL_MOBILE = '/models/forest.mobile.glb';

/** Suffix marking the decimated far-LOD sibling meshes inside forest.mobile.glb. */
const LOD_SUFFIX = '_LOD';

/**
 * @param isMobile When true, the forest is rebuilt into frustum-cullable spatial
 *   chunks, the far ring is statically thinned, and FAR chunks of relief types
 *   use their decimated `_LOD` geometry (see forestChunking.ts). When
 *   false/absent, the forest is byte-identical to the pre-experiment behavior.
 */
export function ForestEnvironment({ isMobile = false }: { isMobile?: boolean }): React.JSX.Element {
  // Mobile loads the meshopt-compressed + decimated variant (decoder is auto-
  // installed by useGLTF); desktop loads the plain forest.glb. drei caches per
  // url, so the two never collide.
  const url = isMobile ? FOREST_URL_MOBILE : FOREST_URL;
  const gltf = useGLTF(url);

  const { object, groupScale, mobileChunks, forestFadeMat, forestOpaqueMat } = useMemo(() => {
    const scene = gltf.scene.clone(true);

    // MOBILE-ONLY: harvest the decimated `_LOD` sibling meshes into a lookup
    // keyed by their base (full) mesh name, then REMOVE them from the scene graph
    // so they never render. They exist in forest.mobile.glb solely to supply
    // far-chunk LOD geometry to rebuildForestAsChunks (below). Done before the
    // Box3/anchor computation so the (origin-placed) LOD meshes never skew bounds.
    const lodGeometry = new Map<string, THREE.BufferGeometry>();
    if (isMobile) {
      const lodObjects: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.name.endsWith(LOD_SUFFIX)) lodObjects.push(o);
      });
      for (const o of lodObjects) {
        const mesh = o as THREE.Mesh;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: only actual meshes carry geometry
        if (mesh.geometry) lodGeometry.set(o.name.slice(0, -LOD_SUFFIX.length), mesh.geometry);
        o.removeFromParent();
      }
    }

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
        //
        // DESKTOP: patch the single shared material IN PLACE (byte-identical to
        // before). MOBILE: leave the base material UNPATCHED here — the chunker
        // (below) reassigns every chunk to one of two purpose-built clones of it
        // (fade+clip, or discard-free opaque), so the base is never rendered and
        // must stay pristine to clone from.
        if (!isMobile) {
          const material: THREE.Material | THREE.Material[] = m.material;
          const mats: THREE.Material[] = Array.isArray(material) ? material : [material];
          for (const mat of mats) applyForestFade(mat);
        }
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
    let mobileChunks: THREE.InstancedMesh[] | null = null;
    let forestFadeMat: THREE.Material | null = null;
    let forestOpaqueMat: THREE.Material | null = null;
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
        lodGeometry,
      });

      // Collect the freshly-built chunk InstancedMeshes and build the two swap
      // materials once (cloned from the single shared base every chunk points at).
      // Start EVERY chunk on the fade+clip material (today's exact look, board-wide);
      // the per-frame check (useFrame below) flips FAR non-board chunks to opaque.
      const chunks: THREE.InstancedMesh[] = [];
      scene.traverse((o) => {
        const im = o as THREE.InstancedMesh;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: only actual InstancedMeshes have isInstancedMesh===true
        if (im.isInstancedMesh) chunks.push(im);
      });
      const base = chunks.length > 0 ? chunks[0].material : null;
      if (base && !Array.isArray(base)) {
        forestFadeMat = buildMobileForestFadeMaterial(base);
        forestOpaqueMat = buildMobileForestOpaqueMaterial(base);
        for (const c of chunks) c.material = forestFadeMat;
        mobileChunks = chunks;
      }
    }

    // Recenter x/z at origin (+ optional pan) and place the CENTER surface at
    // local 0 so the outer group drops it precisely onto FOREST_Y.
    scene.position.set(
      -center.x + FOREST_PAN_X / groupScale,
      -centerSurfaceY,
      -center.z + FOREST_PAN_Z / groupScale,
    );

    return { object: scene, groupScale, mobileChunks, forestFadeMat, forestOpaqueMat };
  }, [gltf, isMobile]);

  // ── MOBILE-ONLY per-frame render-distance cull + opaque/fade chunk swap ───────
  // Throttled (~20x/s) camera-distance pass that (1) hides chunks whose TRUE nearest
  // point is beyond FOREST_RENDER_DISTANCE (Minecraft-style render distance —
  // visible=false, no draw) and (2) for the still-visible far chunks, flips each
  // non-board chunk to the discard-free opaque material and back. Desktop
  // early-returns (no chunks). Chunk world bounds are static, so they are cached on
  // the first valid frame; the loop does only a clampPoint + distanceTo + compares
  // (no allocation — the clamp target is the module-level scratch). See the notes on
  // FOREST_RENDER_DISTANCE (why the AABB clamp yields a clean, uniform ring) and the
  // swap thresholds.
  const chunkMetaRef = useRef<{ chunks: THREE.InstancedMesh[]; metas: ForestChunkMeta[] } | null>(
    null,
  );
  const swapAccumRef = useRef(0);
  useFrame((state, delta) => {
    if (!isMobile || !mobileChunks || !forestFadeMat || !forestOpaqueMat) return;

    let store = chunkMetaRef.current;
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- explicit null check narrows `store` to non-null for the reassign + later use
    if (!store || store.chunks !== mobileChunks) {
      const metas = buildForestChunkMetas(mobileChunks);
      if (!metas) return; // bounds/matrixWorld not ready yet — retry next frame
      store = { chunks: mobileChunks, metas };
      chunkMetaRef.current = store;
    }

    swapAccumRef.current += delta;
    if (swapAccumRef.current < FOREST_SWAP_INTERVAL) return;
    swapAccumRef.current = 0;

    const camPos = state.camera.position;
    const metas = store.metas;
    for (const meta of metas) {
      // ── MINECRAFT-STYLE RENDER DISTANCE (TRUE nearest-point cull) ────────────
      // Nearest point on the chunk's INSTANCED world AABB to the camera: any
      // instance within FOREST_RENDER_DISTANCE keeps the chunk visible; once EVERY
      // instance is beyond it the chunk is skipped entirely (visible=false → no
      // draw call/geometry/fill). The AABB clamp is the true nearest distance, so
      // every chunk (trees/rocks/mountains/ground) culls at the SAME distance — a
      // clean uniform ring, not the ragged sphere-radius cut. Near-board chunks
      // overlap the board footprint → nearest ≈ 0 → they never hide (the forest
      // ring around the board and the board itself always render). Runs BEFORE the
      // swap so a hidden chunk skips the swap work this frame. Only reassign
      // .visible on an actual change to avoid churn.
      meta.worldBox.clampPoint(camPos, _forestNearestPoint);
      const boxNearest = _forestNearestPoint.distanceTo(camPos);
      const shouldRender = boxNearest <= FOREST_RENDER_DISTANCE;
      if (meta.mesh.visible !== shouldRender) meta.mesh.visible = shouldRender;
      if (!shouldRender) continue;

      if (meta.needsBoardClip) continue; // near-board chunks stay on fade+clip forever
      // Opaque/fade swap — UNCHANGED: distance to the chunk's nearest possible
      // fragment via the bounding sphere (kept so the swap boundary/look is exactly
      // as before; no pop).
      const nearest = camPos.distanceTo(meta.worldCenter) - meta.worldRadius;
      if (!meta.isOpaque) {
        if (nearest > FOREST_OPAQUE_ENTER) {
          meta.mesh.material = forestOpaqueMat;
          meta.isOpaque = true;
        }
      } else if (nearest < FOREST_OPAQUE_EXIT) {
        meta.mesh.material = forestFadeMat;
        meta.isOpaque = false;
      }
    }
  });

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

// Preload the SAME variant the component will actually load. useIsMobile keys off
// `(max-width: 768px), (max-height: 600px)`; mirror that synchronously here (this
// runs at module import, before any component renders) so mobile preloads the
// meshopt variant and desktop preloads the plain glb. Guard for SSR/jsdom where
// matchMedia is absent (defaults to the desktop path).
const preloadMobileForest =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(max-width: 768px), (max-height: 600px)').matches;
useGLTF.preload(preloadMobileForest ? FOREST_URL_MOBILE : FOREST_URL);
