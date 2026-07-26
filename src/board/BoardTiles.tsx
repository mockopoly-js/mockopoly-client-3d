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
 */
const BOARD_SATURATION = 1.6;

export function BoardTiles() {
  const texture = useTexture('/images/board.webp');
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy());

  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAniso;
    // Mipmaps + trilinear/anisotropic filtering sharpen the board artwork at
    // the tilted camera's grazing angle (mobile blur fix #2). generateMipmaps
    // must be set before needsUpdate so three.js builds the mip chain.
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
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
    return texture;
  }, [texture, maxAniso]);

  // 6-material array; BoxGeometry face order = [px, nx, py, ny, pz, nz].
  // Index 2 (py = top) gets the board artwork; the rest get the edge color.
  const materials = useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({ color: EDGE_COLOR, roughness: 0.85 });
    const top = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 });

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
  }, [texture]);

  return (
    <group>
      {/* Board slab: 10 (x) × DEPTH (y) × 10 (z); top face pinned to TOP_Y. */}
      <mesh position={[0, TOP_Y - DEPTH / 2, 0]} material={materials} receiveShadow castShadow>
        <boxGeometry args={[BOARD_WORLD_SIZE, DEPTH, BOARD_WORLD_SIZE]} />
      </mesh>
    </group>
  );
}

