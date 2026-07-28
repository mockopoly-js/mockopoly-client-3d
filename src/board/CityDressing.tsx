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
// side → its edge sits at world ±(0.5-0.134)*10 = ±3.66. Non-uniform scale on X
// and Z fills both axes to the target half-extent (~3.45), while Y scale is tied
// to X to avoid vertical distortion. City footprint (model ~300×260) is recentered
// at origin, then each axis is scaled independently to fill the inner square equally.
// PANs stay 0 so the bbox stays perfectly centered (|centerX|,|centerZ| < 0.1).
const CITY_FILL_HALF = 3.55;  // target half-extent on X and Z axes (safely inside ±3.66 tile edge)
const CITY_PAN_X = 0;         // world-X fine-tune (post-scale); 0 = bbox-centered on origin
const CITY_PAN_Z = 0;         // world-Z fine-tune (post-scale); 0 = bbox-centered on origin
const CITY_Y = 0.02;          // rest the city ground on the board top (TOP_Y)
const CITY_Y_LIFT = 0.08;     // mobile-only: lift city off board surface to prevent z-fight
const CITY_ROT = 0;           // radians; nudge to aim streets toward the camera

// MOBILE-ONLY extra scale multipliers, layered on top of the auto-fit scale
// (scaleX/scaleY/scaleZ below) to fix a scale-read problem: the player
// character dwarfed the city, so the buildings needed to grow — especially
// taller, for an "elongated skyscraper" silhouette that towers over the token.
//
// CITY_SCALE (XZ, footprint) is kept at 1.0: the auto-fit above already sets
// the city's LONG-axis half-extent to CITY_FILL_HALF=3.55, deliberately just
// inside the ±3.66 tile-ring edge (see file header) — only ~3% headroom
// remains before geometry spills onto the printed tiles. Growing XZ further is
// not safe to do blindly, so all of the "bigger" effect is carried by height.
// If more footprint growth is wanted later, raise CITY_SCALE cautiously (stay
// under ~1.03 = 3.66/3.55) and re-check the corners against the tile ring.
//
// CITY_HEIGHT_SCALE stretches Y on top of CITY_SCALE (effective Y multiplier
// = CITY_SCALE * CITY_HEIGHT_SCALE = 1.6), which is unconstrained by the board
// footprint (buildings just grow up into open sky), so it can be freely tuned.
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
const CITY_HEIGHT_SCALE = 1.6;

const CITY_URL = '/models/city.glb';

// MOBILE-ONLY variant: the same city collapsed to ~2 draws / 1 material / 1
// atlas texture (~24 MB VRAM vs desktop's ~92 MB), generated by
// scripts/gen-city-mobile.mjs. It is draco-compressed, so it needs the
// self-hosted decoder in /public/draco/. Desktop keeps the plain, decoder-free
// city.glb byte-identical. Visually identical (same buildings, same UVs).
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

    // MOBILE-ONLY: layer CITY_SCALE/CITY_HEIGHT_SCALE on top of the auto-fit
    // above (see the const block for why XZ stays ~1.0 while Y is emphasized).
    // Desktop reads scaleX/scaleY/scaleZ unmodified — byte-identical to before.
    const finalScaleX = isMobile ? scaleX * CITY_SCALE : scaleX;
    const finalScaleZ = isMobile ? scaleZ * CITY_SCALE : scaleZ;
    const finalScaleY = isMobile ? scaleY * CITY_SCALE * CITY_HEIGHT_SCALE : scaleY;

    return { object: scene, groupScale: [finalScaleX, finalScaleY, finalScaleZ] };
  }, [gltf, isMobile]);

  // DEV-ONLY: city debug-visibility toggle (see src/dev/debugVisibility.ts).
  // Subscribes to the shared debug flags and flips the outer group's
  // `.visible` on toggle. No per-frame cost — only fires on tap. Entirely
  // gated behind `import.meta.env.DEV`; tree-shaken out of production builds.
  const groupRef = useRef<THREE.Group>(null);
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
