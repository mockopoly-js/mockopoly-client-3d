import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF, useTexture } from '@react-three/drei';
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
 *   BUILDING_Y_MIN — MOBILE-ONLY world-Y threshold (in the pre-recenter clone's
 *                raw space) above which geometry counts as "building" rather
 *                than flat floor/road/plaza. Used by computeBuildingBBoxXZ to
 *                fit/center the mobile city on its BUILDING footprint instead
 *                of the full (floor-edge-defined) bbox — see that function's
 *                doc comment. Desktop never reads it — byte-identical.
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
// MOBILE FIT SOURCE DATA — HISTORICAL NOTE: an earlier build of
// gen-city-mobile.mjs left a thin, near-zero-density sparse fringe on the
// runtime Box3 (most visibly a floor/road CLIP OVERHANG on the STRAND/FLEET
// cut edge, a few triangles whose centroid barely cleared Z_CUT but still
// carried a vertex past it). Fitting the plain bbox back then under-filled the
// dense/visible content by a different amount per edge, reading as uneven
// green gaps — the fix at the time was a per-axis PERCENTILE TRIM of the
// vertex bounds (see git history) to exclude just that fringe before
// recentering/scaling.
// THAT FRINGE IS GONE: gen-city-mobile.mjs's edge-third crop now requires an
// instance's MIN Z (not just its center) to clear Z_CUT, and the per-triangle
// clip on plain nodes uses each triangle's own centroid with zero source
// triangles straddling Z_CUT (verified in the generator) — so the cut edge
// ends CLEANLY at Z_CUT with no overhang. The runtime Box3 is therefore clean
// on every edge — but that's not the whole story: the FULL bbox is defined by
// the floor/road slab's own edge, and on the cut (STRAND/FLEET) side that slab
// still runs out to Z_CUT while the BUILDINGS near that edge were entirely
// removed by the crop, so the nearest surviving building sits well back from
// Z_CUT — a real geometry feature, not fringe/noise. Fitting the plain bbox
// therefore under-fills the cut side's visible BUILDING content (reads as a
// wider, uneven grass gap on that side only). The fix is a SECOND,
// building-only bbox (vertices whose world Y clears BUILDING_Y_MIN — floor/
// road excluded — see BUILDING_Y_MIN and computeBuildingBBoxXZ below) that
// MOBILE recenters/fits on INSTEAD of the plain bbox; DESKTOP is untouched and
// keeps using the plain bbox exactly as before. See the isMobile branch in the
// fit useMemo below.
const CITY_FILL_HALF = 3.55;         // DESKTOP target half-extent (X/Z) — UNCHANGED, byte-identical.

// ── MOBILE-ONLY: full grass square dressing ─────────────────────────────────
// Design (replaces an earlier per-edge "cut-edge grass strip" attempt, which
// left a bare-gray gap between the city floor and the strip on the STRAND/
// FLEET cut edge, and needed per-edge measurement/patching): instead, render
// ONE green grass SQUARE filling the whole board-center clearing, then fit the
// cropped city — ALSO stretched to a SQUARE — centered on top of it, so every
// side (including the cut edge) gets the SAME even grass BAND automatically.
// The cut edge stops being a special case at all: it's just city floor sitting
// on the grass plate like the other 3 sides.
//   GRASS_HALF — half-extent of the grass square (world units, group-local,
//     before BOARD_ROTATION), kept just inside the ±3.66 tile-ring edge so it
//     never covers the printed tiles.
//   BAND — the even grass-band width wanted on all 4 sides between the
//     (square) city footprint and the grass square's edge.
//   CITY_FILL_HALF_MOBILE = GRASS_HALF - BAND — the city's mobile fit target
//     half-extent is DERIVED from the two above, not set independently: the
//     MOBILE city is recentered on its BUILDING-bbox center (floor/road
//     excluded — see BUILDING_Y_MIN / computeBuildingBBoxXZ / the isMobile
//     branch below) and the grass square is centered on the SAME group-local
//     origin (CITY_PAN_X/Z = 0 for both), so a BUILDING footprint of
//     half-extent (GRASS_HALF - BAND) centered inside a grass square of
//     half-extent GRASS_HALF leaves EXACTLY a BAND-wide margin around the
//     BUILDINGS on every side, by construction — including the former cut
//     edge, where the floor/road slab (which still reaches past its nearest
//     building — see above) is now expected to fill part of that margin with
//     sidewalk gray instead of green on that one side — no per-edge
//     measurement needed.
const GRASS_HALF = 3.6;    // half-extent of the grass square — 0.06 inside the ±3.66 tile-ring edge.
const BAND = 0.35;         // even green border width between the city footprint and the grass edge.
const GRASS_COLOR = '#81b734'; // measured avg color of the city's own perimeter grass ground tiles
                                // (mesh "Plane.166" in city.glb; UV rect u 0.857-0.907, v 0.066-0.116
                                // of the "Natures" atlas texture) — RGB(129,183,52) — so the added
                                // square matches the green already used on the city's intact borders.
