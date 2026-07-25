// scripts/gen-board-normal.mjs
//
// Bakes a tangent-space NORMAL MAP for the printed Monopoly board so the grid
// lines, tile text, icons, GO arrow, and colour strips read as real relief
// (engraved grooves) under the 3D scene lighting — with NO geometry change.
// The map is consumed by src/board/BoardTiles.tsx on the TOP material (index 2)
// via mat.normalMap; final strength is tuned there with normalScale.
//
// Pipeline (offline, uses the same `sharp` other gen scripts rely on):
//   1. HEIGHT FIELD — take luminance of the SHIPPED board albedo (the exact same
//      image the material samples), lightly Gaussian-blur (~1px) to kill
//      aliasing. Convention: DARK INK = HIGH, light paper = LOW  ->  the black
//      grid lines, tile text, icons, GO arrow, and price text EMBOSS OUTWARD
//      (raised relief, popping off the board) rather than sinking in. This is
//      height = (1 - luminance).
//   2. NORMAL — Sobel gradient of the height field:
//        n = normalize( -dH/dx, -dH/dy, 1/strength )
//      encoded to RGB [0..1] with B≈up (a flat area => ~(0.5,0.5,1.0)).
//      OpenGL convention: green = +Y up (dH/dy uses image-Y flipped so that
//      "up" in texture space points +Y). The baked gradient strength is kept
//      moderate/neutral-ish; the artistic amount lives in normalScale.
//   3. OUTPUT — public/images/board-normal.webp at the SHIPPED albedo's pixel
//      dimensions, quality ~90, LINEAR data (normal maps are NOT colour, so
//      NO sRGB encode is applied — sharp's raw->webp keeps values as authored).
//
// Source selection: the normal map is generated ONLY from the shipped albedo
// (public/images/board.webp) so it lives in the IDENTICAL pixel basis as the
// texture the board material displays. This is what guarantees the relief lands
// pixel-for-pixel on the print (no neighbour-tile bleed) — any other source
// (e.g. a Downloads Board.png with different framing/orientation) would produce
// a map that does not line up 1:1 with the albedo UVs.
//
// Run: npm run models:board-normal

import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// The shipped albedo the board material actually samples. The normal map is
// generated FROM and written AT this exact image so it lives in the identical
// pixel basis — the ONLY way to guarantee 1:1 alignment with the albedo UVs.
const ALBEDO = resolve(ROOT, 'public', 'images', 'board.webp');
const OUT = resolve(ROOT, 'public', 'images', 'board-normal.webp');
// Grayscale HEIGHT MAP written alongside the normal map — the SAME blurred
// (1 - luminance) height field the normal bake derives from (DARK INK = HIGH).
// Consumed by BoardTiles.tsx as mat.displacementMap on the subdivided top plane
// so the print physically RAISES as geometry (real silhouette relief), while the
// normal map keeps supplying the fine per-pixel detail. Same dims/basis as the
// albedo (2048×2048), LINEAR (displacement is NOT colour, so NO sRGB encode).
const OUT_HEIGHT = resolve(ROOT, 'public', 'images', 'board-height.webp');

// ── Baked gradient strength ──────────────────────────────────────────────────
// Slope divisor in n.z = 1/STRENGTH. Higher STRENGTH => steeper baked normals.
// Kept MODERATE so the map is neutral-ish; the real look is dialled in-material
// with BOARD_NORMAL_STRENGTH (normalScale). ~2.0 gives visible but not cartoon
// relief before normalScale.
const STRENGTH = 2.0;
// Gaussian blur (sigma, px, evaluated at the albedo output resolution) applied
// to the height field to suppress single-pixel aliasing on the print edges.
const HEIGHT_BLUR_SIGMA = 1.0;

