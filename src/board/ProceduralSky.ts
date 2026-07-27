import * as THREE from 'three';

/**
 * ── PROCEDURAL GOLDEN-HOUR SKY (MOBILE ONLY) ─────────────────────────────────
 *
 * A tiny code-built equirectangular sky used by HdriSkyMobile as BOTH
 * scene.background (visible sky) AND scene.environment (IBL) so the mobile scene
 * is coherently WARM with zero new light rig and — crucially — ZERO new asset
 * (mobile-asset-variants discipline: prefer procedural, never touch the shared
 * desktop sky.webp). Desktop keeps loading sky.webp untouched.
 *
 * WHY A CANVAS EQUIRECT (not a shader dome): assigning the CanvasTexture to
 * scene.background/environment reuses three's built-in equirect background +
 * PMREM IBL paths, so it is correct for ALL free-orbit camera poses (a
 * view-independent skybox) and the MobileCrispBoardPipeline's SCENE pass renders
 * it at scene dpr exactly like it did sky.webp — no pipeline change needed.
 *
 * WHY 16×512: the gradient is purely VERTICAL (zenith → horizon), so only height
 * carries detail; 16px width keeps the texture microscopic. The optional sun
 * hot-spot is a warm horizon glow (not an azimuth-localised disc at this width),
 * which the mobile Bloom pass glows as the "sun disc" — correct for every pose.
 *
 * MODULE SINGLETON: getProceduralSky() builds the CanvasTexture once and caches
 * it, so every HdriSkyMobile mount/remount (e.g. a resize that re-selects the
 * mobile branch) shares one GPU texture instead of reallocating.
 */

/** Warm-gradient stops (sRGB), zenith → horizon. Tunable art-direction knobs. */
const SKY_ZENITH = '#f0b060'; // deep-warm amber overhead
const SKY_MID = '#e8845a'; // amber mid-sky
const SKY_HORIZON = '#d05a4a'; // warm-red horizon
/** Warm sun-glow tint painted as the bloom seed near the horizon. */
const SUN_TINT = '#ffe6b0';
/** Same tint at zero alpha for a clean radial fade. */
const SUN_TINT_TRANSPARENT = 'rgba(255, 230, 176, 0)';

// Sun hot-spot placement in equirect UV. u = azimuth of MOBILE_KEY_POSITION
// [11,5,7] → atan2(z, x) / 2π + 0.5 ≈ 0.59; v ≈ 0.62 sits just above the
// horizon. With CanvasTexture flipY=true, canvas-y = (1 - v) * H.
const SUN_U = 0.59;
const SUN_V = 0.62;
const SUN_RADIUS_PX = 90;

const CANVAS_W = 16;
const CANVAS_H = 512;

let cached: THREE.CanvasTexture | null = null;

/**
 * Returns the shared procedural golden-hour equirect texture, building it on the
 * first call. Safe to call repeatedly (module-cached).
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

    // Warm sun hot-spot, painted ON TOP of the gradient (source-over) so it is
    // visible above the bloom threshold — painting it first would be fully
    // overwritten by the opaque vertical gradient. Inner SUN_TINT → transparent
    // so it composites as a soft glow the mobile Bloom pass reads as the sun.
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
