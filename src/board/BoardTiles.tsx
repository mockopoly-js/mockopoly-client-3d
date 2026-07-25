import { useMemo } from 'react';
import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useIsMobile } from '../ui/useIsMobile';
import { BOARD_WORLD_SIZE } from './positions';

/**
 * The real 2D Monopoly board (board.webp, the printed square that fills the
 * whole image edge-to-edge) extruded into a 3D slab. The top face carries the
 * board artwork; the sides + bottom are a solid toy-board edge color.
 *
 * ALIGNMENT CONTRACT (must match positions.ts ring math):
 * Tokens/buildings are placed via tileToWorld(i), which maps a tile's
 * normalized 0–1 position directly onto the [-5, +5] world plane. Because the
 * printed board fills the image edge-to-edge, the image's 0–1 UV space maps
 * 1:1 onto that same plane — so a full-image texture on the 10×10 top face
 * lines the printed spaces up under the tokens, PROVIDED the texture is
 * oriented so GO's printed corner lands where tileToWorld(0) puts the GO token.
 *
 * GO (index 0) token world pos = (+4.33, y, +4.33)  [normalized (0.933,0.933)].
 * The printed GO corner is the BOTTOM-RIGHT of board.webp.
 *
 * BoxGeometry top (+Y) face default UVs:
 *   world (-x,-z)->uv(0,1)  (+x,-z)->uv(1,1)  (-x,+z)->uv(0,0)  (+x,+z)->uv(1,0)
 * i.e. u grows with +x, v grows with -z. With three's default flipY=true,
 * uv(0,0) samples the image's bottom-left and uv(1,1) its top-right. GO's
 * world (+x,+z) samples uv≈(0.93,0.07) => image bottom-right => the printed GO
 * corner. So the DEFAULT orientation below already aligns GO bottom-right.
 *
 * If a visual check shows the board mirrored or rotated, tweak ONLY these three
 * consts (one-line each) — no other math needs to change:
 *   TEX_FLIP_Y  – flips the vertical axis (fixes top/bottom mirrored).
 *   TEX_FLIP_X  – flips the horizontal axis (fixes left/right mirrored).
 *   TEX_ROTATION – rotates the artwork in 90° steps about the tile center
 *                  (Math.PI/2 quarter-turns) if the whole board is turned.
 */
const TEX_FLIP_Y = true;        // three.js default; image bottom-right -> world (+x,+z)
const TEX_FLIP_X = false;       // set true if left/right come out mirrored
const TEX_ROTATION = 0;         // radians; use ±Math.PI/2, Math.PI for quarter turns

/** Slab thickness (world units). Top face pinned to y=0.02; base sits below. */
const DEPTH = 0.5;
/** Top face y — MUST stay 0.02 so tokens/buildings/dice heights are unaffected. */
const TOP_Y = 0.02;
/** Edge/side + bottom color — reads as a warm toy-board rim. */
const EDGE_COLOR = '#c9a06a';

/** Cache-busting version for board normal and height maps. Bump when re-baking. */
const MAP_VER = 2;

/**
 * Saturation multiplier for the printed board artwork ONLY (top face, index 2).
 * 1.0 = unchanged; >1 = more saturated. Applied AFTER tonemapping_fragment on
 * gl_FragColor.rgb (post-lighting, post-tonemap) so lighting/IBL cannot wash
 * it back out. Board-only — edge, city, forest, tokens are unaffected.
 *
 * Reduced 1.6 -> 1.15 now that GameScene applies a GLOBAL post color grade
 * (HueSaturation) over the whole scene. The old 1.6 double-boosted the board
 * on top of the global grade; 1.15 keeps the board reading consistent with the
 * rest of the graded scene while still nudging the printed art slightly punchier.
 */
const BOARD_SATURATION = 1.15;

/**
 * Fake-3D relief for the printed board via a NORMAL MAP (board-normal.webp,
 * baked offline by scripts/gen-board-normal.mjs FROM the shipped albedo
 * board.webp — same pixel basis, so the relief aligns 1:1 with the print). No
 * geometry change — the flat top face gets per-pixel surface normals so grid
 * lines, tile text, icons, the GO arrow, and price text catch the scene's
 * directional + point lighting as RAISED ridges POPPING OUT of the board (the
 * bake uses DARK-INK = HIGH so the print embosses outward, not engraved in).
 *
 * TUNING KNOBS:
 *   BOARD_NORMAL_STRENGTH – overall relief depth (normalScale). ~0.2 subtle,
 *                           ~1.5 heavy. 0.6 = a tasteful embossed print.
 *   BOARD_NORMAL_Y_SIGN   – flip if the relief reads INVERTED under lighting
 *                           (print sinks IN instead of popping OUT). The bake
 *                           already inverts the height (dark ink = raised) and
 *                           is OpenGL green-up, so +1 gives the raised look; if
 *                           lighting ever reads it sunk-in, flip 1 -> -1.
 *
 * The relief only shows under lighting + non-mirror roughness. The top material
 * keeps roughness 0.7 (matte paper) which reveals the grooves well; if the
 * relief ever looks too flat, nudging roughness DOWN slightly increases the
 * specular contrast that makes the normals visible.
 */