const GRASS_Y_OFFSET = -0.005; // hair BELOW the city's own ground plane (this group's local y=0) so
                                // the city floor/roads sit ON TOP of the grass square with no z-fight.

const CITY_FILL_HALF_MOBILE = GRASS_HALF - BAND; // MOBILE-ONLY target half-extent (both axes — see
                                      // the isMobile fit below) — the city footprint SQUARE that sits
                                      // centered inside the grass square, leaving an even BAND margin.

// MOBILE-ONLY: world Y (in the cloned scene's raw, un-recentered space — the
// SAME space the full Box3 below is measured in) above which the city's
// geometry counts as "building" (walls/roofs/towers) rather than flat floor/
// road/plaza. Measured empirically off the actual city.mobile.glb: a
// per-vertex world-Y histogram shows the floor/road mass concentrated in
// Y ∈ [-0.17, 1) (a dense spike at [0, 1) — the floor PLUS every building's
// own ground-floor base, which also starts at Y≈0), then a smooth, continuous
// decay through Y ≈ 32.5 (genuine building heights — there's no isolated gap
// to auto-detect, so this is a picked threshold, not a computed valley). 1.0
// sits just above the floor/base cluster while staying comfortably below
// every building's first story, and the resulting building-only X/Z bbox is
// STABLE across the whole Y ∈ [1, 2] range (verified empirically — nudging
// the threshold anywhere in that band doesn't move the footprint at all), so
// this isn't a knife-edge value. Used by computeBuildingBBoxXZ below.
const BUILDING_Y_MIN = 1.0;

const CITY_PAN_X = 0;         // world-X fine-tune (post-scale); 0 = fit-centered on origin. Desktop
                               // recenters on the FULL bbox center; mobile recenters on the BUILDING
                               // bbox center (see BUILDING_Y_MIN / computeBuildingBBoxXZ / the fit
                               // useMemo below) — both stay 0; raise only if a real-device check
                               // still shows residual drift.
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
// mobile's BUILDING-bbox half-extent (floor/road excluded — see
// BUILDING_Y_MIN / computeBuildingBBoxXZ / the isMobile branch below) to
// CITY_FILL_HALF_MOBILE (= GRASS_HALF - BAND, ~3.25 — see the full-grass-square
// const block above), deliberately inside the ±3.66 tile-ring edge with room
// left for both the even BAND margin AND the grass square's own 0.06 margin to
// the ring. Growing XZ further is NOT safe to do blindly — it would push the
// fitted content further out, eating into BAND (or the ring). If more
// footprint growth is wanted later, raise CITY_SCALE only after re-checking
// every edge against BAND/the ring.
//
// CITY_HEIGHT_SCALE stretches Y on top of CITY_SCALE (effective Y multiplier
// = CITY_SCALE * CITY_HEIGHT_SCALE = 2.2), which is unconstrained by the board
// footprint (buildings just grow up into open sky), so it can be freely tuned.
// Raised 1.6 → 2.2 to elongate the cropped city remainder into a taller,
// more dramatic skyline that towers over the player token.
//
// Base-anchor note: the recenter in the fit useMemo below
// (scene.position.set(-cx, -box.min.y, -cz), where cx/cz is the FULL bbox
// center on desktop or the BUILDING bbox center on mobile) already places the
// city's lowest vertex — the FULL box's min.y, unaffected by the mobile
// building-bbox switch — at this group's local Y=0 *before* the group's own
// scale/rotation/position are applied. Scaling a point whose local Y is
// exactly 0 leaves it at 0 (sx*0=0), and a Y-axis rotation doesn't touch the Y
// component either — so the group's own `position.y` (CITY_Y (+ CITY_Y_LIFT
// on mobile)) is the FINAL world Y of the city's base no matter what
// CITY_SCALE/CITY_HEIGHT_SCALE are set to. No position.y compensation is
// needed when tuning these two.
const CITY_SCALE = 1.0;
const CITY_HEIGHT_SCALE = 2.2;

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

