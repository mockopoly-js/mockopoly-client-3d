import * as THREE from 'three';

/**
 * ── PROCEDURAL BRIGHT-DAYLIGHT SKY (MOBILE ONLY) ─────────────────────────────
 *
 * A tiny code-built equirectangular sky used by HdriSkyMobile as BOTH
 * scene.background (visible sky) AND scene.environment (IBL) so the mobile scene
 * is coherently BRIGHT / high-key daylit with zero new light rig and — crucially
 * — ZERO new asset (mobile-asset-variants discipline: prefer procedural, never
 * touch the shared desktop sky.webp). Desktop keeps loading sky.webp untouched.
 *
 * WHY A CANVAS EQUIRECT (not a shader dome): assigning the CanvasTexture to
 * scene.background/environment reuses three's built-in equirect background +
 * PMREM IBL paths, so it is correct for ALL free-orbit camera poses (a
 * view-independent skybox) and the MobileCrispBoardPipeline's SCENE pass renders
 * it at scene dpr exactly like it did sky.webp — no pipeline change needed.
 *
 * WHY 16×512: the gradient is purely VERTICAL (zenith → horizon), so only height
 * carries detail; 16px width keeps the texture microscopic. The optional sun
 * hot-spot is a soft near-white high-key glow (not an azimuth-localised disc at
 * this width), which the mobile Bloom pass glows as the "sun disc" — correct for
 * every pose.
 *
 * MODULE SINGLETON: getProceduralSky() builds the CanvasTexture once and caches
 * it, so every HdriSkyMobile mount/remount (e.g. a resize that re-selects the
 * mobile branch) shares one GPU texture instead of reallocating.
 */

/** Bright-daylight gradient stops (sRGB), zenith → horizon. Tunable art knobs. */
const SKY_ZENITH = '#cfe6f7'; // soft light blue overhead
const SKY_MID = '#e4f0f7'; // airy pale near-white blue at the horizon line (v=0.5)
const SKY_HORIZON = '#f4ecda'; // soft warm-cream — warm-neutral ground bounce at nadir (v=0)
/** Soft near-white sun-glow tint painted as the bloom seed toward the high sun. */
const SUN_TINT = '#fff5ea';
/** Same tint at zero alpha for a clean radial fade. */
const SUN_TINT_TRANSPARENT = 'rgba(255, 245, 234, 0)';

// Sun hot-spot placement in equirect UV. u = azimuth of MOBILE_KEY_POSITION
// [7,11,6] → atan2(z, x) / 2π + 0.5 ≈ 0.61 (~41° azimuth). v = (elev + 90)/180 =
// (50 + 90)/180 ≈ 0.78 lifts the glow band up toward the higher ~50° sun (short
// shadows). With CanvasTexture flipY=true, canvas-y = (1 - v) * H.
const SUN_U = 0.61;
const SUN_V = 0.78;
const SUN_RADIUS_PX = 120;

const CANVAS_W = 16;
const CANVAS_H = 512;

let cached: THREE.CanvasTexture | null = null;

/**
 * Returns the shared procedural bright-daylight equirect texture, building it on
 * the first call. Safe to call repeatedly (module-cached).
 */
export function getProceduralSky(): THREE.CanvasTexture {
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Base vertical gradient. createLinearGradient(0,0,0,H): offset 0 = canvas
    // TOP; with flipY=true canvas-top maps to v=1 = UP/zenith, so stop 0 =
    // zenith and stop 1 = horizon.
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0.0, SKY_ZENITH);
    grad.addColorStop(0.5, SKY_MID);
    grad.addColorStop(1.0, SKY_HORIZON);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Soft near-white sun hot-spot, painted ON TOP of the gradient (source-over)
    // so it is visible above the bloom threshold — painting it first would be
    // fully overwritten by the opaque vertical gradient. Inner SUN_TINT →
    // transparent so it composites as a soft high-key glow the mobile Bloom pass
    // reads as the sun.
    const cx = SUN_U * CANVAS_W;
    const cy = (1 - SUN_V) * CANVAS_H;
    const radial = ctx.createRadialGradient(cx, cy, 0, cx, cy, SUN_RADIUS_PX);
    radial.addColorStop(0.0, SUN_TINT);
    radial.addColorStop(1.0, SUN_TINT_TRANSPARENT);
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  // Tiny + smooth: bilinear, no mipmaps (nothing to minify on a 16×512 sky).
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  cached = tex;
  return tex;
}