const BOARD_NORMAL_STRENGTH = 1.5; // range ~0.2..1.5
const BOARD_NORMAL_Y_SIGN = 1; // set to -1 if relief looks inverted

/**
 * REAL DISPLACEMENT — the print physically raises as GEOMETRY (not just the fake
 * normal-map relief). A densely subdivided PlaneGeometry is laid flat at the
 * board's top surface (TOP_Y) sharing the top material (albedo + saturation
 * inject + normal map) PLUS a grayscale displacementMap (board-height.webp,
 * baked by scripts/gen-board-normal.mjs from the SAME 1-luminance height field
 * as the normal map: DARK INK = HIGH). Each vertex is pushed +Y by
 * height * BOARD_DISPLACEMENT_SCALE, so the black grid lines, borders, big icons,
 * the GO arrow, and colour strips gain real silhouette/relief while the flat
 * light paper (height ≈ 0) stays at the surface. The normal map still supplies
 * the fine per-pixel letter detail that tessellation alone can't resolve.
 *
 * Z-FIGHT AVOIDANCE: the subdivided plane sits AT TOP_Y and IS the visible top
 * surface; the slab's own flat top face is dropped a hair BELOW it (see
 * SLAB_TOP_DROP) so the two never coincide — only the displaced plane shows on
 * top, while the slab keeps providing thickness + the four edge/bottom faces.
 *
 * TUNING KNOBS:
 *   BOARD_SEGMENTS          – tessellation per axis. 2048 → ~8.4M tris (desktop).
 *                             The board albedo is 2048px, so 2048 segments ≈ 1px
 *                             per vertex: thin text strokes (~4–6px) now span
 *                             enough vertices to form CRISP defined ridges instead
 *                             of soft blobs. This high tessellation (not fat
 *                             dilation) is what makes the ink read sharp. Costs
 *                             desktop FPS — accepted. Mobile forces 0 (a single
 *                             flat quad; 2048² would kill mobile GPUs).
 *   BOARD_DISPLACEMENT_SCALE – world-unit height of the raised ink. Board is ~10
 *                             wide, tiles ~0.9; 0.07 reads as a firm embossed
 *                             print with the ink-only smooth height bake. Raise
 *                             for more pop, lower if silhouette looks lumpy or
 *                             clips tokens/buildings. (Was 0.15 — that amplified
 *                             the old noisy low-threshold bake into spiky canyons;
 *                             0.07 + the ink-only smoothstep bake reads as clean
 *                             raised lines/letters, not spikes.)
 */
const BOARD_SEGMENTS = 2048;
const BOARD_DISPLACEMENT_SCALE = 0.07;
/**
 * Nudge the slab's flat top face just below the displaced plane so the original
 * flat top never coincides with (z-fights) the subdivided displaced surface.
 * Small enough to be invisible against DEPTH (0.5) and BOARD_DISPLACEMENT_SCALE.
 */
const SLAB_TOP_DROP = 0.01;