// ── MOBILE-ONLY: baked city ambient-occlusion lightmap ──────────────────────
// A 1024² grayscale occlusion map baked (Blender) over the buildings mesh's
// SECOND UV set (TEXCOORD_1 → three's geometry.attributes.uv1) — see
// scripts/gen-city-mobile-ao.mjs. It adds contact-shadow depth to the city's
// INDIRECT/ambient light only (never the real-time sun), for the cost of ONE
// extra texture tap folded into the buildings mesh's existing MeshStandard
// program: NO new render pass, render target, draw call or transparency. Bound
// only on mobile, by <CityAO> below. Desktop (city.glb) never references it.
//
// Variant: grayscale WEBP loaded via useTexture (no transcoder needed, no KTX2
// transcode risk on iOS Safari). Loaded with useTexture and flipY=false,
// colorSpace=NoColorSpace set at runtime to match the glTF TEXCOORD_1 convention.
const CITY_AO_URL_MOBILE = '/images/city.mobile.ao.webp';

// TUNABLE — how strongly the baked AO darkens the city's INDIRECT/ambient term.
// Maps directly to three's aoMapIntensity, which scales how far below 1.0 the
// occlusion pulls reflectedLight.indirectDiffuse (ambient/IBL) — the direct sun
// is untouched. Runtime term = (aoTex.r - 1) * intensity + 1, so intensity is the
// FLOOR lever: it sets how much indirect the deepest crevices retain.
//
// Lowered 0.8 → 0.5 alongside the shorter bake AO_DISTANCE (2.0 → 1.0, see
// scripts/blender/bake_city_ao.py). The merged mobile mesh has fully-enclosed
// interiors/undersides that bake to ~0 at ANY distance, so at 0.8 those crevices
// bottomed out retaining only 20% indirect — reading muddy/dingy on sun-averted
// faces where indirect dominates (the direct-lit sun faces were always fine). At
// 0.5 the measured buildings surface retains ~76% indirect on average and ≥50% in
// the deepest crevices: subtle contact depth without the grime. Raise toward 1.0
// for deeper crevices, lower for even gentler. MOBILE-ONLY — desktop never reads it.
const CITY_AO_INTENSITY = 0; // DISABLED: the baked city.mobile.ao.webp is noisy/un-denoised -> streak artifacts on building faces; real-time shadows carry the depth. Re-enable only after a clean re-bake.

// ── MOBILE NIGHT: lit building windows (emissive map) ────────────────────────
// A warm EMISSIVE MAP keyed off the atlas (scripts/gen-city-mobile-emissive.mjs):
// window grids / storefront glass / sign text glow, flat walls stay black. Applied at
// NIGHT only, mobile-only, as the buildings material's emissiveMap (SAME UV0 as the
// atlas — channel 0) tinted by a warm `emissive` and scaled by the intensity below.
// Grayscale-safe wiring: it is just an extra emissive term on the highp city material —
// no new pass / RT / draw call, no shadow-pipeline touch. Loaded via useTexture in its
// OWN <Suspense fallback={null}> so a slow/failed load can never blank the scene. WEBP
// (no KTX2). Desktop + day never reference it. Gated by MOBILE_NIGHT_WINDOW_LIGHTS.
const CITY_EMISSIVE_URL_MOBILE = '/images/city.mobile.emissive.webp';
// Typed `boolean` (not the literal `true`) so the toggle-OFF path stays a live, type-
// checked branch for a rebuild-flip A/B, matching MOBILE_FOREST_SHADOWS_ENABLED in
// positions.ts. As the literal, the `&&` guard at the mount site below is "always
// truthy" and the not-mounted case reads as dead code.
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- the `boolean` annotation is deliberate; see above
const MOBILE_NIGHT_WINDOW_LIGHTS: boolean = true; // sub-toggle: lit windows/signs at night (A/B)
// Warm tint the emissive map is multiplied by (three: emissive * emissiveIntensity *
// emissiveMap). The map itself carries warm windows + hued signs; this biases the whole
// glow warm. Near-white-warm so baked sign hues survive.
const MOBILE_NIGHT_WINDOW_EMISSIVE_COLOR = '#fff0e0';
// Master brightness of the lit windows/signs (three emissiveIntensity). Start ~2 so they
// read as clearly LIT at night (bloom in wave 2 will bloom them further). Tune on-device.
const MOBILE_NIGHT_WINDOW_EMISSIVE_INTENSITY = 2.0;

