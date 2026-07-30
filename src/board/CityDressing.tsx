import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { CITY_LAYER } from './positions';
import { getDebugVisibility, subscribeDebugVisibility } from '../dev/debugVisibility';

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
 *   CITY_SCALE / CITY_HEIGHT_SCALE — MOBILE-ONLY extra multipliers layered on
 *                TOP of the auto-fit footprint scale above, to fix a
 *                perceived scale mismatch (the character dwarfed the
 *                buildings). CITY_SCALE grows the XZ footprint; CITY_HEIGHT_
 *                SCALE additionally stretches Y for an "elongated skyscraper"
 *                look. See the const block below for why CITY_SCALE is kept
 *                near 1.0 (footprint headroom is only ~3% before spilling onto
 *                the tile ring) while CITY_HEIGHT_SCALE carries the emphasis.
 *                Desktop never reads these two consts — byte-identical.
 */

// The clear inner square (inside the tile ring) is CORNER=0.134 deep on each
// side → its edge sits at world ±(0.5-0.134)*10 = ±3.66. DESKTOP uses a
// non-uniform per-axis scale to fill both edges of the non-square ~300×260
// footprint; MOBILE has the STRAND/FLEET board-edge third cropped away, leaving a
// rectangular ~300×180 remainder (aspect ~1.67) that STILL carries its floor, roads
// and big buildings — the crop is a per-triangle / per-instance Z clip, not a coarse
// whole-node drop (see gen-city-mobile.mjs step 1b). MOBILE also uses a PER-AXIS
// (non-uniform) scale, same as desktop, so the remainder fills BOTH the X and Z
// edges of the board center — rectangular distortion is accepted to eliminate
// empty strips (see the runtime fit below for why this differs from an earlier,
// stale draft of this comment that assumed a uniform long-axis scale). Y scale is
// tied to the horizontal (X) fit to avoid vertical distortion.
//
// MOBILE FIT SOURCE DATA (measured from public/models/city.mobile.glb via a
// temp @gltf-transform/core script; script deleted after use — see git history /
// task notes for the raw numbers): the runtime THREE.Box3 full bounds (X≈[-30,270]
// size 300, Z≈[-150,30] size 180) are INFLATED on some edges by a thin, near-ZERO-
// density sparse fringe:
//   • Z-min (the STRAND/FLEET CUT edge, world +X post-BOARD_ROTATION): vertex count
//     is ~0 from raw Z=-150 down to ≈-143 — this lands almost exactly on
//     gen-city-mobile.mjs's Z_CUT=-143, confirming it's the per-triangle floor/road
//     CLIP OVERHANG (a triangle is kept whole if its centroid is on the kept side,
//     so a few triangles whose centroid barely clears Z_CUT still carry a vertex
//     past it) — verified flat (Y ≤ 0.78), i.e. a floor/road sliver, not a building.
//   • X-min (the PALL MALL/WHITEHALL/BOW edge, world -Z post-rotation → screen TOP):
//     a similar near-zero span from X=-30 to ≈-22 (natural low-density corner
//     taper, not crop-related) before density resumes.
//   • The opposite edges (X-max/BOTTOM, Z-max/LEFT) are less hollow but still carry
//     a thinner tail than the near/cut edges — X-max tail is short low-rise
//     buildings (Y ≤ ~13.6); Z-max tail includes one moderately tall building
//     reaching Y≈24.8, so it is trimmed more gently (see CITY_TRIM_PCT) to avoid
//     visibly clipping it.
// Fitting the plain (inflated) Box3 — correct for desktop, which has no such
// fringe — left MOBILE's actual dense/visible content short of the target
// half-extent by a DIFFERENT amount per edge (0.53–0.82 world units at the old
// CITY_FILL_HALF=3.55), which reads as the reported asymmetric green gaps, worst
// on the TOP and RIGHT/cut edges. Raising CITY_FILL_HALF_MOBILE alone would NOT
// fix this (it scales the gap up proportionally along with everything else) — the
// fix is to compute the fit denominator (recenter + scale) from a PERCENTILE-
// TRIMMED bound that excludes just that sparse fringe, so the dense/visible edge
// of the city — not its inflated bbox edge — is what reaches CITY_FILL_HALF_MOBILE.
// See gatherAxisSamples/percentileOf and the isMobile branch in the fit useMemo.
const CITY_FILL_HALF = 3.55;         // DESKTOP target half-extent (X/Z) — UNCHANGED, byte-identical.
const CITY_FILL_HALF_MOBILE = 3.45;  // MOBILE-ONLY target half-extent — pulled in from the ±3.66
                                      // tile-ring edge to leave margin; city + ~0.2-0.4u fringe
                                      // overhang stay off the printed tiles.