export function BoardTiles() {
  const [texture, normalTex, heightTex] = useTexture([
    '/images/board.webp',
    `/images/board-normal.webp?v=${MAP_VER}`,
    `/images/board-height.webp?v=${MAP_VER}`,
  ]);
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  // 2048² ≈ 8.4M tris (~1px/vertex → crisp thin-stroke ridges) is heavy but
  // accepted on desktop; far too much for mobile GPUs. 0 segments → a single flat
  // quad → displacement is a no-op (normal map still works), while desktop gets
  // the full high-resolution displaced silhouette.
  const isMobile = useIsMobile();
  const segments = isMobile ? 0 : BOARD_SEGMENTS;

  useMemo(() => {
    // ── ALBEDO — the single source of truth for the board's UV transform ──────
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAniso;
    texture.flipY = TEX_FLIP_Y;
    // Rotate about the artwork center so the board doesn't drift off the face.
    texture.center.set(0.5, 0.5);
    texture.rotation = TEX_ROTATION;
    // Mirror horizontally via a negative repeat when requested. TEX_FLIP_X is a
    // deliberate build-time tuning knob (see header) — keep the branch so it can
    // be flipped to `true` without further edits, even though it is false today.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TEX_FLIP_X is a documented tuning constant meant to be toggled; the branch is intentional
    texture.repeat.set(TEX_FLIP_X ? -1 : 1, 1);
    texture.offset.set(0, 0);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    // ── NORMAL — COPY the albedo's exact UV transform (never re-derive it) ─────
    // The relief must land pixel-for-pixel on the print, so instead of restating
    // flipY/center/rotation/repeat/offset/wrap for the normal map (which could
    // silently drift from the albedo), we COPY every UV-sampling parameter off
    // the just-configured albedo texture. Anything that tweaks the albedo's
    // framing (TEX_FLIP_X/Y, TEX_ROTATION) now propagates to the normal map
    // automatically — they can't diverge. Only the colour/mip/filter properties
    // (which are texture-kind-specific, not UV placement) are set independently:
    // the normal map is LINEAR data, not colour.
    normalTex.flipY = texture.flipY;
    normalTex.center.copy(texture.center);
    normalTex.rotation = texture.rotation;
    normalTex.repeat.copy(texture.repeat);
    normalTex.offset.copy(texture.offset);
    normalTex.wrapS = texture.wrapS;
    normalTex.wrapT = texture.wrapT;
    // Keep the matrix in lock-step too (belt-and-braces if matrixAutoUpdate is
    // ever disabled upstream): recompute both from the copied params.
    texture.updateMatrix();
    normalTex.matrixAutoUpdate = texture.matrixAutoUpdate;
    normalTex.matrix.copy(texture.matrix);

    // Texture-kind-specific (NOT UV placement): normal map stays LINEAR.
    normalTex.colorSpace = THREE.NoColorSpace;
    normalTex.anisotropy = maxAniso;
    normalTex.generateMipmaps = true;
    normalTex.minFilter = THREE.LinearMipmapLinearFilter;
    normalTex.magFilter = THREE.LinearFilter;
    normalTex.needsUpdate = true;

    // ── HEIGHT / DISPLACEMENT — COPY the albedo's exact UV transform ───────────
    // Displacement must raise the print pixel-for-pixel where the ink is, so the
    // height map samples the IDENTICAL UV placement as the albedo (never re-derive
    // it): copy flipY/center/rotation/repeat/offset/wrap + matrix off the albedo.
    // Any framing tweak (TEX_FLIP_X/Y, TEX_ROTATION) propagates automatically.
    heightTex.flipY = texture.flipY;
    heightTex.center.copy(texture.center);
    heightTex.rotation = texture.rotation;
    heightTex.repeat.copy(texture.repeat);
    heightTex.offset.copy(texture.offset);
    heightTex.wrapS = texture.wrapS;
    heightTex.wrapT = texture.wrapT;
    heightTex.matrixAutoUpdate = texture.matrixAutoUpdate;
    heightTex.matrix.copy(texture.matrix);
    // Texture-kind-specific: displacement is LINEAR data, NOT colour.
    heightTex.colorSpace = THREE.NoColorSpace;
    // CRITICAL: the displacement map is sampled in the VERTEX shader. Mipmapped
    // sampling (LinearMipmapLinear + anisotropy, as the albedo uses) averages a
    // thin ink stroke against the surrounding paper across coarse mip levels,
    // collapsing its baked height toward ~0 — so the print looks FLAT no matter
    // how high displacementScale is. Disable mipmaps and force plain bilinear
    // (LinearFilter, no anisotropy) so each vertex samples the height field at
    // full resolution and the raised ink survives as real geometry. (The NORMAL
    // map above is a FRAGMENT-shader map and correctly keeps its mipmaps.)
    heightTex.generateMipmaps = false;
    heightTex.minFilter = THREE.LinearFilter;
    heightTex.magFilter = THREE.LinearFilter;
    heightTex.anisotropy = 1;
    heightTex.needsUpdate = true;
    return texture;
  }, [texture, normalTex, heightTex, maxAniso]);

  // 6-material array; BoxGeometry face order = [px, nx, py, ny, pz, nz].
  // Index 2 (py = top) gets the board artwork; the rest get the edge color.
  const materials = useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({ color: EDGE_COLOR, roughness: 0.85 });
    const top = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 });

    // Fake-3D relief: engraved grooves along the print. normalScale.y carries
    // BOARD_NORMAL_Y_SIGN so the OpenGL green-up map can be flipped in one place
    // if the relief reads inverted. This is an independent standard-material
    // feature and does NOT interfere with the onBeforeCompile saturation inject.
    top.normalMap = normalTex;
    top.normalScale = new THREE.Vector2(
      BOARD_NORMAL_STRENGTH,
      BOARD_NORMAL_STRENGTH * BOARD_NORMAL_Y_SIGN,
    );

    // REAL DISPLACEMENT: push the subdivided top plane's vertices UP (+Y) by
    // height * scale. Direction confirmed +Y: PlaneGeometry vertex normals are
    // +Z; the plane mesh is rotated -π/2 about X, which maps +Z → +Y, so three's
    // displacement (vertex += normal * displacementScale*height) pushes ink
    // UPWARD above the flat faces (no normal flip needed). Height ≈ 0 (paper +
    // near-white faces + colour strips, thresholded flat by the ink-only bake)
    // stays exactly at the surface; height ≈ 1 (dark ink) raises. Bias 0 so flat
    // tile faces sit exactly at TOP_Y (coplanar). This
    // only visibly deforms the dense plane below; the slab's coarse top face has
    // no interior verts to move and is dropped out of view anyway (SLAB_TOP_DROP).
    top.displacementMap = heightTex;
    top.displacementScale = BOARD_DISPLACEMENT_SCALE;
    top.displacementBias = 0;
    top.needsUpdate = true;

    // Inject a saturation boost into the TOP face shader only — applied AFTER
    // tonemapping_fragment, operating directly on gl_FragColor.rgb so that
    // lighting, IBL, and ACES tone-mapping are already baked in and cannot wash
    // the boost back out.  Guard with userData so the patch runs at most once.
    top.onBeforeCompile = (shader) => {
      if (top.userData._satPatchApplied) return;
      top.userData._satPatchApplied = true;

      // Inject the tunable constant just after #include <common>.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>\nconst float BOARD_SATURATION = ${BOARD_SATURATION.toFixed(4)};`,
      );

      // Replace the tonemapping chunk with itself + a luminance-mix saturation
      // applied to gl_FragColor.rgb (ITU-R BT.709 luma weights). colorspace_fragment
      // runs after this, so sRGB gamma encode still happens normally.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <tonemapping_fragment>',
        `#include <tonemapping_fragment>
{ float _l = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb = clamp(mix(vec3(_l), gl_FragColor.rgb, BOARD_SATURATION), 0.0, 1.0); }`,
      );
    };

    return [edge, edge, top, edge, edge, edge];
  }, [texture, normalTex, heightTex]);

  // The shared TOP material (materials[2]) drives the displaced plane. It carries
  // albedo + saturation inject + normal + displacement, so the plane looks
  // identical to the slab's top face — just tessellated + physically raised.
  const topMaterial = materials[2];

  return (
    <group>
      {/*
        Board SLAB: 10 (x) × DEPTH (y) × 10 (z). Provides thickness + the four
        edge faces + bottom. Its own flat top face is dropped SLAB_TOP_DROP below
        TOP_Y so it never coincides with (z-fights) the displaced plane above —
        the plane is the visible top surface. The slab's top material is still the
        printed board so the seam at the board rim reads correctly.
      */}
      <mesh
        position={[0, TOP_Y - SLAB_TOP_DROP - DEPTH / 2, 0]}
        material={materials}
        receiveShadow
        castShadow
      >
        <boxGeometry args={[BOARD_WORLD_SIZE, DEPTH, BOARD_WORLD_SIZE]} />
      </mesh>

      {/*
        DISPLACED TOP PLANE: a densely subdivided quad laid flat at TOP_Y, facing
        +Y. Rotated -90° about X so the plane's local (u,v) maps onto world (x,z)
        with the SAME UV basis as the box top face (u→+x, v→-z), keeping the print
        aligned 1:1 under tokens. Shares the TOP material (albedo + saturation +
        normal + displacement); displacementMap raises the ink into real geometry.
        Mobile → segments 0 → flat single quad → displacement no-op (normal map
        still works).
      */}
      <mesh
        position={[0, TOP_Y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={topMaterial}
        receiveShadow
        castShadow
      >
        <planeGeometry
          args={[BOARD_WORLD_SIZE, BOARD_WORLD_SIZE, segments, segments]}
        />
      </mesh>
    </group>
  );
}