/**
 * MOBILE-ONLY REALISTIC/PBR SPECULAR on the CITY BUILDINGS material — replaces the
 * rejected cinematic fresnel RIM. Instead of a stylized additive edge-glow, the
 * buildings now catch the procedural SKY through the MeshStandard BRDF's OWN
 * built-in, physically-based, fresnel-weighted environment reflection (grounded
 * grazing-angle sheen, no halo). Two material props on the freshly-cloned
 * buildings material owned by CityAO do this — NO onBeforeCompile, NO new pass /
 * render target / draw call / transparency, ZERO per-frame cost (the env map is
 * already scene.environment; these just scale/roughen how it reflects):
 * - CITY_ENV_MAP_INTENSITY (envMapIntensity): how strongly the buildings reflect
 *   the sky. ~1.0–1.3 = subtle realistic env specular (paired with the bumped
 *   scene MOBILE_ENV_INTENSITY). Applied ONLY to the cloned buildings material
 *   (never the fragile mediump forest material, never drei's cache; the cars mesh
 *   keeps the shared material).
 * - CITY_ROUGHNESS (roughness): ~0.55–0.65 gives the low-poly walls a touch of
 *   sheen (glossier = tighter, brighter env reflection) without going mirror-like.
 */
const CITY_ENV_MAP_INTENSITY = 1.15;
const CITY_ROUGHNESS = 0.6;
// MOBILE-ONLY matte overrides (mobile lighting-tuning pass): kill the shiny env
// sheen the raised MOBILE_KEY_INTENSITY / lowered MOBILE_ENV_INTENSITY rig would
// otherwise catch on glossier walls, and roughen the low-poly walls further so
// the baked AO + cast shadows read as FORM instead of a glossy highlight. Applied
// only inside CityAO (mobile-only — see its file-level comment); desktop keeps
// CITY_ENV_MAP_INTENSITY / CITY_ROUGHNESS above, byte-identical.
const MOBILE_CITY_ENV_MAP_INTENSITY = 0.35;
const MOBILE_CITY_ROUGHNESS = 0.9;

/**
 * MOBILE-ONLY helper — computes an X/Z bounding box over only the "building"
 * geometry of the cloned city scene: vertices whose WORLD-space Y is at/above
 * `yMin`, excluding the flat floor/road/plaza (which sit at world Y ≈ 0). This
 * is what the mobile fit (see the useMemo below) recenters/scales on INSTEAD
 * of the full Box3 — see the file-level comment (the "THAT FRINGE IS GONE"
 * paragraph) for WHY: the mobile crop's cut edge keeps floor/road out to the
 * crop boundary while the buildings on that side recede well behind it, so
 * fitting the FULL bbox reads as an uneven grass band; fitting the BUILDING
 * bbox instead gives an even band on every side, cut side included.
 *
 * Traverses the whole subtree ONCE — regular Meshes and InstancedMeshes are
 * both handled defensively (the mobile variant is uninstanced/joined by
 * gen-city-mobile.mjs, but this doesn't assume that stays true) — transforming
 * every vertex to world space via `matrixWorld` (or `matrixWorld *
 * instanceMatrix` per instance) and folding it into a running per-axis
 * min/max whenever its world Y clears `yMin`. Runs once per mount inside the
 * fit useMemo (gated on `isMobile`), not a per-frame cost. Desktop never calls
 * this — it keeps fitting the full Box3, byte-identical to before.
 *
 * Returns `null` if no vertex clears `yMin` (defensive fallback only — the
 * caller falls back to the full bbox so the fit never divides by a missing
 * value).
 */
function computeBuildingBBoxXZ(
  scene: THREE.Object3D,
  yMin: number,
): { centerX: number; centerZ: number; halfX: number; halfZ: number } | null {
  // Force a full, unconditional matrixWorld recompute of the whole subtree
  // (mirrors what THREE.Box3.setFromObject does internally) so every mesh's
  // (and every instance's) world transform below is current.
  scene.updateMatrixWorld(true);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const v = new THREE.Vector3();
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();

  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: `o` is Object3D; only actual meshes have isMesh===true
    if (!mesh.isMesh) return;
    const position = mesh.geometry.attributes.position;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: a mesh could theoretically lack a position attribute
    if (!position) return;

    const instanced = o as THREE.InstancedMesh;
    const isInstanced = instanced.isInstancedMesh;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: only InstancedMesh carries isInstancedMesh===true
    const count = isInstanced ? instanced.count : 1;

    for (let i = 0; i < count; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: only InstancedMesh carries isInstancedMesh===true
      if (isInstanced) {
        instanced.getMatrixAt(i, instanceMatrix);
        worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
      } else {
        worldMatrix.copy(mesh.matrixWorld);
      }

      for (let vi = 0; vi < position.count; vi++) {
        v.fromBufferAttribute(position, vi).applyMatrix4(worldMatrix);
        if (v.y < yMin) continue;
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
      }
    }
  });

  if (minX === Infinity) return null;

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    halfX: (maxX - minX) / 2,
    halfZ: (maxZ - minZ) / 2,
  };
}

