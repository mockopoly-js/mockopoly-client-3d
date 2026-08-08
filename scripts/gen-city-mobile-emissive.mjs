/**
 * gen-city-mobile-emissive.mjs — build the MOBILE-ONLY city NIGHT emissive map
 * `public/images/city.mobile.emissive.webp` from the atlas embedded in
 * `public/models/city.mobile.glb` (the single "city-atlas" 2304×2048 baseColor PNG
 * of the merged "city-mobile" material).
 *
 * GOAL: at night the WINDOWS / GLASS / SIGNS of the buildings glow warm while the
 * FLAT wall / roof color fills stay BLACK (walls glowing is the thing to avoid). The
 * map is applied at runtime as the buildings material's `emissiveMap` (same UV0 as the
 * atlas), tinted by a warm `emissive` and scaled by MOBILE_NIGHT_WINDOW_EMISSIVE_INTENSITY.
 * Night-only, mobile-only (see CityDressing <CityWindowLights>). Desktop never reads it.
 *
 * KEYING (edge DENSITY, not magnitude/hue): the atlas facades are FLAT solid colors for
 * walls and HIGH-FREQUENCY for features — mullioned window grids, framed storefront
 * glass, sign text, doors. The discriminator is how MANY edges sit in a neighborhood:
 *   1. luminance → gradient magnitude (central diff) → BINARY edge map (> EDGE_MAG).
 *   2. edge DENSITY = fraction of edge pixels in a (2·DENS_RADIUS+1)² window (via an
 *      integral image of the binary edge map → O(1) per pixel). A window GRID / TEXT /
 *      mullion strip packs MANY edges → high density. A single flat-color SEAM or the
 *      cell↔black-gap boundary is ONE line → LOW density → stays dark (this is why
 *      density beats raw stddev: no glowing wall seams / cell-edge rims). Flat walls = 0.
 *   3. maskStrength = smoothstep(DENS_LO, DENS_HI, density) → 0 on walls/seams, →1 on
 *      dense detail.
 *   4. DILATE (separable max filter, DILATE_RADIUS) so a grid / text fills into a SOLID
 *      glowing panel instead of thin lines (a little spill past the feature is fine —
 *      walls have no mask to spill FROM).
 *   5. BLUR (separable box, BLUR_RADIUS) for a soft glow edge.
 *   6. COLORIZE: strongly-SATURATED masked pixels (sign banners / colored glass) KEEP
 *      their hue (normalized bright); the rest (grey mullions, neutral glass) → WARM.
 *      Multiply by maskStrength. Unmasked → black.
 * The material sets a warm `emissive` on top, so windows read warm and signs keep a
 * warm-biased hue. Output is DOWNSCALED (glow is soft) to save VRAM.
 *
 * It does NOT need to be perfect — lit signs + glass + windows reading as glow is the
 * goal; a little spill is fine, walls glowing is NOT. All thresholds are consts below;
 * re-run + re-inspect if the atlas is ever regenerated.
 *
 *   node scripts/gen-city-mobile-emissive.mjs
 */
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshGPUInstancing, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GLB_IN = resolve(ROOT, 'public/models/city.mobile.glb');
const WEBP_OUT = resolve(ROOT, 'public/images/city.mobile.emissive.webp');

// ── TUNABLES (re-inspect the output webp if you change these) ──────────────────
const EDGE_MAG = 32; // luminance gradient magnitude (0-255) above which a pixel is an "edge"
const DENS_RADIUS = 6; // half-size (px) of the edge-density window
const DENS_LO = 0.12; // edge fraction below this → wall/seam → black (a single seam ≈ 0.08)
const DENS_HI = 0.3; // edge fraction at/above this → dense detail (grid/text) → full mask
const DILATE_RADIUS = 3; // grow the mask so grids/text fill into solid glowing panels
const BLUR_RADIUS = 2; // soften the mask edges into a glow
const GAP_LUM = 10; // original luminance below this AND flat-dark neighborhood → atlas gap → force black
const SIGN_SAT = 0.4; // HSV saturation above which a masked pixel KEEPS its own hue (sign/colored glass)
const SIGN_VAL = 0.28; // …and only if bright enough (skip near-black)
const WARM = [255, 217, 160]; // #ffd9a0 — warm window/glass glow for non-saturated detail
const OUT_SCALE = 0.5; // downscale factor for the output (VRAM); UV mapping is resolution-independent

