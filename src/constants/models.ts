import { useGLTF } from '@react-three/drei';
import type { TokenType } from '../types/GameState';

/**
 * Maps each of the 8 player token colors to a Blender-authored token `.glb`.
 * The models bake WHITE COLOR_0; the per-player color is applied client-side as
 * `tint` in `ModelMesh`. Paths are served from `public/models/tokens/`.
 */
export const TOKEN_MODEL: Record<TokenType, string> = {
  red: '/models/tokens/car.glb',
  blue: '/models/tokens/tophat.glb',
  green: '/models/tokens/dog.glb',
  yellow: '/models/tokens/ship.glb',
  purple: '/models/tokens/boot.glb',
  orange: '/models/tokens/thimble.glb',
  cyan: '/models/tokens/wheelbarrow.glb',
  pink: '/models/tokens/cat.glb',
};

// Warm drei's GLTF cache for every token model so the first player render has
// no per-shape load hitch.
for (const url of Object.values(TOKEN_MODEL)) {
  useGLTF.preload(url);
}
