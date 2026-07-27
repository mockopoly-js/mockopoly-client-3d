import * as THREE from 'three';

/**
 * ── TOKEN BLOB-SHADOW TEXTURE (MOBILE ONLY, procedural — NO asset) ────────────
 *
 * A soft round decal used as a cheap FAKE contact shadow under each moving
 * player token on mobile. The static baked shadow map (see
 * MobileCrispBoardPipeline) deliberately EXCLUDES tokens — a frozen map would
 * either pin a token's shadow at its load position or force a per-frame re-bake
 * (defeating the whole "static" win). So tokens cast no real shadow and instead
 * carry this unlit blob decal, which inherits the token's animated x/z for free
 * (it is a child of the per-player group) with zero per-frame code.
 *
 * The texture is a 128×128 radial gradient: a warm-brown centre
 * (rgba(58,36,22,0.55)) fading to fully transparent at the edge. The warm brown
 * matches the warm-brown shadow direction of the golden-hour grade, so the blob
 * reads as part of the same lighting rather than a neutral grey disc.
 *
 * MODULE SINGLETON: built once, lazily, on first request (only ever on mobile —
 * the mesh that uses it is `{isMobile && …}` gated). All tokens share the one
 * CanvasTexture. In non-DOM test environments `getContext('2d')` can return null
 * (jsdom without the canvas package); the guard leaves the texture transparent
 * rather than throwing — harmless because tests never render the mobile branch.
 */
let cached: THREE.CanvasTexture | null = null;

export function getTokenBlobShadowTexture(): THREE.CanvasTexture {
  if (cached) return cached;

  const SIZE = 128;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    const r = SIZE / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(58, 36, 22, 0.55)'); // warm-brown centre
    grad.addColorStop(1, 'rgba(58, 36, 22, 0)'); // transparent edge
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  cached = tex;
  return tex;
}