/**
 * MOBILE-ONLY child — binds the baked AO lightmap onto the city BUILDINGS
 * material. Split into its own component (rather than calling the AO loader hook
 * inline in CityDressing) mirrors the repo's BoardTiles WebGL split and
 * GameScene's HdriSky split, for two reasons:
 *
 *   1. HOOKS: useTexture SUSPENDS and cannot be called conditionally after
 *      CityDressing's mobile/desktop fork; calling it unconditionally would
 *      needlessly fetch the ~4 MB AO file on desktop. Mounting <CityAO> only
 *      when isMobile keeps the DESKTOP path hook-free (byte-identical) and the
 *      AO fetch never happens there.
 *   2. PERF-NEUTRAL: it receives the already-cloned `object` and just assigns a
 *      map to the existing material — NO new geometry/mesh/render pass/render
 *      target/draw call/transparency. The AO folds into the buildings mesh's
 *      EXISTING MeshStandard program as one extra texture2D tap in
 *      aomap_fragment, which multiplies indirect/ambient ONLY (never the direct
 *      sun). Draw count is unchanged (buildings 1 draw, cars 1 draw). The only
 *      one-time cost is a second shader-program compile (buildings-with-aoMap vs
 *      cars-without) — already paid once by ShaderWarmup's gl.compileAsync.
 *
 * Renders nothing. Suspends inside its own Suspense boundary (wraps in
 * GameScene), isolated from the city glb's boundary, so a slow/failed AO load
 * can never blank the rest of the scene.
 */
function CityAO({
  object,
  isMobile,
}: {
  object: THREE.Object3D;
  isMobile: boolean;
}): React.JSX.Element | null {
  // Grayscale WEBP loaded via useTexture (no transcoder, no KTX2 transcode risk).
  // Set flipY=false + linear colorSpace below to match the glTF TEXCOORD_1 convention.
  const aoTex = useTexture(CITY_AO_URL_MOBILE);

  useLayoutEffect(() => {
    // AO is DATA, not color, and its lightmap UVs live in TEXCOORD_1.
    // ⚠ channel = 1 is REQUIRED: Texture.channel defaults to 0, which samples the
    // atlas UV0 (TEXCOORD_0) → completely wrong AO. channel = 1 makes three's
    // WebGLPrograms select AOMAP_UV = uv1 (the TEXCOORD_1 the bake wrote into the
    // buildings primitive) and enables the uv1 attribute/varying; the shader then
    // reads the map's .r (red) channel.
    aoTex.channel = 1;
    aoTex.colorSpace = THREE.NoColorSpace; // linear occlusion data, never sRGB
    // Inert for this KTX2 (already false; compressed uploads ignore UNPACK_FLIP_Y)
    // but documents intent and keeps a webp fallback swap correct (webp → true).
    aoTex.flipY = false;
    aoTex.wrapS = aoTex.wrapT = THREE.ClampToEdgeWrapping; // a lightmap must not tile
    aoTex.needsUpdate = true;

    // Bind the AO to the BUILDINGS mesh only, identified by the presence of the
    // lightmap UV (TEXCOORD_1 → geometry.attributes.uv1) — no name matching. The
    // buildings + cars share ONE material ("city-mobile"), so we CLONE it before
    // attaching aoMap: the clone (buildings) carries the AO; the cars mesh
    // (Cube.2221, no uv1) is skipped and keeps the un-aoMapped shared material,
    // so it never references a lightmap UV it doesn't have. The clone inherits the
    // opaque/depthWrite/FrontSide settings CityDressing's useMemo already forced.
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: `o` is Object3D; only actual meshes have isMesh===true
      if (!m.isMesh) return;
      const uv1 = m.geometry.attributes.uv1;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- identifier: only the buildings primitive carries the TEXCOORD_1 lightmap UV; cars lack it
      if (!uv1) return;
      const std = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const lit = std.clone();
      lit.aoMap = aoTex;
      lit.aoMapIntensity = CITY_AO_INTENSITY;
      // REALISTIC/PBR env specular (replaces the old cinematic fresnel rim): the
      // buildings reflect the procedural sky through MeshStandard's OWN built-in,
      // fresnel-weighted environment BRDF — a grounded grazing-angle sheen, no
      // stylized edge-glow. Pure material props (no onBeforeCompile): envMapIntensity
      // scales the reflection of scene.environment, roughness gives it a touch of
      // gloss. NO new pass / render target / draw call / transparency; the env map is
      // already scene.environment, so this is zero per-frame cost (and it drops the
      // rim's per-fragment ALU). Folds into this SAME cloned buildings program CityAO
      // already forces (aoMap variant) → no extra program count.
      // MOBILE-ONLY matte override (see MOBILE_CITY_ENV_MAP_INTENSITY /
      // MOBILE_CITY_ROUGHNESS above); CityAO only ever mounts when isMobile is
      // true (see the isMobile && <CityAO/> call site below), so the `false`
      // branch here is unreachable in practice — kept explicit so desktop's
      // values stay documented and byte-identical if that ever changes.
      lit.envMapIntensity = isMobile ? MOBILE_CITY_ENV_MAP_INTENSITY : CITY_ENV_MAP_INTENSITY;
      lit.roughness = isMobile ? MOBILE_CITY_ROUGHNESS : CITY_ROUGHNESS;
      lit.needsUpdate = true;
      m.material = lit;
    });
  }, [object, aoTex, isMobile]);

  return null;
}

