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
// on every edge, and the plain (untrimmed) bbox center/half-extents are the
// correct fit denominator — same as desktop. See the isMobile branch in the
// fit useMemo below (no percentile trim there anymore).
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
//     half-extent is DERIVED from the two above, not set independently: since
//     the city is recentered on its own full-bbox center (isMobile branch
//     below, same recenter point as desktop) and the grass square is centered
//     on the SAME group-local origin (CITY_PAN_X/Z = 0 for both), a city
//     footprint of half-extent (GRASS_HALF - BAND) centered inside a grass
//     square of half-extent GRASS_HALF leaves EXACTLY a BAND-wide margin on
//     every side, by construction — no per-edge measurement needed.
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
const CITY_PAN_X = 0;         // world-X fine-tune (post-scale); 0 = fit-centered on origin. Both
                               // mobile and desktop recenter on the FULL bbox center (see the fit
                               // useMemo below), so this stays 0; raise it only if a real-device
                               // check still shows residual drift.
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
// mobile's full-bbox half-extent to CITY_FILL_HALF_MOBILE (= GRASS_HALF -
// BAND, ~3.25 — see the full-grass-square const block above), deliberately
// inside the ±3.66 tile-ring edge with room left for both the even BAND margin
// AND the grass square's own 0.06 margin to the ring. Growing XZ further is
// NOT safe to do blindly — it would push the fitted content further out,
// eating into BAND (or the ring). If more footprint growth is wanted later,
// raise CITY_SCALE only after re-checking every edge against BAND/the ring.
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

    // Recenter horizontally on the FULL bbox center — SAME for desktop and
    // mobile. The mobile crop's cut edge now ends cleanly at Z_CUT with no
    // sparse floor/road fringe (gen-city-mobile.mjs's edge-third crop requires
    // an instance's MIN Z, not just its center, to clear Z_CUT, and the
    // per-triangle clip on plain nodes has zero triangles straddling Z_CUT —
    // see the MOBILE FIT SOURCE DATA note above), so there is no fringe left to
    // trim around: the full Box3 IS the dense-content bound on every edge.
    // Drop Y-min (ground) to local 0 so the outer group can place the ground
    // precisely at CITY_Y.
    scene.position.set(-center.x, -box.min.y, -center.z);

    // Per-axis half-extents from the recentered footprint — the single fit
    // denominator used by BOTH desktop and mobile.
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
    // exactly CITY_FILL_HALF_MOBILE, using the FULL (clean, un-trimmed) half-extents
    // above, since the outermost content on every edge — including the tall
    // KINGS CROSS/PENTONVILLE/EUSTON side — IS the real dense content now, and
    // mapping it to exactly CITY_FILL_HALF_MOBILE is what gives an even BAND on
    // all 4 sides (see the const-block derivation for GRASS_HALF/BAND above). Y
    // is tied to the X scale (not Z) to preserve vertical height and avoid
    // distorting tower proportions. CITY_SCALE (XZ) and CITY_HEIGHT_SCALE (extra
    // Y) layer on top — see the const block. Desktop reads scaleX/scaleY/scaleZ
    // unmodified.
    const finalScaleX = isMobile ? (CITY_FILL_HALF_MOBILE / (halfX || 1)) * CITY_SCALE : scaleX;
    const finalScaleZ = isMobile ? (CITY_FILL_HALF_MOBILE / (halfZ || 1)) * CITY_SCALE : scaleZ;
    const finalScaleY = isMobile
      ? (CITY_FILL_HALF_MOBILE / (halfX || 1)) * CITY_SCALE * CITY_HEIGHT_SCALE
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
            // is recentered on (the full bbox center.x/z above, with CITY_PAN_X/Z = 0) —
            // so the grass square and the (now-square) city footprint share a
            // center, giving an even BAND-wide margin on all 4 sides,
            // including the former cut edge. GRASS_Y_OFFSET (negative) drops
            // it a hair below the city's own ground plane (local y=0) so the
            // city floor renders ON TOP with no z-fight.
            position={[0, GRASS_Y_OFFSET, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
            frustumCulled={isMobile}
          >
            <planeGeometry args={[GRASS_HALF * 2, GRASS_HALF * 2]} />
            <meshStandardMaterial color={GRASS_COLOR} roughness={0.69} metalness={0} />
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
