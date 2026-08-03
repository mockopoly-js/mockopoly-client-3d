import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF, useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { mergeVertices } from 'three-stdlib';
import { BOARD_WORLD_SIZE, FOREST_GROUND_LAYER, MOBILE_FOREST_SHADOWS_ENABLED } from './positions';
import {
  rebuildForestAsChunks,
  isForestGroundMesh,
  selectForestLodTier,
  selectForestDensityTier,
  densityKeepForTier,
  horizontalNearestDistanceToBox,
  type ForestChunkLod,
  type ForestLodTier,
  type ForestHorizontalBox,
} from './forestChunking';
import {
  getDebugVisibility,
  subscribeDebugVisibility,
  type ForestDebugCategory,
} from '../dev/debugVisibility';
import { getLodTintEnabled } from '../dev/lodTint';

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
 * ── MOBILE-ONLY: DYNAMIC MULTI-TIER LOD BY CAMERA DISTANCE ────────────────────
 * Each eligible relief chunk (trees / flowers / mushrooms / grass) carries
 * three pre-created, pre-uploaded geometry tiers — full, LOD1 (~30%), LOD2 (~5%)
 * — stashed on `chunk.userData.forestLod` by the chunker. The SAME throttled
 * per-frame loop that runs the opaque/fade swap picks each chunk's tier by the
 * distance from the CAMERA to the chunk's NEAREST edge (its bounding-sphere near
 * point — NOT its center, NOT distance-from-board): near → full, mid → LOD1, far →
 * LOD2. Because the selector is camera-relative, the free-roam camera ALWAYS sees
 * full detail on the chunks nearest it and low-poly only far away — flying out to
 * the far ring now shows full detail there (the old static distance-from-board
 * LOD left the far ring permanently low-poly, which looked bad up close).
 *
 * The swap is just `chunk.geometry = tier` (the InstancedMesh instances /
 * instanceMatrix are untouched — the geometry is only a ref swap between already-
 * resident buffers, so it is cheap with no GPU re-upload). We only reassign when
 * the tier actually CHANGES. {@link selectForestLodTier} applies ±LOD_HYSTERESIS
 * around each threshold so a chunk hovering at a boundary never flickers. Chunks
 * of NON-eligible types (mountains/ground — no tiers) are skipped and stay full.
 *
 * Tunable (world units — distance from the camera to the chunk's NEAREST edge):
 *   LOD_DIST_1 — when the chunk's nearest edge is closer than this it renders FULL.
 *   LOD_DIST_2 — when the nearest edge is farther than this it renders LOD2 (~5%);
 *                between the two, LOD1 (~30%).
 *   LOD_HYSTERESIS — dead-band added on each side of both thresholds.
 *
 * NEAREST-EDGE METRIC (foreground-faceting bug fix): the tier is chosen from the
 * distance to the chunk's NEAREST edge (`centerDist − worldRadius`, clamped ≥ 0),
 * NOT its CENTER. Tiering by the center made a big chunk whose CENTER sat past
 * LOD_DIST_2 collapse its ENTIRE instance set — including trees only a few units
 * from the camera — to the faceted ultra-low LOD2 (the reported foreground bug).
 * With the near-edge metric a chunk stays MEDIUM (LOD1) as long as ANY of its trees
 * is near, and drops to ultra-low only once its NEAR edge is genuinely far.
 *
 * RETUNED for the near-edge metric: 7/14 (center) → 6/20 (nearest edge). A chunk
 * whose nearest tree is within LOD_DIST_2 = 20u renders LOD1 (medium); ultra-low
 * LOD2 (~5%) appears only once the chunk's near edge passes 20u — deep in the
 * FOG_NEAR=24…FOG_FAR=52 haze — then culled entirely at the ring (66). This RAISES
 * near/mid triangle count vs. the old center metric (more LOD1, less LOD2) — the
 * intended quality tradeoff; LOD_DIST_2 is the on-device fine-tune knob. Density
 * (centerDist) and the ring cull (nearestH) are SEPARATE and unchanged.
 */
const LOD_DIST_1 = 6;       // world units (nearest edge): nearer than this → full geometry
const LOD_DIST_2 = 20;      // world units (nearest edge): farther than this → LOD2; between → LOD1
const LOD_HYSTERESIS = 1.5; // world units: anti-flicker dead-band around each threshold

/**
 * ── MOBILE-ONLY: DYNAMIC FOLIAGE DENSITY BY LIVE CAMERA DISTANCE ──────────────
 * Art direction: "lower the foliage density all together" (a global foreground
 * reduction) AND "if 50 flowers are in the fog, show only ~10" (a hard thin in
 * the fog band, less still in deep fog). Foliage ONLY = eligible relief chunks
 * (`meta.lod != null` → trees / flowers / mushrooms / grass, the types present in
 * `lodGeometry`). Rocks / mountains / ground carry no LOD tiers and are UNTOUCHED.
 *
 * CRITICAL — the camera pans/translates FREELY, so density is driven by the LIVE
 * per-frame distance from the CAMERA to each chunk CENTER (`centerDist`, computed
 * once per chunk in the loop — the LOD swap tiers by the NEAREST edge instead),
 * NEVER a build-time / board-center distance. That makes
 * the fog-ring thinning CAMERA-RELATIVE: the thinned band tracks the camera as it
 * pans, so it always coincides with where the fog actually is. A build-time thin
 * would freeze the thin ring at a fixed world location and expose it the instant
 * the user panned away — exactly the bug this design avoids.
 *
 * Mechanism (ORTHOGONAL to — and composing with — the LOD geometry swap, the
 * opaque/fade material swap, and the ring cull): every foliage chunk's instances
 * were HASH-REORDERED at build time (forestChunking `orderByPositionHash`) so ANY
 * PREFIX is a spatially-even subset. Here we pick a keep-fraction by camera-
 * distance band and set `chunk.count = round(fullCount * keep)` — rendering that
 * spatially-even prefix. `chunk.count` is written ONLY when the band (tier)
 * changes (tracked per-chunk like the LOD `tier`) to avoid per-frame churn, and
 * set to the near-band keep fraction (DENSITY_BAND_KEEPS[0] = 0.65, a 35% reduction) when a chunk returns to the near band.
 * {@link selectForestDensityTier} applies ±DENSITY_HYSTERESIS so the count never
 * flickers at a band edge. Non-foliage chunks (`meta.lod === null`) are never
 * truncated.
 *
 * ── WHY THE BANDS SIT WHERE THEY DO (fog-metric correction + split steps) ──────
 * A density step is only invisible if the fog it hides behind is actually OPAQUE
 * at the distance the step fires. Two things previously broke that and made the
 * biggest cut pop in CLEAR AIR:
 *   1. METRIC MISMATCH. Density classifies by EUCLIDEAN `camPos.distanceTo(center)`
 *      but fog is linear in VIEW-SPACE DEPTH (`fogDepth ≈ 0.8 × distance` for the
 *      tilted-overhead camera — see the ring-cull note below). The ring cull
 *      already corrects this exact mismatch (FOREST_CULL_DISTANCE = FOG_FAR × 1.27
 *      so a culled chunk is provably fog=1.0); the density bands MUST too, or a
 *      band edge lands ~25% NEARER than the fog opacity it means to hide behind.
 *   2. ONE HUGE STEP AT THE FOG ONSET. A single 0.65→0.18 cut (3.6×) at ≈FOG_NEAR
 *      fired exactly where linear fog opacity is still 0 — maximally visible.
 * Fix: the bands are pushed out into fog-opaque space (mirroring the cull's ×1.27)
 * AND the one big cut is SPLIT into three gentle steps (≤~2.2× each), each landing
 * at progressively higher fog opacity so the haze grows into every cut. Anchored
 * to the fog band [FOG_NEAR=24, FOG_FAR=52] (GameScene) via the correction:
 *   • 36 → fogDepth≈29, fog opacity≈0.17 — first, SMALLEST cut 0.65→0.42 (1.55×)
 *   • 48 → fogDepth≈38, fog opacity≈0.51 — 0.42→0.22 (1.9×)
 *   • 58 → fogDepth≈46, fog opacity≈0.80 — LARGEST cut 0.22→0.10 (2.2×), well hazed
 * Keeping more foreground foliage at full count out to 36 barely costs anything:
 * any chunk whose NEAR edge is past LOD_DIST_2 (20) is already ~5%-detail LOD2.
 *
 * Tunable (the user live-tunes these):
 *   DENSITY_BAND_DISTS — ASCENDING euclidean camera-distance band edges (one per
 *       step); band count = length + 1. Pushed past ≈FOG_NEAR to sit in fog-opaque
 *       space (see above), never at the fog onset.
 *   DENSITY_BAND_KEEPS — nearest-first keep-fractions, one per band (length =
 *       DENSITY_BAND_DISTS.length + 1). Monotonically decreasing.
 *   DENSITY_HYSTERESIS — dead-band around each threshold (anti-flicker).
 */
const DENSITY_BAND_DISTS = [36, 48, 58] as const; // euclidean cam→center edges (fog-corrected)
const DENSITY_BAND_KEEPS = [0.65, 0.42, 0.22, 0.1] as const; // near / near-fog / fog / deep fog
const DENSITY_HYSTERESIS = 2; // world units: anti-flicker dead-band around each band edge

/**
 * ── MOBILE-ONLY: FULLY REMOVE far low-value foliage (per-type cull distance) ──
 * The camera-distance DENSITY system only THINS far foliage (down to the deepest
 * band's 10% keep). Several foliage types are small decorative ground props whose
 * geometry is pure waste once they are more than a couple of tables away, so we
 * remove them ENTIRELY (chunk count → 0) once the live camera→chunk-center distance
 * exceeds a PER-TYPE cull distance, and restore normal density when the camera
 * comes back inside. Trees + birch keep the unchanged density bands (never distance-
 * culled); ground/mountains/rocks are not foliage at all.
 *
 * TWO tiers, chosen by {@link foliageFarCullDist} from the chunk name (foliage-gated
 * — see below). Names verified against forest.mobile.glb, and every matched type
 * carries `_LOD1`/`_LOD2` tiers (so it is genuine foliage):
 *   SMALL (SMALL_FOLIAGE_CULL_DIST, closest) — tiny ground clutter that reads as a
 *     few pixels far out: grass (`PP_Grass_11/15_*`), mushrooms
 *     (`PP_Mushroom_Fantasy_{Purple,Orange}_*`), and the small ground FLOWERS
 *     hyacinth (`PP_Hyacinth_04_*`) + daffodil (`PP_Daffodil_03_*`). Flowers were
 *     the single biggest triangle bucket (hyacinth 1,796 tris×122, daffodil 848×97),
 *     so culling them close is the largest win.
 *   TALL (FLOWER_TALL_CULL_DIST, slightly farther) — sunflower (`PP_Sunflower_04_*`,
 *     1,554 tris×45) is TALLER and reads more as a landmark, so it is kept a bit
 *     longer than the ground clutter before it, too, is fully removed.
 *
 * FOLIAGE-GATE: the regexes are only ever tested on chunks that already carry LOD
 * tiers (`meta.lod != null` → foliage), so the ground floor types (meadow / path /
 * lake — matched by isForestGroundMesh, NO LOD) can never be caught even if a name
 * substring-matched; the lod-gate makes the foliage-vs-ground distinction bulletproof.
 *
 * TUNING vs FOG (GameScene FOG_NEAR=24 / FOG_FAR=52; fogDepth ≈ 0.8 × euclidean
 * distance for the tilted-overhead camera): at 26/40 euclidean the fog is light-to-
 * moderate (fogDepth ≈ 21 / 32), so the removal is only partly hidden by haze — but
 * these props are small on screen at that range, so the disappearance is subtle.
 * Raise the per-type dist toward fog-opaque space if any pop shows on-device, at the
 * cost of keeping low-value props a little longer. The change-tracked cull (see the
 * density loop) writes count only on the in↔out transition, and the hysteresis band
 * stops flip-flop as the camera drifts across the edge.
 */
const SMALL_FOLIAGE_RE = /grass|mushroom|hyacinth|daffodil/i; // tiny ground clutter + small flowers → closest cull
const SUNFLOWER_RE = /sunflower/i; // taller landmark flower → its own slightly-farther cull
const SMALL_FOLIAGE_CULL_DIST = 26; // world units (euclidean cam→chunk center): grass/mushroom/hyacinth/daffodil fully gone beyond this
const FLOWER_TALL_CULL_DIST = 40; // world units: sunflower (taller) kept a bit longer, then fully gone beyond this
const FOLIAGE_FAR_CULL_HYSTERESIS = 3; // world units: anti flip-flop dead-band at every foliage cull edge

/**
 * Per-type FAR-cull distance for a FOLIAGE chunk name, or null if the type is
 * never distance-culled (trees / birch). Callers MUST pass a name that is already
 * known to be foliage (a chunk with LOD tiers) — the ground floor types are
 * excluded upstream by the `lod != null` gate, so this need only route among the
 * foliage types. SMALL clutter + small flowers cull closest; sunflower gets the
 * slightly-farther TALL distance.
 */
function foliageFarCullDist(name: string): number | null {
  if (SMALL_FOLIAGE_RE.test(name)) return SMALL_FOLIAGE_CULL_DIST;
  if (SUNFLOWER_RE.test(name)) return FLOWER_TALL_CULL_DIST;
  return null;
}

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
 *       instances BEYOND this are thinned (ground is never thinned). 26 leaves the
 *       near/mid forest around the board untouched while starting the thin a touch
 *       closer than before (was 30).
 *   FOREST_THIN_KEEP     — fraction of FAR-ring TREE/FOLIAGE instances to keep
 *       (0<f≤1); ground is excluded entirely so the far terrain floor is never
 *       holed. 0.3 keeps 1 of every 3 far trees (keepEvery=round(1/0.3)=3). The
 *       far ring is now ALSO hazed to sky by the distance fog AND culled past the
 *       fog wall (FOREST_CULL_DISTANCE), so the three compound: the distant forest
 *       is cheap and reads as atmospheric depth rather than a hard thinned edge.
 *       Thinning is STATIC (no orbit pop); fog + cull are camera-relative and
 *       consistent. Set to 1.0 to DISABLE thinning entirely (chunking still
 *       applies) — one line: keepEvery collapses to 1.
 */
const FOREST_CHUNK_GRID = 10;
const FOREST_MIN_CHUNK_INSTANCES = 4;
const FOREST_MERGE_CELL_MIN = 1;
const FOREST_THIN_DISTANCE = 26;
const FOREST_THIN_KEEP = 0.3;

/**
 * ── MOBILE-ONLY: RING CULL BEYOND THE FOG WALL (the perf win) ─────────────────
 * The distance fog (GameScene FOG_* consts) fades far terrain to sky haze but the
 * chunks are still DRAWN — a hazed-but-rendered far ring still pays vertex +
 * (fully-opaque) fill cost. This ring cull hides any chunk whose NEAREST fragment
 * is beyond FOREST_CULL_DISTANCE, so the far ring past the fog wall is not drawn
 * at all. Because that nearest fragment is already fog=1.0 (fully hazed to the
 * sky) before the chunk is culled, the cut edge is INVISIBLE — no hole, unlike a
 * naive render-distance cull whose edge pops against clear geometry.
 *
 * METRIC vs FOG: the cull uses horizontal (XZ) nearest distance
 * ({@link horizontalNearestDistanceToBox}); fog uses view-space depth
 * (fogDepth = -mvPosition.z). For the tilted-overhead camera fogDepth ≈ 0.8 ×
 * horizontal for forward chunks, so culling AT FOG_FAR horizontal would leave a
 * chunk only ~80% fogged → a visible pop. We therefore set the cull ring BEYOND
 * fog-opaque — FOREST_CULL_DISTANCE ≈ FOG_FAR × 1.27 (66 vs 52) — so a chunk's
 * nearest fragment has fogDepth ≥ FOG_FAR (provably fog=1.0) before it is culled.
 * If a ring edge ever shows when orbiting/zooming, raise this multiplier.
 *
 * Chunks keep frustumCulled=true; this ring cull removes far IN-FRUSTUM chunks
 * that frustum culling alone cannot. Hysteresis stops flip-flop as the camera
 * orbits/pans across the ring boundary.
 */
const FOREST_CULL_DISTANCE = 66; // world units: hide a chunk once its nearest fragment is beyond this (≈ FOG_FAR × 1.27)
const FOREST_CULL_HYSTERESIS = 3; // world units: re-show only once back inside CULL − this (anti flip-flop)

/**
 * ── DEV-ONLY: forest chunk category classifier for the debug visibility panel ──
 * Maps a forest InstancedMesh's `.name` to one of the debug-toggle categories
 * via substring regex. The name is the RELIABLE identifier here: on mobile a
 * chunk's name is `${sourceTypeName}-chunkN` (set by `emitChunk` in
 * forestChunking.ts, derived straight from the source InstancedMesh's own
 * `.name`); on desktop the forest is never chunked, so the mesh keeps its bare
 * source name. Either way the regex still matches (the "-chunkN" suffix is
 * just extra trailing text a substring match ignores), so no chunker/userData
 * change is needed. Referenced ONLY from the DEV-gated effect below, so this
 * whole block is dead code (and tree-shaken) in production builds.
 */
const FOREST_DEBUG_CATEGORY_PATTERNS: readonly [ForestDebugCategory, RegExp][] = [
  ['trees', /tree|birch/i],
  ['mountains', /mountain/i],
  ['flowers', /hyacinth|daffodil|sunflower|flower/i],
  ['mushrooms', /mushroom/i],
  ['grass', /grass/i],
  ['rocks', /rock/i],
  ['ground', /meadow|path|lake/i],
];

/**
 * ── MOBILE-ONLY: which forest prop types CAST into the frozen shadow map ──────────
 * Trees + birch (the tall silhouettes that read as real cast shadows on the ground)
 * and rocks (a nice-to-have grounding cue). Tested on the SOURCE island-wide mesh
 * names BEFORE chunking, so castShadow propagates onto every rebuilt chunk (emitChunk
 * copies castShadow). Mountains are deliberately EXCLUDED — capturing them would need
 * a huge shadow-camera frustum (deferred). Ground never casts (it is the receiver).
 * Casting uses the highp MeshDepthMaterial (a separate program from the mediump beauty
 * material), so a caster foliage type stays mediump for its COLOR pass and is still
 * iOS-safe. Gated by MOBILE_FOREST_SHADOWS_ENABLED at the call site; desktop never casts.
 */
const FOREST_CASTER_RE = /tree|birch|rock/i;

/** Returns the matched debug category for a forest mesh name, or null if none match. */
function classifyForestDebugCategory(name: string): ForestDebugCategory | null {
  for (const [category, pattern] of FOREST_DEBUG_CATEGORY_PATTERNS) {
    if (pattern.test(name)) return category;
  }
  return null;
}

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
 * MOBILE GROUND-ONLY: inject ONLY the board-footprint poke-through clip — NO
 * near-camera dither-fade. Used for the forest GROUND/floor chunks so terrain that
 * humps up INSIDE the board's XZ footprint (above the board top) is discarded,
 * keeping the board slab clean, while the ground stays fully SOLID/opaque
 * everywhere else (no see-through fade). Mirrors {@link applyForestFade}'s
 * instancing-aware world-position computation but omits the Bayer fade discard.
 * Idempotent per material via its OWN guard flag (distinct from forestFadeApplied
 * so a ground clone is never mistaken for a fade clone).
 */
function applyForestBoardClip(material: THREE.Material): void {
  const mat = material as THREE.Material & { userData: { forestBoardClipApplied?: boolean } };
  if (mat.userData.forestBoardClipApplied) return;
  mat.userData.forestBoardClipApplied = true;

  const prevOnBeforeCompile = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prevOnBeforeCompile(shader, renderer);

    // VERTEX: instancing-aware world position → vWorldPos (see applyForestFade).
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */ `#include <common>
        varying vec3 vWorldPos;
      `,
    );
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

    // FRAGMENT header: varying + board-clip constants (NO Bayer — no fade here).
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `#include <common>
        varying vec3 vWorldPos;
        const float BOARD_CLIP_HALF  = ${BOARD_CLIP_HALF.toFixed(2)};
        const float BOARD_CLIP_TOP_Y = ${BOARD_CLIP_TOP_Y.toFixed(2)};
      `,
    );

    // Board-footprint poke-through clip ONLY (no near-camera fade discard).
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      /* glsl */ `
        {
          if (
            vWorldPos.x > -BOARD_CLIP_HALF && vWorldPos.x < BOARD_CLIP_HALF &&
            vWorldPos.z > -BOARD_CLIP_HALF && vWorldPos.z < BOARD_CLIP_HALF &&
            vWorldPos.y > BOARD_CLIP_TOP_Y
          ) discard;
        }
        #include <dithering_fragment>
      `,
    );
  };

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
  const mat = base.clone() as THREE.MeshStandardMaterial;
  (mat as THREE.MeshStandardMaterial).roughness = MOBILE_FOREST_ROUGHNESS;
  (mat as THREE.MeshStandardMaterial).metalness = 0.0;
  (mat as THREE.MeshStandardMaterial).envMapIntensity = MOBILE_FOREST_ENV_INTENSITY;
  applyForestFade(mat); // same fade + board-clip discard program as desktop
  // PRECISION (MOBILE_FOREST_SHADOWS_ENABLED): the forest is drawn ONCE under
  // shadowMap.enabled=true — the throwaway shadow-bake's beauty pass renders every
  // caster-layer object (forest included, so trees CAST) — which injects the shadow-
  // depth-unpack GLSL (~6e-8 constants) into THIS program; those underflow mediump so
  // the iOS/Metal compiler REJECTS it → INVISIBLE foliage (the on-device symptom). So
  // when the toggle is on we drop the mediump override → HIGHP (exactly like the
  // ground-clip receiver). Foliage still renders in the shadow-OFF pass 1b (it does NOT
  // receive shadows), but it must be highp so its shadow-VARIANT program stays valid on
  // iOS. Toggle OFF keeps the cheap mediump override (revert-identical).
  if (!MOBILE_FOREST_SHADOWS_ENABLED) injectMobileMediump(mat);
  // DISTINCT program cache key so the fade and opaque variants never collide on ONE
  // cached WebGLProgram (three's DEFAULT key = onBeforeCompile.toString(), and the fade
  // program has the near-camera dither + board-clip discard while the opaque one has
  // neither). three APPENDS this to its own key (instancing / lights / shadowMap.enabled
  // still vary independently). The 'highp'/'mediump' suffix tracks the precision so a
  // precision flip never re-uses a stale mediump-keyed program.
  mat.customProgramCacheKey = () =>
    MOBILE_FOREST_SHADOWS_ENABLED ? 'mobile-forest-fade-highp' : 'mobile-forest-fade-mediump';
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
  const mat = base.clone() as THREE.MeshStandardMaterial;
  (mat as THREE.MeshStandardMaterial).roughness = MOBILE_FOREST_ROUGHNESS;
  (mat as THREE.MeshStandardMaterial).metalness = 0.0;
  (mat as THREE.MeshStandardMaterial).envMapIntensity = MOBILE_FOREST_ENV_INTENSITY;
  // PRECISION (MOBILE_FOREST_SHADOWS_ENABLED): HIGHP for the same reason as the fade
  // material — this opaque program (rocks/mountains + far-tree swap target) is compiled
  // under shadowMap.enabled=true during the throwaway shadow bake, and a mediump
  // shadow-variant is iOS-rejected → invisible rocks/mountains. Drop the mediump
  // override when the toggle is on; keep it OFF for the revert path.
  if (!MOBILE_FOREST_SHADOWS_ENABLED) injectMobileMediump(mat);
  // Pin a CLEAN SOLID. This material's compiled program has NO `discard` at all (the
  // fade dither and the board-footprint clip are NEVER injected), so early-Z is fully
  // restored and the surface can never be seen through. It is the PERMANENT material for
  // the non-foliage terrain (mountains/rocks) as well as the far-tree opaque swap
  // target, so set the solid state EXPLICITLY rather than trusting the cloned base's
  // defaults: opaque, always depth-tested + depth-writing, no polygon offset.
  mat.transparent = false;
  mat.depthWrite = true;
  mat.depthTest = true;
  mat.polygonOffset = false;
  // DISTINCT program cache key (see buildMobileForestFadeMaterial) so the opaque variant
  // never shares the fade variant's cached program. The 'highp'/'mediump' suffix tracks
  // the precision so a precision flip never re-uses a stale mediump-keyed program.
  mat.customProgramCacheKey = () =>
    MOBILE_FOREST_SHADOWS_ENABLED ? 'mobile-forest-opaque-highp' : 'mobile-forest-opaque-mediump';
  mat.needsUpdate = true;
  return mat;
}