/**
 * MOBILE NIGHT-ONLY child — binds the warm window/sign EMISSIVE MAP onto the city
 * BUILDINGS material so windows/glass/signs glow at night. Mirrors <CityAO>'s pattern:
 * loads the webp via useTexture (its OWN <Suspense fallback={null}> in the parent, so a
 * slow/failed load never blanks the scene), then CLONES the buildings material —
 * identified by the presence of the TEXCOORD_1 lightmap UV (uv1), exactly as CityAO does,
 * so the cars mesh (no uv1) keeps the shared, un-emissive material.
 *
 * The emissiveMap samples UV0 (channel 0 default — the SAME atlas UV as baseColor), so
 * NO channel override (unlike CityAO's aoMap which needs channel=1). flipY=false +
 * SRGBColorSpace match the glTF atlas convention the map was generated against.
 *
 * COMPOSES with CityAO regardless of effect ORDER: both clone the CURRENT buildings
 * material and reassign, and emissiveMap / aoMap / env / roughness are independent props,
 * so whichever runs second clones the other's result and both survive. Mounted ONLY at
 * night (see the parent) → day + desktop never build this program (emissive stays black).
 */
function CityWindowLights({ object }: { object: THREE.Object3D }): React.JSX.Element | null {
  const emTex = useTexture(CITY_EMISSIVE_URL_MOBILE);

  useLayoutEffect(() => {
    // Emissive is COLOR (warm windows + hued signs) → sRGB. Same UV0 as the atlas
    // (channel 0 default), flipY=false to match the glTF atlas convention (the map was
    // baked in the atlas image's top-left orientation).
    emTex.colorSpace = THREE.SRGBColorSpace;
    emTex.flipY = false;
    emTex.needsUpdate = true;

    object.traverse((o) => {
      const m = o as THREE.Mesh;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: only actual meshes have isMesh===true
      if (!m.isMesh) return;
      const uv1 = m.geometry.attributes.uv1;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- identifier: only the buildings primitive carries the TEXCOORD_1 lightmap UV; cars lack it
      if (!uv1) return; // buildings only (same identifier CityAO uses); cars keep the shared material
      const std = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const lit = std.clone();
      lit.emissiveMap = emTex;
      lit.emissive = new THREE.Color(MOBILE_NIGHT_WINDOW_EMISSIVE_COLOR);
      lit.emissiveIntensity = MOBILE_NIGHT_WINDOW_EMISSIVE_INTENSITY;
      lit.needsUpdate = true;
      m.material = lit;
    });
  }, [object, emTex]);

  return null;
}