const CITY_TRIM_PCT = 0.005;         // MOBILE-ONLY: per-axis percentile (0.5%) trimmed off EACH end
                                      // before computing the fit recenter/scale, to exclude the thin
                                      // sparse fringe above without cutting into real building mass —
                                      // chosen to land right at the measured true-void edge (see the
                                      // const-block comment above). Desktop never reads this.
const CITY_PAN_X = 0;         // world-X fine-tune (post-scale); 0 = fit-centered on origin. On
                               // mobile the fit below already recenters on the TRIMMED dense-content
                               // midpoint (a data-driven substitute for a manual pan), so this stays
                               // 0; raise it only if a real-device check still shows residual drift.
const CITY_PAN_Z = 0;         // world-Z fine-tune (post-scale); same note as CITY_PAN_X.
const CITY_Y = 0.02;          // rest the city ground on the board top (TOP_Y)
const CITY_Y_LIFT = 0.08;     // mobile-only: lift city off board surface to prevent z-fight
const CITY_ROT = 0;           // radians; nudge to aim streets toward the camera

// MOBILE-ONLY extra scale multipliers, layered on top of the auto-fit scale
// (scaleX/scaleY/scaleZ below) to fix a scale-read problem: the player
// character dwarfed the city, so the buildings needed to grow — especially
// taller, for an "elongated skyscraper" silhouette that towers over the token.
//
// CITY_SCALE (XZ, footprint) is kept at 1.0: the auto-fit above already sets
// mobile's dense-content half-extent to CITY_FILL_HALF_MOBILE=3.64, deliberately
// just inside the ±3.66 tile-ring edge (see file header) — only ~0.5% headroom
// remains before the DENSE content spills onto the printed tiles, and the
// measurement notes above already show some of the excluded sparse fringe
// (thin floor slivers / short buildings) lands slightly PAST 3.66 at this
// target. Growing XZ further is NOT safe to do blindly — it would push both the
// dense content and that fringe further out. If more footprint growth is wanted
// later, raise CITY_SCALE only after re-measuring (see gatherAxisSamples) and
// re-checking every edge against the tile ring, not just the long axis.
//
// CITY_HEIGHT_SCALE stretches Y on top of CITY_SCALE (effective Y multiplier
// = CITY_SCALE * CITY_HEIGHT_SCALE = 2.2), which is unconstrained by the board
// footprint (buildings just grow up into open sky), so it can be freely tuned.
// Raised 1.6 → 2.2 to elongate the cropped city remainder into a taller,
// more dramatic skyline that towers over the player token.
//
// Base-anchor note: the recenter above (scene.position.set(-center.x,
// -box.min.y, -center.z)) already places the city's lowest vertex at this
// group's local Y=0 *before* the group's own scale/rotation/position are
// applied. Scaling a point whose local Y is exactly 0 leaves it at 0
// (sx*0=0), and a Y-axis rotation doesn't touch the Y component either — so
// the group's own `position.y` (CITY_Y (+ CITY_Y_LIFT on mobile)) is the
// FINAL world Y of the city's base no matter what CITY_SCALE/CITY_HEIGHT_SCALE
// are set to. No position.y compensation is needed when tuning these two.
const CITY_SCALE = 1.0;
const CITY_HEIGHT_SCALE = 2.2;