/**
 * MOBILE GROUND-ONLY material: OPAQUE + board-footprint clip ONLY (no near-camera
 * fade). Solid/depth-writing everywhere EXCEPT where terrain would poke up through
 * the board slab, where it discards. The clip IS a `discard`, so early-Z is defeated
 * for the ground program — but the discard only fires inside the small board
 * footprint and ground is low-overdraw floor geometry, so this is the accepted
 * trade to keep the board clean without making the ground see-through. Assigned
 * PERMANENTLY to ground chunks (never swapped by the per-frame loop, which only
 * manages foliage). Distinct program cache key from the fade + plain-opaque
 * variants so their compiled programs never collide.
 */
function buildMobileForestGroundClipMaterial(base: THREE.Material): THREE.Material {
  const mat = base.clone() as THREE.MeshStandardMaterial;
  (mat as THREE.MeshStandardMaterial).roughness = MOBILE_FOREST_ROUGHNESS;
  (mat as THREE.MeshStandardMaterial).metalness = 0.0;
  (mat as THREE.MeshStandardMaterial).envMapIntensity = MOBILE_FOREST_ENV_INTENSITY;
  applyForestBoardClip(mat); // board-clip discard ONLY — no fade
  // PRECISION: the ground is the terrain shadow RECEIVER. When MOBILE_FOREST_SHADOWS_
  // ENABLED it draws in the GROUND scene sub-pass with shadowMap.enabled=true, which
  // injects the shadow-depth-unpack GLSL (~6e-8 constants) into its program — those
  // UNDERFLOW mediump and iOS/Metal REJECTS the program (the invisible-forest bug). So
  // it MUST stay HIGHP here (three's default fragment precision) — we SKIP
  // injectMobileMediump. A material only needs highp to RECEIVE shadows; the ground
  // pays highp fill on the (low-overdraw) floor only, while the foliage/rocks keep
  // mediump (they don't receive). With the toggle OFF the ground never receives, so it
  // keeps the cheap mediump override (revert-identical). The 'highp'/'mediump' cache-key
  // suffix tracks this so a precision change never re-uses a stale cached program.
  if (!MOBILE_FOREST_SHADOWS_ENABLED) injectMobileMediump(mat);
  mat.transparent = false;
  mat.depthWrite = true;
  mat.depthTest = true;
  mat.polygonOffset = false;
  mat.customProgramCacheKey = () =>
    MOBILE_FOREST_SHADOWS_ENABLED
      ? 'mobile-forest-ground-clip-highp'
      : 'mobile-forest-ground-clip-mediump';
  mat.needsUpdate = true;
  return mat;
}