/**
 * @param isMobile When true, city meshes are frustum-cullable (their instanced
 *   bounds are LOCAL and compact in the board center, so three culls them when
 *   they leave the view — e.g. looking at empty sky). When false/absent the
 *   desktop path is byte-identical to before (frustumCulled stays false).
 */
export function CityDressing({
  isMobile = false,
  night = false,
}: {
  isMobile?: boolean;
  /** MOBILE NIGHT: when true (and MOBILE_NIGHT_WINDOW_LIGHTS), mount the lit-window emissive map. */
  night?: boolean;
}): React.JSX.Element {
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

    // MOBILE-ONLY: the "building-only" bbox (floor/road/plaza excluded — see
    // BUILDING_Y_MIN / computeBuildingBBoxXZ above) — MUST run BEFORE the
    // recenter below moves the scene, since it reads world-space Y straight
    // off the still-untouched clone: the SAME space `box`/`center` above were
    // measured in, so BUILDING_Y_MIN lines up with both. `null` only if no
    // vertex ever clears BUILDING_Y_MIN (shouldn't happen on the real asset —
    // see computeBuildingBBoxXZ's doc comment), in which case every mobile
    // value below falls back to the full-bbox equivalent so the fit never
    // divides by a missing value. Desktop never computes this.
    const buildingBBox = isMobile ? computeBuildingBBoxXZ(scene, BUILDING_Y_MIN) : null;

    // Recenter horizontally. DESKTOP recenters on the FULL bbox center,
    // byte-identical to before. MOBILE recenters on the BUILDING bbox center
    // instead (see the "THAT FRINGE IS GONE" file-level comment for why: on
    // the cut edge the floor/road slab reaches further out than the nearest
    // building, so centering/fitting on the full bbox reads as an uneven grass
    // band — centering/fitting on the BUILDING bbox fixes that). Either way
    // the FULL box's Y-min (ground) still drops to local 0 so the outer group
    // can place the ground precisely at CITY_Y — buildings sit on the floor
    // which sits on the grass, so only the X/Z center changes on mobile, the Y
    // anchor does not.
    const centerX = buildingBBox ? buildingBBox.centerX : center.x;
    const centerZ = buildingBBox ? buildingBBox.centerZ : center.z;
    scene.position.set(-centerX, -box.min.y, -centerZ);

    // Per-axis half-extents from the recentered FULL footprint — the fit
    // denominator for DESKTOP (unchanged), and MOBILE's fallback if
    // buildingBBox is null.
    const halfX = size.x / 2;
    const halfZ = size.z / 2;

    // MOBILE: the fit denominator is the BUILDING bbox half-extents (floor/
    // road excluded), falling back to the full-bbox halfX/halfZ above only if
    // computeBuildingBBoxXZ found no qualifying vertex.
    const mobileHalfX = buildingBBox ? buildingBBox.halfX : halfX;
    const mobileHalfZ = buildingBBox ? buildingBBox.halfZ : halfZ;

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
    // exactly CITY_FILL_HALF_MOBILE, using the BUILDING-only half-extents
    // (mobileHalfX/mobileHalfZ) above — NOT the full bbox — so the OUTERMOST
    // BUILDING on every edge (the former cut edge included) lands at exactly
    // CITY_FILL_HALF_MOBILE, giving an even BAND on all 4 sides (see the
    // const-block derivation for GRASS_HALF/BAND above). The cut side's
    // floor/road, which reaches past its outermost building, now projects a
    // bit PAST CITY_FILL_HALF_MOBILE toward the grass edge — sidewalk gray
    // fills part of that side's band instead of green, which is expected/
    // desired (it replaces what was previously an over-wide empty green gap —
    // see the file-level comment). Y is tied to the X scale (not Z) to
    // preserve vertical height and avoid distorting tower proportions.
    // CITY_SCALE (XZ) and CITY_HEIGHT_SCALE (extra Y) layer on top — see the
    // const block. Desktop reads scaleX/scaleY/scaleZ unmodified.
    const finalScaleX = isMobile ? (CITY_FILL_HALF_MOBILE / (mobileHalfX || 1)) * CITY_SCALE : scaleX;
    const finalScaleZ = isMobile ? (CITY_FILL_HALF_MOBILE / (mobileHalfZ || 1)) * CITY_SCALE : scaleZ;
    const finalScaleY = isMobile
      ? (CITY_FILL_HALF_MOBILE / (mobileHalfX || 1)) * CITY_SCALE * CITY_HEIGHT_SCALE
      : scaleY;

    return { object: scene, groupScale: [finalScaleX, finalScaleY, finalScaleZ] };
  }, [gltf, isMobile]);

  // DEV-ONLY: city debug-visibility toggle (see src/dev/debugVisibility.ts).
  // Subscribes to the shared debug flags and flips the outer group's
  // `.visible` on toggle. No per-frame cost — only fires on tap. Entirely
  // gated behind `import.meta.env.DEV`; tree-shaken out of production builds.
  const groupRef = useRef<THREE.Group>(null);
  // MOBILE-ONLY: ref for the full grass-square mesh (see the const block
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
    // MOBILE-ONLY: the grass-square mesh isn't part of `object`'s subtree (it's
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
      {/* MOBILE-ONLY: bind the baked AO lightmap onto the buildings material.
          Rendered only when isMobile so useTexture never fetches on desktop and the
          desktop material path stays byte-identical. Wrapped in its own Suspense
          boundary so a slow/failed AO load can never blank the rest of the scene. */}
      {isMobile && (<Suspense fallback={null}><CityAO object={object} isMobile={isMobile} /></Suspense>)}
      {/* MOBILE NIGHT-ONLY: warm lit-window/sign emissive map on the buildings material.
          Its OWN Suspense (mirrors CityAO) so a slow/failed emissive load never blanks the
          scene. Only mounted at night → day + desktop build no emissive program. */}
      {isMobile && night && MOBILE_NIGHT_WINDOW_LIGHTS && (
        <Suspense fallback={null}>
          <CityWindowLights object={object} />
        </Suspense>
      )}
      {isMobile && (
        // MOBILE-ONLY: inverse-scale wrapper. The outer group's `scale` prop
        // (groupScale, non-uniform per axis) is what maps the city's
        // recentered local geometry onto the CITY_FILL_HALF_MOBILE-sized
        // footprint — but it would ALSO distort a square authored directly in
        // final/target units (like GRASS_HALF above) if placed straight inside
        // the outer group. Dividing by the same groupScale here cancels it out
        // exactly, so children of THIS group can be positioned/sized in plain
        // final world-scale units (matching GRASS_HALF/CITY_FILL_HALF_MOBILE
        // etc.) with no extra math. Nesting inside groupRef (rather than a
        // separate sibling group) also means the DEV city-visibility toggle
        // still hides/shows the grass square along with the rest of the city.
        <group scale={[1 / groupScale[0], 1 / groupScale[1], 1 / groupScale[2]]}>
          <mesh
            ref={grassRef}
            name="city-grass-square"
            // Centered at this group's local origin — the SAME point the city
            // is recentered on (the BUILDING bbox center.x/z on mobile, see
            // computeBuildingBBoxXZ above, with CITY_PAN_X/Z = 0) — so the
            // grass square and the (now-square) BUILDING footprint share a
            // center, giving an even BAND-wide margin around the BUILDINGS on
            // all 4 sides, including the former cut edge (where the floor/
            // road slab itself may project a bit further into that margin —
            // expected, see the file-level comment). GRASS_Y_OFFSET (negative)
            // drops it a hair below the city's own ground plane (local y=0) so
            // the city floor renders ON TOP with no z-fight.
            position={[0, GRASS_Y_OFFSET, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
            frustumCulled={isMobile}
          >
            <planeGeometry args={[GRASS_HALF * 2, GRASS_HALF * 2]} />
            {/* MOBILE-ONLY matte override: this grass-square mesh only ever
                mounts inside the `isMobile &&` block above, so `isMobile` is
                always true here in practice — kept explicit (rather than a
                bare 0.95 literal) so the desktop roughness (0.69) stays
                documented alongside it and this reads as a deliberate
                mobile-only override, not a silent global change. */}
            {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `isMobile` is narrowed to `true` by the enclosing `isMobile &&` guard, so TS is right that the ternary is always taken; the false arm is kept ON PURPOSE as inline documentation of the desktop roughness (see the comment above) and costs nothing at runtime */}
            <meshStandardMaterial color={GRASS_COLOR} roughness={isMobile ? 0.95 : 0.69} metalness={0} />
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
  // Kick the AO webp fetch in parallel with the city glb (mobile only) so it is
  // usually cached by the time <CityAO> mounts — overlapping the two loads keeps
  // the sequential glb→AO suspend from adding visible latency. Desktop never
  // fetches it.
  useTexture.preload(CITY_AO_URL_MOBILE);
} else {
  useGLTF.preload(CITY_URL);
}