async function main() {
  // Pull the embedded atlas. Draco DECODER registered so read() succeeds on the
  // draco-compressed mobile glb (we only need the texture image, but read() must parse).
  const decoder = await draco3d.createDecoderModule();
  const io = new NodeIO()
    .registerExtensions([EXTMeshGPUInstancing, KHRDracoMeshCompression])
    .registerDependencies({ 'draco3d.decoder': decoder });
  const doc = await io.read(GLB_IN);
  const root = doc.getRoot();
  const atlasTex =
    root.listMaterials()[0]?.getBaseColorTexture() ??
    root.listTextures().find((t) => t.getName() === 'city-atlas') ??
    root.listTextures()[0];
  if (!atlasTex) throw new Error('city-atlas texture not found in ' + GLB_IN);
  const atlasBytes = atlasTex.getImage();
  if (!atlasBytes) throw new Error('city-atlas has no image bytes');

  // Decode → raw RGB.
  const { data, info } = await sharp(Buffer.from(atlasBytes))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const N = W * H;
  console.log(`[emissive] atlas ${W}×${H} (${info.channels}ch after removeAlpha)`);

  // Luminance (Rec.601, 0-255) + HSV sat/val for the colorize step.
  const lum = new Float64Array(N);
  const sat = new Float32Array(N);
  const val = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    val[i] = mx / 255;
    sat[i] = mx === 0 ? 0 : (mx - mn) / mx;
  }

  // Binary edge map: central-difference gradient magnitude > EDGE_MAG.
  const edge = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xl = x > 0 ? lum[i - 1] : lum[i];
      const xr = x < W - 1 ? lum[i + 1] : lum[i];
      const yt = y > 0 ? lum[i - W] : lum[i];
      const yb = y < H - 1 ? lum[i + W] : lum[i];
      const gx = Math.abs(xr - xl);
      const gy = Math.abs(yb - yt);
      edge[i] = gx + gy > EDGE_MAG ? 1 : 0;
    }
  }

  // Integral image of the binary edge map → O(1) window edge count.
  const IW = W + 1;
  const eint = new Float64Array(IW * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += edge[y * W + x];
      const idx = (y + 1) * IW + (x + 1);
      eint[idx] = eint[idx - IW] + row;
    }
  }
  const rectSum = (x0, y0, x1, y1) =>
    eint[(y1 + 1) * IW + (x1 + 1)] -
    eint[y0 * IW + (x1 + 1)] -
    eint[(y1 + 1) * IW + x0] +
    eint[y0 * IW + x0];

  // maskStrength from edge DENSITY via smoothstep(DENS_LO, DENS_HI).
  const mask = new Float32Array(N);
  const R = DENS_RADIUS;
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - R);
    const y1 = Math.min(H - 1, y + R);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - R);
      const x1 = Math.min(W - 1, x + R);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const density = rectSum(x0, y0, x1, y1) / area;
      const t = (density - DENS_LO) / (DENS_HI - DENS_LO);
      const c = t < 0 ? 0 : t > 1 ? 1 : t;
      mask[y * W + x] = c * c * (3 - 2 * c); // smoothstep
    }
  }

  // Separable MAX filter (dilate) then separable BOX blur.
  const maxFilter = (src, radius) => {
    const tmp = new Float32Array(N);
    const out = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let m = 0;
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(W - 1, x + radius);
        for (let xx = x0; xx <= x1; xx++) m = Math.max(m, src[y * W + xx]);
        tmp[y * W + x] = m;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let m = 0;
        const y0 = Math.max(0, y - radius);
        const y1 = Math.min(H - 1, y + radius);
        for (let yy = y0; yy <= y1; yy++) m = Math.max(m, tmp[yy * W + x]);
        out[y * W + x] = m;
      }
    }
    return out;
  };
  const boxBlur = (src, radius) => {
    const tmp = new Float32Array(N);
    const out = new Float32Array(N);
    const win = radius * 2 + 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let acc = 0;
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(W - 1, x + radius);
        for (let xx = x0; xx <= x1; xx++) acc += src[y * W + xx];
        tmp[y * W + x] = acc / win;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let acc = 0;
        const y0 = Math.max(0, y - radius);
        const y1 = Math.min(H - 1, y + radius);
        for (let yy = y0; yy <= y1; yy++) acc += tmp[yy * W + x];
        out[y * W + x] = acc / win;
      }
    }
    return out;
  };

  let m = maxFilter(mask, DILATE_RADIUS);
  m = boxBlur(m, BLUR_RADIUS);

  // GAP GUARD: force the atlas's black inter-cell gaps to stay black even if a nearby
  // cell edge's dilated glow spilled into them. A gap pixel is near-black AND sits in a
  // flat-dark neighborhood (mean luminance below GAP_LUM); a dark WINDOW MULLION is
  // near-black but has bright neighbors, so its mean is high → NOT forced (stays lit).
  const lint = new Float64Array(IW * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += lum[y * W + x];
      const idx = (y + 1) * IW + (x + 1);
      lint[idx] = lint[idx - IW] + row;
    }
  }
  const lRect = (x0, y0, x1, y1) =>
    lint[(y1 + 1) * IW + (x1 + 1)] -
    lint[y0 * IW + (x1 + 1)] -
    lint[(y1 + 1) * IW + x0] +
    lint[y0 * IW + x0];

  // Colorize → RGB emissive.
  const out = Buffer.alloc(N * 3);
  let litPixels = 0;
  const GR = 4; // neighborhood half-size for the gap mean test
  for (let y = 0; y < H; y++) {
    const gy0 = Math.max(0, y - GR);
    const gy1 = Math.min(H - 1, y + GR);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let strength = m[i];
      if (strength > 0.004 && lum[i] < GAP_LUM) {
        const gx0 = Math.max(0, x - GR);
        const gx1 = Math.min(W - 1, x + GR);
        const meanL = lRect(gx0, gy0, gx1, gy1) / ((gx1 - gx0 + 1) * (gy1 - gy0 + 1));
        if (meanL < GAP_LUM) strength = 0; // flat-dark → atlas gap → keep black
      }
      if (strength <= 0.004) continue;
      litPixels++;
      let cr;
      let cg;
      let cb;
      if (sat[i] >= SIGN_SAT && val[i] >= SIGN_VAL) {
        const r = data[i * 3];
        const g = data[i * 3 + 1];
        const b = data[i * 3 + 2];
        const mx = Math.max(r, g, b) || 1;
        const k = 255 / mx;
        cr = r * k;
        cg = g * k;
        cb = b * k;
      } else {
        cr = WARM[0];
        cg = WARM[1];
        cb = WARM[2];
      }
      out[i * 3] = Math.round(cr * strength);
      out[i * 3 + 1] = Math.round(cg * strength);
      out[i * 3 + 2] = Math.round(cb * strength);
    }
  }
  console.log(
    `[emissive] lit pixels: ${litPixels}/${N} (${((100 * litPixels) / N).toFixed(1)}%)`,
  );

  const outW = Math.round(W * OUT_SCALE);
  const outH = Math.round(H * OUT_SCALE);
  await sharp(out, { raw: { width: W, height: H, channels: 3 } })
    .resize(outW, outH, { kernel: 'lanczos3' })
    .webp({ quality: 88 })
    .toFile(WEBP_OUT);
  console.log(`[emissive] wrote ${WEBP_OUT} (${outW}×${outH})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
