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

/**
 * ── PROCEDURAL MOONLIT-NIGHT SKY (MOBILE ONLY, night mode) ────────────────────
 * The night sibling of {@link getProceduralSky}: a deep-navy VERTICAL gradient equirect
 * used by HdriSkyMobileNight as BOTH scene.background (visible dark sky) AND
 * scene.environment (a DARK, cool IBL so the moon/warm-light rig — not the sky — drives
 * the look). Baked ONCE into a canvas, ZERO asset (no webp/KTX2), module-cached singleton.
 *
 * WHY A WIDER CANVAS THAN THE DAY SKY: the day sky is a pure vertical gradient (16px
 * wide). The night sky adds STARS + a MOON DISC — point features that a 16px-wide
 * equirect would smear into horizontal bands — so it uses its OWN wider
 * NIGHT_CANVAS_W×NIGHT_CANVAS_H canvas (the day 16×512 path is untouched). Stars scatter
 * across the UPPER hemisphere (canvas top half = v>0.5), DENSER toward the zenith and
 * sparse near the horizon so the fog/horizon stays clean; varied size + faint brightness.
 * A soft cool-white moon disc with a faint halo sits toward the moon-KEY direction. Plain
 * Math.random is fine — this is baked runtime canvas art, not a reproducible asset script.
 */
const NIGHT_ZENITH = '#0a1024'; // deep navy overhead
const NIGHT_MID = '#0e1730'; // dark blue mid-band
const NIGHT_HORIZON = '#16203c'; // slightly-lighter dark blue at the horizon

// Night canvas is wider than the day sky so stars/moon are point-like, not smeared.
const NIGHT_CANVAS_W = 1024;
const NIGHT_CANVAS_H = 512;

// ── STAR / MOON art knobs (tasteful, not a planetarium) ──────────────────────
const NIGHT_STARS_ENABLED = true; // draw the star field (A/B)
const NIGHT_STAR_COUNT = 340; // total stars scattered in the upper hemisphere
const NIGHT_MOON_ENABLED = true; // draw the moon disc + halo (A/B)
const NIGHT_MOON_U = 0.6; // equirect azimuth (0-1), roughly toward the moon KEY [7,5.5,6]
const NIGHT_MOON_V = 0.8; // equirect elevation (0-1); higher = nearer zenith
const NIGHT_MOON_RADIUS = 13; // disc radius (px on the 1024-wide canvas)
const NIGHT_MOON_HALO = 64; // soft halo radius (px)
const NIGHT_MOON_CORE = '#e8eeff'; // cool-white moon disc
const NIGHT_MOON_HALO_TINT = 'rgba(180, 200, 255, 0.22)'; // faint cool halo (inner)

let cachedNight: THREE.CanvasTexture | null = null;

/**
 * Returns the shared procedural moonlit-night equirect texture, building it on the
 * first call. Safe to call repeatedly (module-cached, separate from the day cache).
 */
export function getProceduralNightSky(): THREE.CanvasTexture {
  if (cachedNight) return cachedNight;

  const canvas = document.createElement('canvas');
  canvas.width = NIGHT_CANVAS_W;
  canvas.height = NIGHT_CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Vertical gradient (stop 0 = canvas TOP = v=1 = zenith with flipY=true; stop 1 =
    // horizon). Deep navy overhead → dark blue horizon.
    const grad = ctx.createLinearGradient(0, 0, 0, NIGHT_CANVAS_H);
    grad.addColorStop(0.0, NIGHT_ZENITH);
    grad.addColorStop(0.5, NIGHT_MID);
    grad.addColorStop(1.0, NIGHT_HORIZON);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, NIGHT_CANVAS_W, NIGHT_CANVAS_H);

    // STARS — upper hemisphere only (canvas top half), density DECREASING toward the
    // horizon so the fogged horizon stays clean. For each star pick a canvas-y biased
    // toward the top (y = topHalf * random²), varied size (1-2px) + faint brightness.
    if (NIGHT_STARS_ENABLED) {
      for (let i = 0; i < NIGHT_STAR_COUNT; i++) {
        const x = Math.random() * NIGHT_CANVAS_W;
        // random² biases toward 0 (top = zenith); scaled to the top ~45% of the canvas.
        const y = Math.random() * Math.random() * (NIGHT_CANVAS_H * 0.45);
        const size = Math.random() < 0.8 ? 1 : 2; // mostly 1px, a few 2px
        const b = 0.3 + Math.random() * 0.6; // faint → moderate
        ctx.fillStyle = `rgba(230, 236, 255, ${b.toFixed(3)})`;
        ctx.fillRect(Math.round(x), Math.round(y), size, size);
      }
    }

    // MOON — a soft cool-white disc with a faint halo toward the moon-KEY direction.
    // Painted ON TOP of stars/gradient (source-over). u→canvas-x, v→canvas-y via
    // (1-v) because flipY=true maps canvas-top to v=1.
    if (NIGHT_MOON_ENABLED) {
      const cx = NIGHT_MOON_U * NIGHT_CANVAS_W;
      const cy = (1 - NIGHT_MOON_V) * NIGHT_CANVAS_H;
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, NIGHT_MOON_HALO);
      halo.addColorStop(0.0, NIGHT_MOON_HALO_TINT);
      halo.addColorStop(1.0, 'rgba(180, 200, 255, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, NIGHT_CANVAS_W, NIGHT_CANVAS_H);
      ctx.fillStyle = NIGHT_MOON_CORE;
      ctx.beginPath();
      ctx.arc(cx, cy, NIGHT_MOON_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  cachedNight = tex;
  return tex;
}
