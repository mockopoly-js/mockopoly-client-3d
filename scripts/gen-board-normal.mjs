// scripts/gen-board-normal.mjs
//
// Bakes a tangent-space NORMAL MAP for the printed Monopoly board so the grid
// lines, tile text, icons, GO arrow, and colour strips read as real relief
// (engraved grooves) under the 3D scene lighting — with NO geometry change.
// The map is consumed by src/board/BoardTiles.tsx on the TOP material (index 2)
// via mat.normalMap; final strength is tuned there with normalScale.
//
// Pipeline (offline, uses the same `sharp` other gen scripts rely on):
//   1. HEIGHT FIELD — take luminance of the sharpest available board albedo,
//      lightly Gaussian-blur (~1px) to kill aliasing. Convention: LIGHT = HIGH,
//      dark lines/text = LOW  ->  dark print sinks into engraved grooves.
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
// Source selection: prefers the highest-res, sharpest, Mockopoly-branded,
// edge-to-edge board art. Candidates are probed at run time; see pickSource().
//
// Run: npm run models:board-normal

import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// The shipped albedo the board material actually samples. The normal map is
// written at THIS pixel size so it aligns 1:1 with the albedo UVs in-material.
const ALBEDO = resolve(ROOT, 'public', 'images', 'board.webp');
const OUT = resolve(ROOT, 'public', 'images', 'board-normal.webp');

// Candidate hi-res sources (built from the sharpest, but resampled to the
// albedo's dimensions so the map stays aligned). Order = preference.
const CANDIDATES = [
  resolve(homedir(), 'Downloads', 'Board.png'), // 5503²  MOCKOPOLY-branded, edge-to-edge
  ALBEDO, // shipped 2048² fallback if the hi-res source is unavailable
];

// ── Baked gradient strength ──────────────────────────────────────────────────
// Slope divisor in n.z = 1/STRENGTH. Higher STRENGTH => steeper baked normals.
// Kept MODERATE so the map is neutral-ish; the real look is dialled in-material
// with BOARD_NORMAL_STRENGTH (normalScale). ~2.0 gives visible but not cartoon
// relief before normalScale.
const STRENGTH = 2.0;
// Gaussian blur (sigma, px, evaluated at the albedo output resolution) applied
// to the height field to suppress single-pixel aliasing on the print edges.
const HEIGHT_BLUR_SIGMA = 1.0;
// OpenGL (green = +Y up). Set false for a DirectX-style (green = -Y) map.
const OPENGL_Y = true;

/** Rough sharpness proxy: stddev of grayscale luminance (higher = more detail). */
async function sharpness(file) {
  const st = await sharp(file).grayscale().stats();
  return st.channels[0].stdev;
}

/** Pick the first existing candidate; log its resolution + sharpness. */
async function pickSource() {
  for (const f of CANDIDATES) {
    if (!existsSync(f)) continue;
    const meta = await sharp(f).metadata();
    const s = await sharpness(f);
    return { file: f, width: meta.width, height: meta.height, sharpness: s };
  }
  throw new Error('No board albedo source found.');
}

async function main() {
  const src = await pickSource();
  const albedoMeta = await sharp(ALBEDO).metadata();
  const W = albedoMeta.width;
  const H = albedoMeta.height;

  console.log(`Source albedo : ${src.file.replace(homedir(), '~')}`);
  console.log(`  resolution  : ${src.width}x${src.height}  (lumaStdev=${src.sharpness.toFixed(1)})`);
  console.log(`Output size   : ${W}x${H} (matches shipped board.webp)`);

  // ── 1. HEIGHT FIELD ────────────────────────────────────────────────────────
  // Flatten any alpha over WHITE (the board's paper is light; rounded corners
  // are transparent — white keeps them "high" so no false groove rings appear),
  // grayscale (luminance), resample to the albedo size, then light blur. Values
  // are LINEAR 0..255 luminance: bright print = high, dark ink = low.
  const heightRaw = await sharp(src.file)
    .flatten({ background: '#ffffff' })
    .grayscale()
    .resize(W, H, { fit: 'fill', kernel: 'lanczos3' })
    .blur(HEIGHT_BLUR_SIGMA)
    .raw()
    .toBuffer(); // 1 channel, W*H bytes

  // ── 2. SOBEL GRADIENT -> TANGENT-SPACE NORMAL ──────────────────────────────
  const out = Buffer.alloc(W * H * 3);
  const h = (x, y) => {
    // Clamp to edge so borders don't fold; normalize 0..1.
    const xx = x < 0 ? 0 : x >= W ? W - 1 : x;
    const yy = y < 0 ? 0 : y >= H ? H - 1 : y;
    return heightRaw[yy * W + xx] / 255;
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

      // n = normalize(-dH/dx, -dH/dy, 1/strength). LIGHT=HIGH means dark grooves
      // slope inward; the -dH terms make the surface normal tilt toward the
      // brighter (higher) neighbour, which is the standard height->normal sign.
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