/**
 * DEV-ONLY LOD-tier tint material: the exact mobile fade+clip+mediump program
 * (so the near-tree see-through look and board clip still hold under the tint)
 * plus a solid `emissive` glow keyed to the geometry tier — used by the per-frame
 * loop when the debug "Forest LOD tint" toggle is ON so a dev can SEE which chunks
 * render which tier (green = LOD1 ~30%, red = LOD2 ~5%; full uses the untinted
 * fade material). Built ONLY under `import.meta.env.DEV` (see the useMemo), so this
 * helper and its two clones are tree-shaken out of production.
 */
function buildMobileForestTintMaterial(base: THREE.Material, emissive: THREE.ColorRepresentation): THREE.Material {
  const mat = buildMobileForestFadeMaterial(base) as THREE.MeshStandardMaterial;
  // emissive is added on top of lit color → an unambiguous flat tier color that
  // survives the low-poly shading. Own Color instance per clone (clone copies by
  // value), so setting one tint never bleeds into the other materials.
  mat.emissive = new THREE.Color(emissive);
  mat.needsUpdate = true;
  return mat;
}

/** Per-chunk cache for the mobile opaque/fade material swap (built once). */
interface ForestChunkMeta {
  mesh: THREE.InstancedMesh;
  /** World-space center of the chunk's INSTANCED bounding sphere (static after mount). */
  worldCenter: THREE.Vector3;
  /** World-space radius of that sphere (static after mount). */
  worldRadius: number;
  /**
   * World-space horizontal (XZ) AABB of the chunk's INSTANCED bounding box (static
   * after mount). Drives the ring cull via {@link horizontalNearestDistanceToBox}.
   */
  horizontalBox: ForestHorizontalBox;
  /**
   * Ring-cull visibility state WITH hysteresis (the per-frame loop's own record,
   * separate from `mesh.visible` so the DEV debug panel can AND with it). Starts
   * true (chunks are born visible until the first cull tick decides otherwise).
   */
  ringVisible: boolean;
  /**
   * True if the chunk's world sphere overlaps the board's ±BOARD_CLIP_HALF XZ
   * footprint. Such chunks MUST keep the poke-through clip no matter where the
   * camera is, so they are pinned to the fade material and never swapped.
   */
  needsBoardClip: boolean;
  /** Current material state (which variant `mesh.material` points at). */
  isOpaque: boolean;
  /**
   * Pre-created geometry tiers for the dynamic camera-distance LOD swap, or null
   * for NON-eligible types (mountains/ground — no `_LOD1`/`_LOD2`), which stay on
   * full geometry forever. Harvested from `mesh.userData.forestLod`.
   */
  lod: ForestChunkLod | null;
  /** Current LOD tier `mesh.geometry` points at (0 full / 1 LOD1 / 2 LOD2). */
  tier: ForestLodTier;
  /**
   * FULL instance count the chunk was BORN with (before any density truncation),
   * captured once at meta build. The per-frame density pass sets `mesh.count =
   * round(instanceCount * keep)` and applies the near-band keep fraction
   * (DENSITY_BAND_KEEPS[0] = 0.65) when the chunk returns to the near band.
   * Only FOLIAGE chunks (`lod != null`) are ever truncated; non-foliage chunks
   * keep `mesh.count === instanceCount` forever.
   */
  instanceCount: number;
  /**
   * Applied DENSITY tier (0 near / 1 fog / 2 deep) — the density twin of `tier`.
   * Initialised to -1 (a sentinel meaning "not yet applied") so the FIRST per-frame
   * evaluation always writes `mesh.count` for the chunk's real band. Only foliage
   * chunks (`lod != null`) ever leave -1.
   */
  densityTier: number;
  /**
   * PER-TYPE far-cull distance (world units, euclidean cam→center) beyond which
   * this FOLIAGE chunk is FULLY removed (count → 0), or null if it is never
   * distance-culled (trees / birch, and all non-foliage chunks). Resolved once at
   * build via {@link foliageFarCullDist} on a `lod != null` (foliage) chunk: 26 for
   * grass/mushroom/hyacinth/daffodil, 40 for the taller sunflower.
   */
  farCullDist: number | null;
  /**
   * Change-tracked state of the far-cull (the twin of `densityTier`): true while
   * this chunk is fully removed (count 0) because the camera is beyond
   * `farCullDist`. Written only on the in↔out transition so `mesh.count` is not
   * touched every frame. Always false for chunks with `farCullDist === null`.
   */
  farCulled: boolean;
  /**
   * DEV-ONLY: true while this chunk's material is the LOD-tier debug tint (green/
   * red), so the per-frame loop can RESTORE the normal fade/opaque material the
   * tick the tint toggle turns off. Always false (and never read) in production —
   * the tint branch that sets it is behind `import.meta.env.DEV`.
   */
  wasTinted: boolean;
}