// ── MOBILE-ONLY: cut-edge grass strip ───────────────────────────────────────
// The STRAND/FLEET crop (gen-city-mobile.mjs Z_CUT=-143) removed the city's
// authored perimeter grass border ALONG WITH that edge's low-rise buildings —
// so the mobile city now shows bare gray floor/road right up to the printed
// tile ring on that one side, while the other 3 (uncropped) sides still carry
// their intact green landscaped border. This adds a matching green strip,
// mobile-only, purely at runtime (no glb regen).
//
// MEASURED (via a temp @gltf-transform/core script against public/models/
// city.glb — registers EXT_mesh_gpu_instancing, reads instance transforms +
// UVs; script deleted after use, see task notes / PR description for the raw
// numbers):
//   • COLOR: the perimeter grass ground tiles (mesh "Plane.166", 69 instances,
//     20×20 model units each, laid flush along the model's outer edges — e.g.
//     a full-length single-tile-deep row along the model X-min/X-max edges,
//     and originally along Z-min too before the crop) all sample the SAME UV
//     rect (u 0.857–0.907, v 0.066–0.116) of the "Natures" material's atlas
//     texture. The average pixel color of that rect is RGB(129,183,52) =
//     #81b734 — a medium olive-green, matching the swatch visible in the
//     border/bushes on the 3 intact sides.
//   • WIDTH: those border tiles are ONE tile deep (20 raw model units) along
//     the edges they run — the same depth the (removed) Z-min row used to be.
//   • Runtime fit position: by construction of the mobile fit above, the
//     city's DENSE-content edge always lands at EXACTLY ±CITY_FILL_HALF_MOBILE
//     in this group's own local space (that's what the fit computes it to),
//     regardless of the exact runtime trim numbers — so the new strip's
//     position is expressed directly in that same local space (see the nested
//     inverse-scale group below), not re-derived from trimHalfZ.
//
// CUT_GRASS_OUTER / CUT_GRASS_DEPTH / CUT_GRASS_HALF_WIDTH are in the SAME
// "group-local" units as CITY_FILL_HALF_MOBILE (world units at the final fit
// scale, before BOARD_ROTATION). TUNABLE:
const CUT_GRASS_COLOR = '#81b734'; // measured Natures-atlas grass green (see above)
const CUT_GRASS_OUTER = 3.6;       // outer edge of the strip — kept just inside the
                                    // ±3.66 tile-ring edge (CORNER=0.134 → (0.5-0.134)*10)
                                    // with a 0.06 safety margin, same margin philosophy as
                                    // CITY_FILL_HALF_MOBILE=3.45 vs the ring.
const CUT_GRASS_DEPTH = 0.5;       // depth of the strip (perpendicular to the cut edge).
                                    // Inner edge = CUT_GRASS_OUTER - CUT_GRASS_DEPTH = 3.1,
                                    // i.e. it overlaps ~0.35u back INTO the dense-fill
                                    // boundary (3.45) to blend with/hide the existing bare
                                    // floor there with margin — that overlap zone is
                                    // confirmed floor-only (no buildings): the crop's Z_CUT
                                    // sits in a verified empty gap between the kept downtown
                                    // (raw Z ≥ ~-137) and the removed low-rise strip (raw Z ≤
                                    // ~-166), so nothing real is covered.
const CUT_GRASS_HALF_WIDTH = 3.6;  // half-width along the cut edge — matches CUT_GRASS_OUTER
                                    // so the strip's corners meet the intact perpendicular
                                    // borders on the other 2 sides with no gap, while staying
                                    // inside the tile ring.
const CUT_GRASS_Y_OFFSET = 0.015;  // small lift above the city's own ground plane (which
                                    // sits at this group's local y=0) to avoid z-fighting
                                    // with the floor mesh directly beneath it — on top of
                                    // CITY_Y_LIFT already lifting the whole city off the board.

const CITY_URL = '/models/city.glb';

// MOBILE-ONLY variant: the same city collapsed to ~2 draws / 1 material / 1
// atlas texture (~24 MB VRAM vs desktop's ~92 MB), generated by
// scripts/gen-city-mobile.mjs. It is draco-compressed, so it needs the
// self-hosted decoder in /public/draco/. Desktop keeps the plain, decoder-free
// city.glb byte-identical. Same buildings/UVs/floor/roads, minus the STRAND/FLEET
// board-edge third (mobile-only per-triangle Z crop — see gen-city-mobile.mjs
// step 1b).
const CITY_URL_MOBILE = '/models/city.mobile.glb';
const DRACO_PATH = '/draco/';

/**
 * MOBILE-ONLY helper: one traversal of the cloned scene's real (post-uninstance)
 * geometry, collecting every vertex's WORLD-SPACE x/z into two flat typed arrays.
 * Only x/z are gathered — y (ground anchoring) intentionally keeps using the
 * plain Box3.min.y computed by the caller, since the sparse fringe this exists to
 * exclude is a HORIZONTAL (per-edge) phenomenon, not a vertical one (the ground
 * plane's lowest vertex is consistent with or without the fringe — see the
 * CITY_TRIM_PCT comment above for the measured Y check). Never called on
 * desktop (isMobile gates the call site), so desktop pays zero cost for this.
 */
