import { useMemo } from 'react';
import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
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
 * baked offline by scripts/gen-board-normal.mjs from the board art). No geometry
 * change — the flat top face gets per-pixel surface normals so grid lines, tile
 * text, icons, the GO arrow, and colour strips catch the scene's directional +
 * point lighting as engraved grooves.
 *
 * TUNING KNOBS:
 *   BOARD_NORMAL_STRENGTH – overall relief depth (normalScale). ~0.2 subtle,
 *                           ~1.5 heavy. 0.6 = a tasteful embossed print.
 *   BOARD_NORMAL_Y_SIGN   – flip if the relief looks INVERTED (grooves bulge
 *                           OUT instead of sinking IN, or vice-versa). The baked
 *                           map is OpenGL green-up; some lighting reads better
 *                           with the green channel inverted. Flip 1 -> -1.
 *
 * The relief only shows under lighting + non-mirror roughness. The top material
 * keeps roughness 0.7 (matte paper) which reveals the grooves well; if the
 * relief ever looks too flat, nudging roughness DOWN slightly increases the
 * specular contrast that makes the normals visible.
 */
const BOARD_NORMAL_STRENGTH = 0.6; // range ~0.2..1.5
const BOARD_NORMAL_Y_SIGN = 1; // set to -1 if relief looks inverted

export function BoardTiles() {
  const [texture, normalTex] = useTexture(['/images/board.webp', '/images/board-normal.webp']);
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy());

  useMemo(() => {
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
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    // Normal map: LINEAR data (NOT colour) and MUST share the albedo's exact UV
    // transform so the relief lands pixel-for-pixel on the print. Mirror every
    // sampling parameter the albedo uses above.
    normalTex.colorSpace = THREE.NoColorSpace;
    normalTex.anisotropy = maxAniso;
    normalTex.flipY = TEX_FLIP_Y;
    normalTex.center.set(0.5, 0.5);
    normalTex.rotation = TEX_ROTATION;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mirrors the albedo's TEX_FLIP_X tuning branch so the normal map stays aligned when it is toggled
    normalTex.repeat.set(TEX_FLIP_X ? -1 : 1, 1);
    normalTex.wrapS = THREE.ClampToEdgeWrapping;
    normalTex.wrapT = THREE.ClampToEdgeWrapping;
    normalTex.generateMipmaps = true;
    normalTex.minFilter = THREE.LinearMipmapLinearFilter;
    normalTex.magFilter = THREE.LinearFilter;
    normalTex.needsUpdate = true;
    return texture;
  }, [texture, normalTex, maxAniso]);

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
  }, [texture, normalTex]);

  return (
    <group>
      {/* Board slab: 10 (x) × DEPTH (y) × 10 (z); top face pinned to TOP_Y. */}
      <mesh position={[0, TOP_Y - DEPTH / 2, 0]} material={materials} receiveShadow castShadow>
        <boxGeometry args={[BOARD_WORLD_SIZE, DEPTH, BOARD_WORLD_SIZE]} />
      </mesh>
    </group>
  );
}