/**
 * Build the static per-chunk metadata for the mobile opaque/fade material swap.
 *
 * Each chunk is an InstancedMesh; its bound MUST cover ALL of its instances, not
 * the single-instance geometry bound. `InstancedMesh.computeBoundingSphere()` /
 * `computeBoundingBox()` are instanced-aware (they iterate every instance transform
 * and union), so we call them here explicitly — the meta then never depends on when
 * `emitChunk` ran, on a stale/null cached bound, or on which geometry (full vs LOD)
 * the chunk ended up with. The bound is LOCAL to the chunk; the outer group
 * transform is fixed for the session, so we resolve `matrixWorld` (updateWorldMatrix)
 * and bake BOTH the sphere and the box into WORLD space once here. worldCenter/
 * worldRadius (sphere center transformed by matrixWorld, radius scaled by the max
 * world-scale axis, conservative) drive the opaque/fade swap; horizontalBox (the
 * box's world XZ min/max) drives the ring cull. An empty box also doubles as the
 * readiness signal (instances/matrixWorld not settled yet).
 *
 * Returns `null` if any chunk's world matrix is not ready yet (degenerate/empty
 * bound) so the caller can retry on a later frame rather than cache a wrong meta.
 * No per-frame allocation: the built vectors are reused in-place by `useFrame`.
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

    // Sphere → world (drives the opaque/fade swap, unchanged behavior).
    const worldCenter = new THREE.Vector3().copy(bs.center).applyMatrix4(mesh.matrixWorld);
    scale.setFromMatrixScale(mesh.matrixWorld);
    const worldRadius = bs.radius * Math.max(scale.x, scale.y, scale.z);

    // Box → world (drives the ring cull). Box3.applyMatrix4 transforms all 8
    // corners and re-expands to an axis-aligned box, so it is correct even under
    // the forest group's rotation (FOREST_ROT). matrixWorld already folds in the
    // outer group scale/position (updateWorldMatrix above), so min/max are TRUE
    // world coords. Clone first so the mesh's own cached boundingBox is untouched.
    const worldBox = bb.clone().applyMatrix4(mesh.matrixWorld);
    const horizontalBox: ForestHorizontalBox = {
      minX: worldBox.min.x,
      maxX: worldBox.max.x,
      minZ: worldBox.min.z,
      maxZ: worldBox.max.z,
    };

    // Conservative (box-of-sphere) overlap with the board's ±HALF world footprint.
    // Over-marking is safe (the chunk simply keeps the clip); under-marking would
    // let terrain poke through the board, so bias inclusive.
    const needsBoardClip =
      Math.abs(worldCenter.x) - worldRadius < BOARD_CLIP_HALF &&
      Math.abs(worldCenter.z) - worldRadius < BOARD_CLIP_HALF;

    // LOD tiers for the dynamic camera-distance swap (null → non-eligible, stays
    // full). The chunk is born full-detail, so it starts at tier 0.
    const lod = (mesh.userData as { forestLod?: ForestChunkLod }).forestLod ?? null;
    // Per-type FAR-cull distance for low-value foliage (grass/mushroom/hyacinth/
    // daffodil → 26u; sunflower → 40u; trees/birch → null). Gate on `lod` so only
    // actual foliage (LOD-tiered) is ever tagged — the ground floor types
    // (isForestGroundMesh, no LOD) are excluded even if a name substring-matched.
    const farCullDist = lod !== null ? foliageFarCullDist(mesh.name) : null;
    metas.push({
      mesh,
      worldCenter,
      worldRadius,
      horizontalBox,
      ringVisible: true,
      needsBoardClip,
      isOpaque: false,
      lod,
      tier: 0,
      // Chunk is born FULL (emitChunk copies every instance; the count is only
      // ever truncated per-frame below), so mesh.count here is the full count.
      instanceCount: mesh.count,
      densityTier: -1, // sentinel: first per-frame tick applies the real band
      farCullDist,
      farCulled: false,
      wasTinted: false,
    });
  }
  return metas;
}

const FOREST_URL = '/models/forest.glb';

/**
 * MOBILE-ONLY variant of the forest (`scripts/gen-forest-mobile.mjs`): the same
 * diorama with (A) EXT_meshopt_compression (smaller download, zero visual change;
 * the decoder is bundled in three-stdlib and auto-installed by drei's useGLTF, so
 * NO draco/decoder wiring is needed here) and (B) TWO decimated sibling meshes —
 * `<name>_LOD1` (~30%) and `<name>_LOD2` (~5%, ultra-low) — for every eligible
 * relief type, which this component harvests into per-type geometry tiers for the
 * runtime dynamic camera-distance LOD swap. Desktop keeps `forest.glb` byte-identical.
 */
const FOREST_URL_MOBILE = '/models/forest.mobile.glb';

/** Suffixes marking the two decimated LOD-tier sibling meshes in forest.mobile.glb. */
const LOD1_SUFFIX = '_LOD1';
const LOD2_SUFFIX = '_LOD2';

/**
 * ── MOBILE-ONLY: SMOOTH-SHADE THE GROUND (kill the faceted low-poly look) ─────
 * forest.mobile.glb bakes flat PER-FACE normals into the ground meshes (Meadow,
 * Grass, Meadow_Path, Lake_Ground — see {@link isForestGroundMesh}), which reads
 * as a faceted "low-poly" surface on the meadow/mud/lake floor. We recompute
 * AVERAGED (smooth) vertex normals on those ground geometries once at load —
 * same triangle count, ~0 fps cost — so the INTERIOR shading smooths out while
 * the SILHOUETTE stays exactly as faceted as the source geometry (normals don't
 * change vertex positions, only how each face is lit). FOLIAGE (trees, flowers,
 * mushrooms, grass foliage) and MOUNTAINS/ROCKS are never touched — only the
 * flat ground surface benefits from smoothing.
 */