function gatherAxisSamples(scene: THREE.Object3D): { xs: Float32Array; zs: Float32Array } {
  scene.updateMatrixWorld(true);
  let total = 0;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: `o` is Object3D; only actual meshes have isMesh===true
    if (m.isMesh) {
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (pos) total += pos.count;
    }
  });

  const xs = new Float32Array(total);
  const zs = new Float32Array(total);
  const v = new THREE.Vector3();
  let i = 0;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above
    if (m.isMesh) {
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!pos) return;
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld);
        xs[i] = v.x;
        zs[i] = v.z;
        i++;
      }
    }
  });
  return { xs, zs };
}

/**
 * Value at percentile `p` (0..1) of an ALREADY-SORTED-ASCENDING typed array.
 * Pure/allocation-free; caller owns the sort (see gatherAxisSamples call site —
 * sorted once per axis with an explicit numeric comparator, since a bare
 * `TypedArray.prototype.sort()` IS numeric-ascending by spec but an explicit
 * comparator removes any doubt on every JS engine this ships to).
 */
function percentileOf(sorted: Float32Array, p: number): number {
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * @param isMobile When true, city meshes are frustum-cullable (their instanced
 *   bounds are LOCAL and compact in the board center, so three culls them when
 *   they leave the view — e.g. looking at empty sky). When false/absent the
 *   desktop path is byte-identical to before (frustumCulled stays false).
 */
export function CityDressing({ isMobile = false }: { isMobile?: boolean }): React.JSX.Element {
  // Mobile loads the atlased+joined draco variant (needs the self-hosted draco
  // decoder); desktop loads the plain city.glb with no decoder. drei's useGLTF
  // caches per-url, so the two paths never collide.
  const url = isMobile ? CITY_URL_MOBILE : CITY_URL;
  const gltf = useGLTF(url, isMobile ? DRACO_PATH : undefined);

  // Clone the cached scene so recenter/scale never mutates drei's shared cache.
  const { object, groupScale } = useMemo(() => {
    const scene = gltf.scene.clone(true);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      // `m.isMesh` is the cross-realm-safe three.js duck-type check. The cast
      // above asserts Mesh, so the type-checker sees isMesh as always true — but
      // at runtime `o` is a generic Object3D and only real meshes carry it.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: `o` is Object3D; only actual meshes have isMesh===true
      if (m.isMesh) {
        // DESKTOP: city meshes don't cast (removes ~103 shadow-pass draw calls).
        // MOBILE: the low golden sun's shadows are BAKED ONCE into a frozen map
        // (autoUpdate off — see MobileCrispBoardPipeline), so the city's cast is a
        // single load-time cost, not a per-frame one — enable it so the city throws
        // its long dramatic shadow across the board. receiveShadow stays on so the
        // board/city/token shadows still fall on the city. Desktop → byte-identical.
        m.castShadow = isMobile;
        m.receiveShadow = true;
        // MOBILE-ONLY frustum culling. The city's instanced-mesh bounds are LOCAL
        // and compact (it fits the board's inner square in the center), so an
        // off-screen view — e.g. the camera pitched up at empty sky — culls the
        // whole city (~263K tris). Desktop stays false → byte-identical.
        m.frustumCulled = isMobile;

        // All 69 city materials are authored with alphaMode BLEND (even though
        // their baseColor alpha is 1.0). BLEND disables depth-write, causing
        // buildings to render translucent — you see roads/geometry through walls.
        // Force every material fully opaque + depth-writing to fix that.
        // FrontSide (backface culling) is left on — city meshes have correct
        // outward-facing normals, so culling backfaces halves fragment work
        // with no visible holes.
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const std = mat as THREE.MeshStandardMaterial;
          std.transparent = false;
          std.opacity = 1;
          std.depthWrite = true;
          std.alphaTest = 0;
          std.side = THREE.FrontSide;
          std.needsUpdate = true;
        }
      }
    });

    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // MOBILE-ONLY: percentile-trimmed fit bounds (see the CITY_TRIM_PCT const-
    // block comment for the measured full-bbox-vs-dense-content analysis this is
    // based on). Defaults to the plain bbox center/half-extents so DESKTOP is
    // completely unaffected (isMobile gates the extra pass — desktop never
    // allocates or sorts the sample arrays below).
    let trimCenterX = center.x;
    let trimCenterZ = center.z;
    let trimHalfX = size.x / 2;
    let trimHalfZ = size.z / 2;
    if (isMobile) {
      const { xs, zs } = gatherAxisSamples(scene);
      xs.sort((a, b) => a - b);
      zs.sort((a, b) => a - b);
      const trimMinX = percentileOf(xs, CITY_TRIM_PCT);
      const trimMaxX = percentileOf(xs, 1 - CITY_TRIM_PCT);
      const trimMinZ = percentileOf(zs, CITY_TRIM_PCT);
      const trimMaxZ = percentileOf(zs, 1 - CITY_TRIM_PCT);
      trimCenterX = (trimMinX + trimMaxX) / 2;
      trimCenterZ = (trimMinZ + trimMaxZ) / 2;
      trimHalfX = (trimMaxX - trimMinX) / 2;
      trimHalfZ = (trimMaxZ - trimMinZ) / 2;
    }

    // Recenter horizontally: DESKTOP at the plain bbox center (trimCenterX/Z ===
    // center.x/z when isMobile is false → byte-identical). MOBILE at the trimmed
    // dense-content center, which is what actually removes the asymmetric gap —
    // a data-driven substitute for a manual CITY_PAN nudge (see const block).
    // Drop Y-min (ground) to local 0 from the FULL untrimmed box either way (the
    // ground plane's lowest vertex is unaffected by the horizontal trim) so the
    // outer group can place the ground precisely at CITY_Y.
    scene.position.set(-trimCenterX, -box.min.y, -trimCenterZ);

    // Compute per-axis half-extents from the recentered footprint (DESKTOP fit
    // denominator — the plain, untrimmed bbox half-extents. Unchanged.)
    const halfX = size.x / 2;
    const halfZ = size.z / 2;

    // DESKTOP: scale each axis independently to fill the inner square target
    // half-extent (the desktop city is a non-square rectangle, so per-axis fill
    // stretches it to fill both edges). Y is tied to X to avoid vertical
    // distortion. Byte-identical to before on desktop.
    const scaleX = CITY_FILL_HALF / (halfX || 1);
    const scaleZ = CITY_FILL_HALF / (halfZ || 1);
    const scaleY = scaleX;

    // MOBILE: the mobile glb has the STRAND/FLEET board-edge third cropped away by
    // a per-triangle / per-instance Z clip (floor, roads and big buildings on the
    // kept side RETAINED), leaving a rectangular ~300×180 remainder (aspect ~1.67 —
    // see scripts/gen-city-mobile.mjs step 1b). A PER-AXIS fit stretches the rectangle
    // to fill both the X and Z axes of the board center independently, accepting
    // rectangular distortion to eliminate empty strips: each axis is scaled to fill
    // exactly CITY_FILL_HALF_MOBILE, using the TRIMMED half-extents above (not the
    // inflated full-bbox ones) so the DENSE/visible content — not the sparse
    // fringe — is what reaches the target. Y is tied to the X scale (not Z) to
    // preserve vertical height and avoid distorting tower proportions. CITY_SCALE
    // (XZ) and CITY_HEIGHT_SCALE (extra Y) layer on top — see the const block.
    // Desktop reads scaleX/scaleY/scaleZ unmodified.
    const finalScaleX = isMobile ? (CITY_FILL_HALF_MOBILE / (trimHalfX || 1)) * CITY_SCALE : scaleX;
    const finalScaleZ = isMobile ? (CITY_FILL_HALF_MOBILE / (trimHalfZ || 1)) * CITY_SCALE : scaleZ;
    const finalScaleY = isMobile
      ? (CITY_FILL_HALF_MOBILE / (trimHalfX || 1)) * CITY_SCALE * CITY_HEIGHT_SCALE
      : scaleY;

    return { object: scene, groupScale: [finalScaleX, finalScaleY, finalScaleZ] };
  }, [gltf, isMobile]);

  // DEV-ONLY: city debug-visibility toggle (see src/dev/debugVisibility.ts).
  // Subscribes to the shared debug flags and flips the outer group's
  // `.visible` on toggle. No per-frame cost — only fires on tap. Entirely
  // gated behind `import.meta.env.DEV`; tree-shaken out of production builds.
  const groupRef = useRef<THREE.Group>(null);
  // MOBILE-ONLY: ref for the new cut-edge grass strip mesh (see const block
  // above) — needed so the layer-assignment effect below can put it on
  // CITY_LAYER alongside the rest of the city. Always null on desktop (the
  // mesh is never rendered there).
  const grassRef = useRef<THREE.Mesh>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const apply = () => {
      if (groupRef.current) groupRef.current.visible = getDebugVisibility().city;
    };
    apply();
    return subscribeDebugVisibility(apply);
  }, [object]);

  // MOBILE ONLY: put EVERY city object on CITY_LAYER so the mobile pipeline can
  // render the city in its own reduced-dpr pass (camera.layers = {CITY_LAYER})
  // while the dpr-2 scene pass (camera on layer 0) and the native board pass both
  // EXCLUDE it. This MUST traverse the whole subtree, not just the wrapper group:
  // three's projectObject reads each object's OWN `layers.test(camera.layers)` to
  // decide renderability and does NOT inherit a parent's layer (only visible=false
  // prunes children), so setting the group alone would leave the meshes on layer 0.
  // `layers.set` REPLACES the mask (exclusive membership), so on mobile every city
  // object leaves layer 0 → the scene pass no longer draws the city. On desktop the
  // target is 0 (three.js default) → byte-identical, and desktop never gates layers
  // anyway. useLayoutEffect (not passive) so layers are set before the pipeline's
  // first useFrame. Keyed to [isMobile, object] so a resize/orientation flip or a
  // scene re-clone re-homes every object correctly.
  useLayoutEffect(() => {
    const target = isMobile ? CITY_LAYER : 0;
    object.traverse((o) => o.layers.set(target));
    groupRef.current?.layers.set(target);
    // MOBILE-ONLY: the grass strip mesh isn't part of `object`'s subtree (it's
    // a sibling JSX <mesh>, only ever mounted when isMobile), so it needs its
    // own layer assignment — see the CITY_LAYER comment in positions.ts for
    // why layers don't inherit from a parent.
    grassRef.current?.layers.set(target);
  }, [isMobile, object]);

  return (
    <group
      ref={groupRef}
      name="city-center"
      position={[CITY_PAN_X, CITY_Y + (isMobile ? CITY_Y_LIFT : 0), CITY_PAN_Z]}
      rotation={[0, CITY_ROT, 0]}
      scale={groupScale as [number, number, number] | number}
    >
      <primitive object={object} />
      {isMobile && (
        // MOBILE-ONLY: inverse-scale wrapper. The outer group's `scale` prop
        // (groupScale, non-uniform per axis) is what maps the city's
        // recentered local geometry onto the CITY_FILL_HALF_MOBILE-sized
        // footprint — but it would ALSO distort a strip authored directly in
        // final/target units (like CUT_GRASS_OUTER above) if placed straight
        // inside the outer group. Dividing by the same groupScale here cancels
        // it out exactly, so children of THIS group can be positioned/sized in
        // plain final world-scale units (matching CITY_FILL_HALF_MOBILE etc.)
        // with no extra math. Nesting inside groupRef (rather than a separate
        // sibling group) also means the DEV city-visibility toggle still
        // hides/shows the strip along with the rest of the city.
        <group scale={[1 / groupScale[0], 1 / groupScale[1], 1 / groupScale[2]]}>
          <mesh
            ref={grassRef}
            name="city-cut-edge-grass"
            // Cut edge is at local z = -CITY_FILL_HALF_MOBILE (maps to world
            // +X post-BOARD_ROTATION — see gen-city-mobile.mjs's axis-binding
            // derivation). The strip is centered between its inner and outer
            // bounds, both negative (same side as the cut).
            position={[0, CUT_GRASS_Y_OFFSET, -(CUT_GRASS_OUTER + (CUT_GRASS_OUTER - CUT_GRASS_DEPTH)) / 2]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
            frustumCulled={isMobile}
          >
            <planeGeometry args={[CUT_GRASS_HALF_WIDTH * 2, CUT_GRASS_DEPTH]} />
            <meshStandardMaterial color={CUT_GRASS_COLOR} roughness={0.69} metalness={0} />
          </mesh>
        </group>
      )}
    </group>
  );
}

// Preload the SAME variant the component will actually load. useIsMobile keys off
// `(max-width: 768px), (max-height: 600px)`; mirror that synchronously here (this
// runs at module import, before any component renders) so mobile preloads the
// draco variant + decoder and desktop preloads the plain glb. Guard for SSR/jsdom
// where matchMedia is absent (defaults to the desktop path).
const preloadMobile =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(max-width: 768px), (max-height: 600px)').matches;
if (preloadMobile) {
  useGLTF.preload(CITY_URL_MOBILE, DRACO_PATH);
} else {
  useGLTF.preload(CITY_URL);
}