// ── DISPLACEMENT (height map) DILATE + CONTRAST ──────────────────────────────
// These affect ONLY the displacementMap output (board-height.webp), NOT the
// normal-map bake. The vertex-shader displacement grid (1024²) is far coarser
// than the 2048² texture, so thin ink must be fattened + solidified to survive.
//   DILATE_BLUR_SIGMA — px blur to GROW the raised ink into a fatter halo before
//                       the remap (approximates a ~2–3 px morphological dilate).
//   REMAP_LO/REMAP_HI — normalized [0..1] contrast window applied AFTER the blur:
//                       everything ≥ HI (ink + its halo) → full height 1, every-
//                       thing ≤ LO (paper) → 0. Window [0.12..0.55] lifts the
//                       blurred halo to solid and crushes paper flat.
const DILATE_BLUR_SIGMA = 2.0;
const REMAP_LO = 0.12;
const REMAP_HI = 0.55;
// OpenGL (green = +Y up). Set false for a DirectX-style (green = -Y) map.
const OPENGL_Y = true;

/** Rough sharpness proxy: stddev of grayscale luminance (higher = more detail). */
async function sharpness(file) {
  const st = await sharp(file).grayscale().stats();
  return st.channels[0].stdev;
}

async function main() {
  if (!existsSync(ALBEDO)) {
    throw new Error(`Shipped board albedo not found: ${ALBEDO}`);
  }
  const albedoMeta = await sharp(ALBEDO).metadata();
  const W = albedoMeta.width;
  const H = albedoMeta.height;
  const lumaStdev = await sharpness(ALBEDO);

  console.log(`Source albedo : ${ALBEDO.replace(ROOT + '/', '')}`);
  console.log(`  resolution  : ${W}x${H}  (lumaStdev=${lumaStdev.toFixed(1)})`);
  console.log(`Output size   : ${W}x${H} (matches shipped board.webp exactly)`);

  // ── 1. HEIGHT FIELD ────────────────────────────────────────────────────────
  // Flatten any alpha over WHITE (paper is light), grayscale (luminance) at the
  // albedo's native size, then light blur. Values are LINEAR 0..255 luminance;
  // the DARK-INK = HIGH inversion (height = 1 - luma) is applied in the Sobel
  // loop below via h(). No resize is needed — we work in the albedo's own basis.
  const heightRaw = await sharp(ALBEDO)
    .flatten({ background: '#ffffff' })
    .grayscale()
    .blur(HEIGHT_BLUR_SIGMA)
    .raw()
    .toBuffer(); // 1 channel, W*H bytes

  // ── 1b. HEIGHT MAP OUTPUT (displacementMap) — LINEAR grayscale ─────────────
  // Displacement is sampled in the VERTEX shader over a 1024²-vertex grid, so a
  // thin single-pixel ink stroke on a 2048² map almost never lands on a vertex —
  // and even when it does, bilinear averaging with the surrounding paper crushes
  // it toward zero. To make letters/lines/borders survive as REAL raised
  // geometry we must (a) start from the DARK-INK=HIGH field, (b) DILATE the ink
  // so thin strokes fatten into ridges that MULTIPLE vertices sample, and (c)
  // make the ink SOLID (full height) with paper crushed flat to 0.
  //
  // sharp has no morphological dilate, so we approximate it: BLUR the inverted
  // height (~DILATE_BLUR_SIGMA px) to spread each ink stroke into a soft halo,
  // THEN apply a hard contrast/remap curve [REMAP_LO..REMAP_HI] -> [0..1] with
  // clamp. The blur's halo now sits inside the remap window, so ink + its
  // neighbourhood lift to FULL height (a fattened solid ridge) while the paper
  // floor (below REMAP_LO) is crushed to 0. Net = solid, slightly-thickened
  // raised letters/lines/borders with a flat paper base.
  //
  // Written at the albedo's native size, single grayscale channel, LINEAR (raw
  // ->webp keeps values as authored — displacement, like normals, is not colour).
  const invRaw = Buffer.alloc(W * H);
  for (let p = 0; p < invRaw.length; p++) {
    invRaw[p] = 255 - heightRaw[p]; // DARK INK = HIGH
  }
  // Blur to grow (dilate-approx) the raised ink into a fatter halo.
  const dilated = await sharp(invRaw, { raw: { width: W, height: H, channels: 1 } })
    .blur(DILATE_BLUR_SIGMA)
    .raw()
    .toBuffer();
  // Hard contrast/remap: [REMAP_LO..REMAP_HI] normalized -> [0..1], clamped.
  // Anything at/above REMAP_HI (ink + its blurred halo) → 255 (full raise);
  // anything at/below REMAP_LO (paper) → 0 (flat). This both SOLIDIFIES and
  // slightly FATTENS the ink so the coarse vertex grid resolves it as ridges.
  const lo = Math.round(REMAP_LO * 255);
  const hi = Math.round(REMAP_HI * 255);
  const span = Math.max(1, hi - lo);
  const heightField = Buffer.alloc(W * H);
  for (let p = 0; p < heightField.length; p++) {
    const v = ((dilated[p] - lo) / span) * 255;
    heightField[p] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }
  await sharp(heightField, { raw: { width: W, height: H, channels: 1 } })
    .webp({ quality: 90 })
    .toFile(OUT_HEIGHT);
  const heightStat = await stat(OUT_HEIGHT);
  console.log(
    `Wrote height  : ${OUT_HEIGHT.replace(ROOT + '/', '')} (${heightStat.size} bytes) [dark ink = high]`,
  );

  // ── 2. SOBEL GRADIENT -> TANGENT-SPACE NORMAL ──────────────────────────────
  const out = Buffer.alloc(W * H * 3);
  const h = (x, y) => {
    // Clamp to edge so borders don't fold; normalize 0..1 then INVERT so DARK
    // INK = HIGH. height = 1 - luminance makes the black grid lines, tile text,
    // icons, GO arrow, and price text emboss OUTWARD (raised), while the light
    // paper stays LOW. This is the "pops out" convention the design calls for.
    const xx = x < 0 ? 0 : x >= W ? W - 1 : x;
    const yy = y < 0 ? 0 : y >= H ? H - 1 : y;
    return 1 - heightRaw[yy * W + xx] / 255;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Sobel kernels (3x3) for dH/dx and dH/dy.
      const tl = h(x - 1, y - 1),
        tc = h(x, y - 1),
        tr = h(x + 1, y - 1);
      const ml = h(x - 1, y),
        mr = h(x + 1, y);
      const bl = h(x - 1, y + 1),
        bc = h(x, y + 1),
        br = h(x + 1, y + 1);

      // Gradient of height across the surface.
      const dHdx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      // Image-Y grows DOWN. For OpenGL (+Y up) we negate so texture-space "up"
      // points +Y; DirectX would keep the raw sign.
      const dHdyImg = bl + 2 * bc + br - (tl + 2 * tc + tr);
      const dHdy = OPENGL_Y ? -dHdyImg : dHdyImg;

      // n = normalize(-dH/dx, -dH/dy, 1/strength). With DARK-INK=HIGH (height =
      // 1 - luma), the -dH terms tilt the surface normal toward the HIGHER (now
      // the inked) neighbour, so the print reads as RAISED ridges — the standard
      // height->normal sign, just fed the inverted height field.
      let nx = -dHdx;
      let ny = -dHdy;
      const nz = 1 / STRENGTH;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      const nzn = nz * inv;

      // Encode [-1,1] -> [0,1] (B≈up, flat => ~0.5,0.5,1.0).
      const i = (y * W + x) * 3;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nzn * 0.5 + 0.5) * 255);
    }
  }

  // ── 3. OUTPUT (LINEAR — no sRGB) ───────────────────────────────────────────
  // Raw RGB straight to webp. sharp does NOT gamma-encode raw input, so the
  // authored linear normal values are preserved (normal maps must stay linear).
  await sharp(out, { raw: { width: W, height: H, channels: 3 } })
    .webp({ quality: 90 })
    .toFile(OUT);

  const outStat = await stat(OUT);
  console.log(`Wrote         : ${OUT.replace(ROOT + '/', '')} (${outStat.size} bytes)`);
  console.log(`Baked strength: ${STRENGTH}  blurSigma=${HEIGHT_BLUR_SIGMA}  OpenGL_Y=${OPENGL_Y}`);
  console.log('Done. Tune final relief with BOARD_NORMAL_STRENGTH in BoardTiles.tsx.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