const MOBILE_SMOOTH_TERRAIN = true; // smooth vertex normals on ground geoms (kills faceted low-poly shading); false = raw glb per-face normals
const MOBILE_FOREST_ROUGHNESS = 1.0; // fully matte forest/terrain — kills the plastic specular sheen the smoothed normals exposed
// ZERO env reflection on forest/terrain — kills the residual HDRI grazing sheen the
// user still saw at 0.08 (matte grass/dirt/rock). NOTE: this removes the ENV specular
// only; the KEY light's DIRECT specular lobe (Fresnel-boosted at grazing angles) can
// still add a faint edge sheen on the now-highp ground — if it shows on-device that is
// the next lever (kill the spec term), not this const. Applies to ALL forest materials.
const MOBILE_FOREST_ENV_INTENSITY = 0.0;

/**
 * ── MOBILE-ONLY: baked island-wide TOP-DOWN forest CONTACT-AO ground decal ────
 * A 1024² grayscale occlusion map baked (Blender, scripts/gen-forest-mobile-ao.mjs)
 * as a TOP-DOWN orthographic occluder-coverage render of the forest's trees/birch/
 * rocks, softened offline into a soft contact penumbra (1 = open clearing → no
 * change, ~0.25 = densest cluster). It adds grounding contact-shadow depth under
 * the tree/rock clusters onto the forest GROUND floor for the cost of ONE extra
 * texture tap folded into the ground clip material's EXISTING MeshStandard program
 * (mediump, or highp when MOBILE_FOREST_SHADOWS_ENABLED makes the ground a shadow
 * receiver) — NO new render pass / render target / draw call / transparency / SSAO /
 * per-frame shadow. Bound ONLY on mobile, by <ForestGroundAO> below; the desktop-
 * frozen forest.glb + materials never reference it.
 *
 * WHY A WORLD-XZ SAMPLER (not three's aoMap): the forest ground is GPU-instanced
 * (EXT_mesh_gpu_instancing), so every instance shares ONE geometry's UVs — there
 * is no per-instance lightmap UV like the city's TEXCOORD_1 aoMap. Instead the AO
 * is sampled by the fragment's WORLD XZ (reusing the vWorldPos varying the board-
 * clip already computes) mapped through the island's world bounds. The island is
 * centred at world origin, so islandMin = -islandSize/2; the texture is SQUARE and
 * the true world aspect (108.6 × 92.0) lives in islandSize, so [0,1]² sampling un-
 * stretches it. Loaded flipY=false so PNG row 0 (min.z) sits at v=0 → v maps
 * (worldZ - min.z)/sizeZ with no extra flip.
 *
 * iOS-SAFE (see the mediump/shadow gotcha): this only ADDS a plain `sampler2D` +
 * a `texture2D` tap + a `diffuseColor` multiply to the ground program. It introduces
 * NO shadow GLSL itself, NO new varying (vWorldPos already exists), and NO new
 * precision-sensitive compare — the UV is a subtract+scale of the SAME world position
 * the shipped board-clip already computes. (When the ground is a shadow receiver its
 * program is HIGHP anyway, so the shadow GLSL that DOES get injected is safe too.)
 */
const FOREST_AO_URL_MOBILE = '/images/forest.mobile.ao.webp';

/**
 * ── TUNABLES — how the baked forest-ground shadow map reads on the terrain ────────
 * The baked webp (forest.mobile.ao.webp) carries DIRECTIONAL SUN CAST-SHADOWS of the
 * trees/rocks (Cycles bake, sun dir matched to the KEY light [7,5.5,6]) plus contact
 * AO, as ONE grayscale map: 1.0 = open clearing (no darkening), down to ~0.25 in the
 * densest shadow cores. This is the STATIC tree-shadow-on-ground the game shows — no
 * shader shadow-map, no mediump landmine, ~0 fps (one texture tap + multiply on the
 * ground albedo).
 *
 * The bake's penumbra is SOFT (most shadowed ground is only light-gray ~0.6–0.85), so
 * on the matte terrain under the scene's ambient/env/grade lift the tree shadows read
 * FAINT at a flat 1.0 intensity. Two knobs deepen them so they clearly show:
 *
 *   FOREST_AO_CONTRAST — a gamma (pow) applied to the raw map BEFORE intensity. >1
 *     DEEPENS the soft mid/penumbra (e.g. 0.75 → 0.6 at 1.8) while leaving OPEN ground
 *     (1.0 → 1.0) untouched and pushing the dark cores darker — i.e. it makes the tree
 *     shadows READ without dimming the open clearing. This is the primary "show the
 *     shadows" lever. 1.0 = the raw bake (pre-existing look). Tune 1.4–2.4 on-device.
 *   FOREST_AO_INTENSITY — overall darkening scale AFTER the contrast: runtime factor =
 *     1 - (1 - shaped) * INTENSITY. 1.0 = full, lower = gentler globally. Raise toward
 *     1.3 for even stronger shadows (cores clamp to black), lower if too heavy.
 *
 * Both are MOBILE-ONLY (desktop forest never binds this map). Pure albedo multiply →
 * no shadow GLSL, mediump-safe, zero new pass/RT/draw-call.
 *
 * REAL-SHADOW INTERACTION (MOBILE_FOREST_SHADOWS_ENABLED): once the trees cast a REAL
 * directional shadow into the frozen shadow map that the ground RECEIVES, this baked
 * map must NOT also paint its own (soft, and possibly slightly-misaligned) tree shadow
 * on top — that would double-darken / ghost. So when real shadows are on we drop
 * FOREST_AO_INTENSITY to 0.3: the baked map then contributes only GENTLE ambient
 * occlusion / cluster grounding (which the directional cast shadow does not provide),
 * and the crisp directional tree shadows come entirely from the shadow map. With the
 * toggle OFF the baked map is the sole tree-shadow cue, so it stays at full 1.0.
 */
const FOREST_AO_CONTRAST = 2.2;
const FOREST_AO_INTENSITY = MOBILE_FOREST_SHADOWS_ENABLED ? 0.3 : 1.0;

/**
 * World-XZ → AO-UV mapping constants (world units). The island is centred at the
 * world origin, so islandMin = -islandSize/2. Emitted by the bake runner + meta
 * JSON at bake time — re-read them (npm run models:forest:ao) if forest.mobile.glb
 * is ever regenerated with a different crop/layout.
 */
const AO_ISLAND_MIN_X = -54.30967;
const AO_ISLAND_MIN_Z = -46.0;
const AO_ISLAND_SIZE_X = 108.61934;
const AO_ISLAND_SIZE_Z = 92.0;

/**
 * MOBILE GROUND-ONLY: fold the baked TOP-DOWN contact-AO decal into the forest
 * GROUND clip material as ONE extra world-XZ texture tap. Chains onto the material's
 * existing onBeforeCompile (board-clip + mediump), so it runs AFTER vWorldPos is
 * declared/computed and the mediump override is in place. The AO factor multiplies
 * the LINEAR albedo (diffuseColor) right after <color_fragment> — pre-lighting,
 * pre-fog — so tree/rock clusters read as a soft contact shadow on the clearing
 * floor. Idempotent per material (guard flag). See the block comment above for the
 * iOS-safety rationale (plain sampler + multiply, no new varying, no shadow GLSL).
 */
function applyForestGroundAo(material: THREE.Material, aoTex: THREE.Texture): void {
  const mat = material as THREE.Material & { userData: { forestGroundAoApplied?: boolean } };
  if (mat.userData.forestGroundAoApplied) return;
  mat.userData.forestGroundAoApplied = true;

  const prevOnBeforeCompile = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prevOnBeforeCompile(shader, renderer); // board-clip + mediump already chained

    // Bind the AO sampler as a custom uniform. three uploads uniforms added to
    // shader.uniforms in onBeforeCompile every frame; the value is a fixed texture
    // ref (never changes), so this is effectively static.
    shader.uniforms.uForestAoMap = { value: aoTex };

    // Declare the sampler on the always-present <common> include (the board-clip
    // chain replaced <common> with a string that STARTS with the same include, so
    // it is still present to match here).
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `#include <common>
        uniform sampler2D uForestAoMap;
      `,
    );

    // Multiply the AO factor into the LINEAR albedo right after <color_fragment>
    // (diffuseColor holds base albedo there; still linear, pre-lighting/tonemap/fog).
    // vWorldPos is the instancing-aware world position the board-clip chain set.
    // ClampToEdge (set on the texture) handles world positions just outside [0,1].
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
        {
          vec2 forestAoUv = vec2(
            (vWorldPos.x - (${AO_ISLAND_MIN_X.toFixed(5)})) / ${AO_ISLAND_SIZE_X.toFixed(5)},
            (vWorldPos.z - (${AO_ISLAND_MIN_Z.toFixed(5)})) / ${AO_ISLAND_SIZE_Z.toFixed(5)}
          );
          float forestAoRaw = texture2D(uForestAoMap, forestAoUv).r;
          // CONTRAST (gamma): deepen the soft baked penumbra so the tree cast-shadows
          // READ, while open ground (raw≈1.0 → 1.0) stays unchanged. Then INTENSITY
          // scales the overall darkening. clamp guards pow() against any >1 sample.
          float forestAoShaped = pow(clamp(forestAoRaw, 0.0, 1.0), ${FOREST_AO_CONTRAST.toFixed(3)});
          float forestAo = 1.0 - (1.0 - forestAoShaped) * ${FOREST_AO_INTENSITY.toFixed(3)};
          diffuseColor.rgb *= forestAo;
        }
      `,
    );
  };

  // DISTINCT program cache key so this AO variant compiles as its OWN program and
  // never collides with the plain ground-clip program (three APPENDS this to its
  // built-in instancing/lights/shadowMap key). The precision suffix MUST track the
  // ground material's precision (highp when MOBILE_FOREST_SHADOWS_ENABLED — the ground
  // is a shadow RECEIVER then, so it drops the mediump override) so a precision change
  // never re-uses a stale cached program.
  mat.customProgramCacheKey = () =>
    MOBILE_FOREST_SHADOWS_ENABLED
      ? 'mobile-forest-ground-clip-ao-highp'
      : 'mobile-forest-ground-clip-ao-mediump';
  mat.needsUpdate = true;
}

/**
 * MOBILE-ONLY child — binds the baked contact-AO decal onto the forest GROUND clip
 * material. Split into its own component (rather than loading inline in
 * ForestEnvironment) mirrors the repo's CityAO / BoardTiles / HdriSky splits:
 *
 *   1. HOOKS: useTexture SUSPENDS and cannot be called conditionally after the
 *      mobile/desktop fork; calling it unconditionally would fetch the AO on
 *      desktop. Mounting <ForestGroundAO> only when isMobile keeps the DESKTOP
 *      path hook-free (byte-identical) and the AO fetch never happens there.
 *   2. PERF-NEUTRAL: it receives the already-built `object` and just injects one
 *      sampler tap into the EXISTING shared ground material — NO new geometry /
 *      mesh / render pass / render target / draw call / transparency. Draw count
 *      is unchanged; the only one-time cost is a single extra program compile
 *      (ground-clip-with-AO), the same accepted cost as CityAO.
 *
 * Renders nothing. Suspends inside its own Suspense boundary (wrapped in
 * ForestEnvironment) so a slow/failed AO load can never blank the rest of the scene.
 */
function ForestGroundAO({ object }: { object: THREE.Object3D }): React.JSX.Element | null {
  // Grayscale WEBP via useTexture (no transcoder, no KTX2 transcode risk on iOS
  // Safari — mirrors CityAO). flipY=false + linear colorSpace set below.
  const aoTex = useTexture(FOREST_AO_URL_MOBILE);

  useLayoutEffect(() => {
    aoTex.colorSpace = THREE.NoColorSpace; // linear occlusion data, never sRGB
    aoTex.flipY = false; // PNG row 0 = min.z at v=0 (see the world-XZ mapping note)
    aoTex.wrapS = aoTex.wrapT = THREE.ClampToEdgeWrapping; // a decal must not tile
    aoTex.needsUpdate = true;

    // Inject the AO tap into the SHARED ground clip material (all ground/floor
    // chunks — meadow/path/lake — reference the same instance, so applyForestGroundAo
    // is idempotent). Foliage (fade/opaque) + non-ground chunks are never touched.
    object.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: only actual InstancedMeshes carry isInstancedMesh===true
      if (!im.isInstancedMesh) return;
      // FOLIAGE-FIRST guard (mirrors the material-assignment loop's `isFoliage`
      // branch): grass FOLIAGE chunks (PP_Grass_11/PP_Grass_15) carry `forestLod`
      // and were routed to the SHARED `forestFadeMat`, yet their names ALSO match
      // isForestGroundMesh (/grass/). Without this skip, applyForestGroundAo would
      // patch the shared fade material — hijacking its program cache key onto the
      // ground+AO key (a program collision) AND darkening the trees/flowers/grass
      // themselves instead of the floor beneath them. Only NON-foliage
      // meadow/path/lake (→ forestGroundClipMat) must receive the AO tap.
      if ((im.userData as { forestLod?: ForestChunkLod }).forestLod != null) return;
      if (!isForestGroundMesh(im.name)) return; // ground floor only (meadow/path/lake)
      const mat = Array.isArray(im.material) ? im.material[0] : im.material;
      applyForestGroundAo(mat, aoTex);
    });
  }, [object, aoTex]);

  return null;
}

/**
 * @param isMobile When true, the forest is rebuilt into frustum-cullable spatial
 *   chunks, the far ring is statically thinned, and eligible relief chunks carry
 *   `_LOD1`/`_LOD2` geometry tiers swapped DYNAMICALLY by camera distance at
 *   runtime (see forestChunking.ts + the per-frame loop below). When false/absent,
 *   the forest is byte-identical to the pre-experiment behavior.
 */
export function ForestEnvironment({ isMobile = false }: { isMobile?: boolean }): React.JSX.Element {
  // Mobile loads the meshopt-compressed + decimated variant (decoder is auto-
  // installed by useGLTF); desktop loads the plain forest.glb. drei caches per
  // url, so the two never collide.
  const url = isMobile ? FOREST_URL_MOBILE : FOREST_URL;
  const gltf = useGLTF(url);

  const { object, groupScale, mobileChunks, forestFadeMat, forestOpaqueMat, forestLodTintMats } =
    useMemo(() => {
    const scene = gltf.scene.clone(true);

    // MOBILE-ONLY: harvest BOTH decimated LOD-tier sibling meshes (`_LOD1` ~30%,
    // `_LOD2` ~5%) into a per-type lookup keyed by their base (full) mesh name,
    // then REMOVE them from the scene graph so they never render. They exist in
    // forest.mobile.glb solely to supply the chunker with the geometry tiers for
    // the runtime dynamic camera-distance LOD swap (below). Done before the
    // Box3/anchor computation so the (origin-placed) LOD meshes never skew bounds.
    const lodGeometry = new Map<
      string,
      { lod1?: THREE.BufferGeometry; lod2?: THREE.BufferGeometry }
    >();
    if (isMobile) {
      const lodObjects: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.name.endsWith(LOD1_SUFFIX) || o.name.endsWith(LOD2_SUFFIX)) lodObjects.push(o);
      });
      for (const o of lodObjects) {
        const mesh = o as THREE.Mesh;
        const isLod1 = o.name.endsWith(LOD1_SUFFIX);
        const base = o.name.slice(0, -(isLod1 ? LOD1_SUFFIX : LOD2_SUFFIX).length);
        const entry = lodGeometry.get(base) ?? {};
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: only actual meshes carry geometry
        if (mesh.geometry) {
          if (isLod1) entry.lod1 = mesh.geometry;
          else entry.lod2 = mesh.geometry;
          lodGeometry.set(base, entry);
        }
        o.removeFromParent();
      }
    }

    // Keep only types that carry BOTH tiers (every eligible relief type does; a
    // half-populated entry would be a generator bug — drop it so the chunker only
    // ever tags chunks with a complete {lod1, lod2} pair).
    const lodTiers = new Map<string, { lod1: THREE.BufferGeometry; lod2: THREE.BufferGeometry }>();
    for (const [name, e] of lodGeometry) {
      if (e.lod1 && e.lod2) lodTiers.set(name, { lod1: e.lod1, lod2: e.lod2 });
    }

    // MOBILE-ONLY: smooth-shade the GROUND surface (see MOBILE_SMOOTH_TERRAIN).
    // Runs ONCE here, on the SOURCE island-wide InstancedMeshes, BEFORE
    // rebuildForestAsChunks copies this geometry onto every spatial chunk — so
    // every chunk inherits the smoothed geometry for free. GROUND ONLY: skip
    // any type present in `lodTiers` (FOLIAGE — trees/flowers/mushrooms/grass;
    // mirrors the exact `lodGeometry?.has(im.name)` isFoliage test forestChunking
    // uses internally) and skip anything that isn't `isForestGroundMesh`
    // (mountains/rocks). Desktop (forest.glb, patched in place elsewhere) never
    // enters this branch — geometry there is untouched, byte-identical.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- MOBILE_SMOOTH_TERRAIN is a documented tuning constant meant to be toggled; the branch is intentional
    if (isMobile && MOBILE_SMOOTH_TERRAIN) {
      scene.traverse((o) => {
        const im = o as THREE.InstancedMesh;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: o is Object3D; only actual InstancedMeshes have isInstancedMesh===true
        if (!im.isInstancedMesh) return;
        if (lodTiers.has(im.name)) return; // foliage — never smoothed (LOD-tiered types)
        if (!isForestGroundMesh(im.name)) return; // ground only (meadow/path/lake)
        const g = im.geometry;
        g.deleteAttribute('normal'); // drop baked per-face normals so the weld keys on position/uv/color, not normals
        const smoothed = mergeVertices(g); // weld coincident verts (returns a NEW indexed geometry)
        smoothed.computeVertexNormals(); // averaged => smooth shading
        smoothed.computeBoundingBox();
        smoothed.computeBoundingSphere();
        g.dispose(); // free the old geometry
        im.geometry = smoothed;
      });
    }

    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: o is Object3D; only actual meshes have isMesh===true
      if (m.isMesh) {
        m.receiveShadow = true; // ground receives the frozen tree/board/city shadow (foliage inert: no shadow GLSL in its mediump program)
        // MOBILE (MOBILE_FOREST_SHADOWS_ENABLED): trees/birch + rocks CAST into the
        // frozen one-shot shadow map so their shadows land on the terrain ground. This
        // is iOS-safe because CASTING uses the highp MeshDepthMaterial (a separate
        // program from the mediump beauty material that must NOT compile under
        // shadowMap.enabled) — so a caster foliage type stays mediump for its COLOR
        // pass. The bake is DEPTH-ONLY (see MobileCrispBoardPipeline) so no mediump
        // beauty material is ever compiled under shadow injection. Ground never casts
        // (it is the RECEIVER); mountains are excluded (huge frustum — deferred). The
        // caster-signature re-bake in the pipeline notices the castShadow count jump
        // when these chunks mount and re-fires the bake to capture them.
        //
        // DESKTOP + toggle-OFF: `false` — identical to the desktop default (byte-
        // identical) and the pre-feature mobile path. rebuildForestAsChunks copies
        // castShadow onto every rebuilt chunk, so chunks inherit this per-type.
        m.castShadow =
          isMobile && MOBILE_FOREST_SHADOWS_ENABLED && FOREST_CASTER_RE.test(m.name);
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
    // DEV-ONLY: the two LOD-tier tint materials (green LOD1 / red LOD2). Built
    // below only under import.meta.env.DEV → null (and tree-shaken) in production.
    let forestLodTintMats: { lod1: THREE.Material; lod2: THREE.Material } | null = null;
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
        lodGeometry: lodTiers,
      });

      // Collect the freshly-built chunk InstancedMeshes and build the two swap
      // materials once (cloned from the single shared base every chunk points at).
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
        // GROUND-ONLY clip material (opaque + board-clip, no fade). Local to this
        // build — only the assignment loop below uses it; the per-frame loop never
        // touches ground (non-foliage), so the material lives on via the chunk in
        // the scene graph and needs no return/ref.
        const forestGroundClipMat = buildMobileForestGroundClipMaterial(base);
        // Assign the chunk material PER CHUNK BY TYPE — three-way split so the
        // mobile see-through / dissolve is FOLIAGE-ONLY and the board stays clean:
        //   FOLIAGE (carries LOD tiers → trees/birch/flowers/mushrooms/grass) →
        //     the fade+clip material (near-camera dither-fade + board-footprint
        //     clip). Behaves EXACTLY as before: the per-frame loop still swaps
        //     these to the plain-opaque variant beyond the fade range (early-Z
        //     win) and back to fade when they re-enter.
        //   GROUND/FLOOR (isForestGroundMesh: meadow/path/lake — NON-foliage) →
        //     the OPAQUE + board-CLIP material PERMANENTLY. Solid everywhere,
        //     except it discards terrain that pokes up inside the board footprint
        //     so no ground hump shows through the board. No near-camera fade →
        //     never see-through.
        //   MOUNTAINS + ROCKS (non-ground, non-foliage) → the discard-free plain
        //     OPAQUE material PERMANENTLY: fully solid, early-Z restored, no clip
        //     (they ring the terrain far outside the board footprint).
        // The per-frame loop NEVER reassigns any NON-foliage chunk (guarded by
        // `!meta.lod`), so ground keeps its clip material and mountains/rocks keep
        // the plain opaque material regardless of camera distance.
        // Foliage predicate = `userData.forestLod != null` (set by the chunker only
        // for types present in `lodTiers`), the SAME source of truth `meta.lod`
        // uses below; the grass FOLIAGE type carries LOD, so the isFoliage check
        // FIRST correctly routes it to fade even though isForestGroundMesh also
        // matches "grass" — only meadow/path/lake reach the ground branch.
        for (const c of chunks) {
          const isFoliage = (c.userData as { forestLod?: ForestChunkLod }).forestLod != null;
          if (isFoliage) {
            c.material = forestFadeMat;
          } else if (isForestGroundMesh(c.name)) {
            c.material = forestGroundClipMat;
            // SHADOW RECEIVER: move the terrain ground onto its OWN layer so the
            // pipeline draws it in a shadowMap.enabled=true sub-pass (highp, receives
            // the real tree/board/city shadows) SEPARATELY from the mediump foliage/
            // rocks drawn shadows-off — the split that keeps the iOS/Metal compiler from
            // ever seeing a mediump material under shadow injection. layers.set()
            // disables layer 0, so the ground draws ONLY in the ground sub-pass. Toggle
            // off → stays on layer 0 (single pass, revert-identical).
            if (MOBILE_FOREST_SHADOWS_ENABLED) c.layers.set(FOREST_GROUND_LAYER);
          } else {
            c.material = forestOpaqueMat;
          }
        }
        mobileChunks = chunks;
        // DEV-ONLY LOD-tier tint materials (green LOD1 / red LOD2), built once
        // from the pristine base. Behind import.meta.env.DEV so this block and
        // buildMobileForestTintMaterial are tree-shaken out of production.
        if (import.meta.env.DEV) {
          forestLodTintMats = {
            lod1: buildMobileForestTintMaterial(base, 0x00b000), // green = LOD1 (~30%)
            lod2: buildMobileForestTintMaterial(base, 0xc00000), // red = LOD2 (~5%)
          };
        }
      }
    }

    // Recenter x/z at origin (+ optional pan) and place the CENTER surface at
    // local 0 so the outer group drops it precisely onto FOREST_Y.
    scene.position.set(
      -center.x + FOREST_PAN_X / groupScale,
      -centerSurfaceY,
      -center.z + FOREST_PAN_Z / groupScale,
    );

    return { object: scene, groupScale, mobileChunks, forestFadeMat, forestOpaqueMat, forestLodTintMats };
  }, [gltf, isMobile]);

  // ── DEV-ONLY: debug visibility wiring (see src/dev/debugVisibility.ts) ────────
  // Applies the master `wholeForest` flag AND each mesh's classified
  // sub-category flag as a `.visible` override. Runs ONCE per `object` (this
  // covers BOTH desktop — one island-wide InstancedMesh per source type — and
  // mobile — many `${type}-chunkN` meshes; classification works identically on
  // either since it only substring-matches the name), then re-applies on every
  // flag toggle via `subscribeDebugVisibility`. No per-frame cost — only fires
  // on tap. `.visible` is otherwise ALWAYS true for these meshes (the far-opaque
  // swap only reassigns `.material`, never `.visible`), so this is the sole
  // writer and never fights the existing per-frame LOD/material logic. Entirely
  // gated behind `import.meta.env.DEV`; tree-shaken out of production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const entries: { mesh: THREE.Mesh; category: ForestDebugCategory | null }[] = [];
    object.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: o is Object3D; only actual InstancedMeshes have isInstancedMesh===true
      if (!im.isInstancedMesh) return;
      entries.push({ mesh: im, category: classifyForestDebugCategory(im.name) });
    });

    const apply = () => {
      const flags = getDebugVisibility();
      for (const { mesh, category } of entries) {
        const debugVisible = flags.wholeForest && (category === null || flags[category]);
        // Record the debug decision so the per-frame ring cull (the OTHER
        // mesh.visible writer, on mobile) can AND with it instead of clobbering
        // it. Both writers converge within one throttled cull tick (~50ms).
        (mesh.userData as { forestDebugVisible?: boolean }).forestDebugVisible = debugVisible;
        mesh.visible = debugVisible;
      }
    };
    apply();
    const unsubscribe = subscribeDebugVisibility(apply);
    return () => {
      unsubscribe();
      // Defensive: restore full visibility so a stale hidden flag can never
      // linger if `object` is reused/unmounted mid-toggle (HMR safety net).
      for (const { mesh } of entries) mesh.visible = true;
    };
  }, [object]);

  // ── MOBILE-ONLY per-frame chunk pass: RING CULL + DYNAMIC LOD + opaque/fade swap ──
  // ONE throttled (~20x/s) camera-distance loop drives three independent per-chunk
  // decisions off a single camera position (no second loop, no allocation):
  //   (0) RING CULL beyond the fog wall — hide a chunk (`mesh.visible=false`) once
  //       its NEAREST fragment is past FOREST_CULL_DISTANCE (with hysteresis), then
  //       `continue` to skip the LOD/material work for hidden chunks. The cut edge
  //       is already fog=1.0 (hazed to sky), so no hole shows. This is the perf win.
  //   (1) DYNAMIC LOD — for eligible relief chunks, pick full/LOD1/LOD2 by the
  //       chunk's distance to the CAMERA (with hysteresis, so no boundary flicker)
  //       and swap `chunk.geometry` only when the tier changes. Camera-relative,
  //       so near chunks are always full detail and far ones low-poly wherever the
  //       free-roam camera flies. Non-eligible chunks (no tiers) are left full.
  //   (2) OPAQUE/FADE material swap (non-board chunks only) — flip to the
  //       discard-free opaque material once the nearest fragment is beyond the fade
  //       range (early-Z can then cull it) and back when it re-enters.
  // Off-screen chunks are ALSO handled by three's frustum culling (frustumCulled=true
  // on every chunk); the ring cull removes far IN-FRUSTUM chunks frustum culling
  // cannot. Desktop early-returns (no chunks). Chunk world bounds are static, so they
  // are cached on the first valid frame; the loop does only distance math + compares
  // (no allocation). See the cull/swap/LOD threshold notes above.
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

    // DEV-ONLY: is the LOD-tier tint toggle on? Short-circuits on the compile-time
    // `false` in production, so getLodTintEnabled is never called and the import is
    // tree-shaken. Read once per throttled tick (cheap) and reused for every chunk.
    const lodTintOn = import.meta.env.DEV && forestLodTintMats !== null && getLodTintEnabled();

    const camPos = state.camera.position;
    const metas = store.metas;
    for (const meta of metas) {
      // (0) RING CULL beyond the fog wall. Horizontal (XZ) nearest distance to the
      // chunk's world AABB, with hysteresis so the boundary doesn't flip-flop as
      // the camera orbits. A hidden chunk's nearest fragment is past
      // FOREST_CULL_DISTANCE (≈ FOG_FAR × 1.27) → already fog=1.0 → its cut edge is
      // invisible (no hole). `continue` skips the LOD/material work below.
      const nearestH = horizontalNearestDistanceToBox(camPos.x, camPos.z, meta.horizontalBox);
      if (meta.ringVisible) {
        if (nearestH > FOREST_CULL_DISTANCE) meta.ringVisible = false;
      } else if (nearestH < FOREST_CULL_DISTANCE - FOREST_CULL_HYSTERESIS) {
        meta.ringVisible = true;
      }
      if (import.meta.env.DEV) {
        // Reconcile with the DEV debug-visibility panel (the other mesh.visible
        // writer): a chunk shows only if BOTH the ring AND the debug flags allow
        // it. Tree-shaken in production, where the ring is the sole writer.
        const debugVisible =
          (meta.mesh.userData as { forestDebugVisible?: boolean }).forestDebugVisible ?? true;
        meta.mesh.visible = meta.ringVisible && debugVisible;
      } else {
        meta.mesh.visible = meta.ringVisible;
      }
      if (!meta.ringVisible) continue;

      // NON-FOLIAGE chunks (ground/meadow, mountains, rocks — no LOD tiers, so
      // `meta.lod === null`) are PERMANENTLY on the discard-free OPAQUE material
      // (assigned once at build). They are SOLID: no fade, no board-clip, no
      // LOD/density thinning, and — crucially — the loop must NEVER swap them back
      // to a `discard` material. Ring cull already ran above; skip ALL remaining
      // per-chunk work (LOD/density/DEV-tint/opaque-swap) so nothing can reassign
      // their material. This is the early-Z (overdraw) win: solid terrain writes
      // depth and culls hidden fragments instead of overdrawing under a `discard`.
      if (!meta.lod) continue;

      // Distance camera → chunk CENTER, computed ONCE. Used by the DENSITY band
      // (which classifies by center) and as the basis for `nearest` below.
      const centerDist = camPos.distanceTo(meta.worldCenter);
      // Distance camera → the chunk's NEAREST possible fragment (its bounding-
      // sphere near edge), computed ONCE and reused by BOTH the LOD tier swap and
      // the opaque/fade swap. Clamped ≥ 0 so a camera INSIDE the sphere reads 0
      // (never negative). LOD is tiered by THIS, not centerDist: a large chunk
      // whose center is far but whose near edge is close keeps its near trees at
      // MEDIUM detail instead of collapsing them to faceted ultra-low LOD2.
      const nearest = Math.max(0, centerDist - meta.worldRadius);

      // (1) DYNAMIC LOD tier swap. FOLIAGE ONLY — non-foliage chunks already
      // `continue`d above (`!meta.lod`), so `meta.lod` is guaranteed non-null here.
      // By the camera → NEAREST-EDGE distance with hysteresis (NOT the chunk center
      // — see the LOD_DIST_* note above; center-tiering faceted foreground trees
      // inside big chunks); only reassign `geometry` when the tier actually changes.
      // The InstancedMesh instances/instanceMatrix are untouched — this is a ref
      // swap between already-uploaded geometries (no GPU re-upload). Applies to
      // needsBoardClip chunks too (LOD is independent of the material / board-clip
      // discard, which every tier's shader still performs).
      const next = selectForestLodTier(
        meta.tier,
        nearest,
        LOD_DIST_1,
        LOD_DIST_2,
        LOD_HYSTERESIS,
      );
      if (next !== meta.tier) {
        meta.tier = next;
        meta.mesh.geometry =
          next === 0 ? meta.lod.full : next === 1 ? meta.lod.lod1 : meta.lod.lod2;
      }

      // (1c-cull) Low-value foliage full removal, at a PER-TYPE distance
      // (`meta.farCullDist`: 26u grass/mushroom/hyacinth/daffodil, 40u sunflower;
      // null = trees/birch, never culled). Beyond that distance these props are
      // small on screen and worthless, so remove them ENTIRELY (count → 0) rather
      // than thin them to 10%. Change-tracked via `farCulled` (with a hysteresis
      // band) so `mesh.count` is only written on the in↔out transition — no per-
      // frame churn. Uses the same live `centerDist` the density bands use. count=0
      // composes cleanly with the ring cull (mesh.visible), the material swap, and
      // the LOD geometry swap — all orthogonal to instance count — so nothing fights
      // it. On re-entry we reset `densityTier` to the -1 sentinel so the density
      // block below re-applies the correct band the same tick. NOTE: opaque swap and
      // cull both `continue` before this only for non-foliage / ring-culled chunks,
      // so a culled foliage chunk still runs the (skipped-write) density check + swap
      // harmlessly.
      if (meta.farCullDist !== null) {
        if (!meta.farCulled && centerDist > meta.farCullDist) {
          meta.farCulled = true;
          meta.mesh.count = 0;
          meta.densityTier = -1; // force a fresh density write when it returns
        } else if (
          meta.farCulled &&
          centerDist < meta.farCullDist - FOLIAGE_FAR_CULL_HYSTERESIS
        ) {
          meta.farCulled = false; // fall through → density re-applies (tier is -1)
        }
      }

      // (1c) DYNAMIC DENSITY by LIVE camera distance (foliage only). Pick a
      // keep-fraction band with hysteresis and truncate `mesh.count` to render a
      // spatially-even PREFIX of the hash-reordered instances (four bands: 65% /
      // 42% / 22% / 10%, stepping down as fog opacity rises — see DENSITY_BAND_*).
      // Camera-relative, so the thinned fog ring tracks the free-roam camera as
      // it pans. Written only when the band CHANGES (no per-frame churn); the
      // near band applies the 0.65 near keep (a 35% reduction, not full). SKIPPED
      // while a chunk is far-culled (count pinned at 0) so the count-0 state is not
      // overwritten; on re-entry `densityTier === -1` guarantees this writes the
      // real band immediately.
      if (!meta.farCulled) {
        const nextDensity = selectForestDensityTier(
          meta.densityTier, // sentinel -1 (not-yet-applied) → treated as band 0 inside
          centerDist,
          DENSITY_BAND_DISTS,
          DENSITY_HYSTERESIS,
        );
        if (nextDensity !== meta.densityTier) {
          meta.densityTier = nextDensity;
          const keep = densityKeepForTier(nextDensity, DENSITY_BAND_KEEPS);
          meta.mesh.count = Math.round(meta.instanceCount * keep);
        }
      }

      // (1b) DEV-ONLY LOD-tier TINT overlay. When the debug toggle is ON, paint the
      // chunk by the tier it's rendering (full = untinted fade, LOD1 = green, LOD2 =
      // red) so a dev can SEE the dynamic LOD tracking the camera. Reached by
      // FOLIAGE chunks only — non-foliage (mountains/ground/rocks, no LOD tiers)
      // already `continue`d above (`!meta.lod`), so they stay on the permanent
      // opaque material and are never tinted (nor faded). This REPLACES the
      // opaque/fade swap while on, so `continue` past it; the tick the toggle turns
      // off, restore the fade material (board chunks keep it; others fall through to
      // re-evaluate opaque/fade). Entirely behind import.meta.env.DEV → tree-shaken
      // (with forestLodTintMats) in production.
      if (import.meta.env.DEV && forestLodTintMats) {
        if (lodTintOn) {
          const tintTier = meta.tier;
          meta.mesh.material =
            tintTier === 0
              ? forestFadeMat
              : tintTier === 1
                ? forestLodTintMats.lod1
                : forestLodTintMats.lod2;
          meta.isOpaque = false;
          meta.wasTinted = true;
          continue;
        } else if (meta.wasTinted) {
          meta.mesh.material = forestFadeMat;
          meta.isOpaque = false;
          meta.wasTinted = false;
          // fall through to the normal opaque/fade swap below
        }
      }

      // (2) Opaque/fade material swap — UNCHANGED: reuses the `nearest` edge
      // distance computed once above (distance to the chunk's nearest possible
      // fragment via the bounding sphere), so the swap boundary/look is exactly as
      // before; no pop. The ≥ 0 clamp on `nearest` leaves this identical:
      // FOREST_OPAQUE_ENTER/EXIT are both positive, so a formerly-negative value
      // (camera inside the sphere) and a clamped 0 take the same branches. Near-
      // board chunks stay on fade+clip forever.
      if (meta.needsBoardClip) continue;
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
      {/* MOBILE-ONLY: bind the baked contact-AO decal onto the forest GROUND clip
          material. Rendered only when isMobile so useTexture never fetches on
          desktop and the desktop material path stays byte-identical. Own Suspense
          boundary so a slow/failed AO load can never blank the rest of the scene. */}
      {isMobile && (
        <Suspense fallback={null}>
          <ForestGroundAO object={object} />
        </Suspense>
      )}
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
// Kick the AO webp fetch in parallel with the mobile forest glb (mobile only) so it
// is usually cached by the time <ForestGroundAO> mounts. Desktop never fetches it.
if (preloadMobileForest) useTexture.preload(FOREST_AO_URL_MOBILE);
