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
// Grayscale HEIGHT MAP written alongside the normal map — a BINARY-MORPHOLOGY
// ink mask over the (1 - luminance) field (DARK INK = HIGH): hard threshold →
// MINIMAL dilate → tight bevel (see §1b). Faces + colour strips are gated flat;
// thin text is only barely dilated (1px) so ONLY real ink grows (coverage stays
// near ink level, ~8–12%, not flooded), and the high (2048²) tessellation in
// BoardTiles resolves the strokes as CRISP ridges; ridge sides are beveled
// smooth. Consumed by BoardTiles.tsx as mat.displacementMap on the
// subdivided top plane so the print physically RAISES as geometry (real
// silhouette relief), while the normal map keeps supplying fine per-pixel
// detail. Same dims/basis as the albedo (2048×2048), LINEAR (displacement is NOT
// colour, so NO sRGB encode).
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

// ── DISPLACEMENT (height map) MORPHOLOGY: THRESHOLD → DILATE → BEVEL ──────────
// These affect ONLY the displacementMap output (board-height.webp), NOT the
// normal-map bake. A previous bake OVER-DILATED (2px @ 0.2 cut): it grew the
// real ~7% ink mask to ~41% board coverage, so large areas rose as broad soft
// mounds → WOBBLY relief. The fix is SURGICAL — a classic BINARY MORPHOLOGY
// pipeline on the inverted height h = 1 - luminance (DARK INK = HIGH) that grows
// ONLY real ink, then lets the high tessellation (2048² verts in BoardTiles)
// resolve thin strokes as crisp ridges instead of relying on fat dilation:
//
//   1. HARD THRESHOLD → clean binary ink mask
//        binary = (h > INK_CUT) ? 1 : 0                      (INK_CUT = 0.55)
//      Zeroes near-white tile FACES (h≈0.05–0.30) AND mid-tone COLOUR STRIPS
//      (h≈0.3–0.5) outright — NO face/strip noise can ever displace. Only
//      near-black ink (text, lines, borders, icons, GO arrow, h≳0.55) → 1.
//      Raw-binary coverage should be SMALL (~6–8%); it is logged at bake time.
//
//   2. MINIMAL DILATE (barely grow) the binary ink so 1px gaps in thin strokes
//      close into solid ridges — NOT a flood:
//        dilated = (blur(binary, DILATE_PX) > DILATE_CUT) ? 1 : 0
//      Blur+threshold = morphological dilation. DILATE_PX = 1 with a HIGH cut
//      (0.4) grows the mask by only ~1px — just enough to make thin strokes solid
//      without smearing them into blobs. Because faces are ALREADY 0 (step 1),
//      the blur has nothing to smear up from them. Post-dilate coverage should
//      land ~8–12% board-wide (NOT ~41%); it is logged at bake time. Keeping
//      coverage near real-ink level is what KILLS the wobble — crispness then
//      comes from tessellation, not from dilation.
//
//   3. TIGHT BEVEL BLUR → smooth ridge sides just enough (kill stair-steps):
//        height = blur(dilated, BEVEL_PX)                    (~0.6px, small)
//      A small blur softens the binary walls into crisp beveled ramps so the ridge
//      sides read clean from a grazing angle, WITHOUT mushing the thin ridge tops.
//
// Tune: INK_CUT UP if faces still lift / DOWN if faint ink vanishes; DILATE_PX up
// only if 1px strokes still break up (at the cost of coverage/wobble); BEVEL_PX up
// for softer sides. Because step 1 is a HARD binary, faces + strips are flat.
const INK_CUT = 0.55;
const DILATE_PX = 1;
const DILATE_CUT = 0.4;
const BEVEL_PX = 0.6;
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

  // ── 1b. HEIGHT MAP OUTPUT (displacementMap) — MORPHOLOGY, LINEAR ───────────
  // Displacement is sampled in the VERTEX shader over a 2048²-vertex grid (~1px
  // per vertex — thin strokes now span enough verts to form defined ridges). A
  // previous bake OVER-DILATED (2px @ 0.2) to ~41% coverage → broad soft mounds
  // = WOBBLY. Replace with a SURGICAL binary MORPHOLOGY on the inverted height
  // h = 1 - luminance (DARK INK = HIGH): THRESHOLD → MINIMAL DILATE → TIGHT BEVEL.
  //
  //   1. binary  = (h > INK_CUT) ? 1 : 0     hard gate — faces + colour strips
  //                                          go to a FLAT 0 (no face noise), only
  //                                          near-black ink stays 1. (~6–8% cov.)
  //   2. dilated = (blur(binary, DILATE_PX) > DILATE_CUT) ? 1 : 0
  //                                          BARELY grow ink (1px @ 0.4) — just
  //                                          close 1px gaps so thin strokes are
  //                                          solid, NOT flood the faces. Faces are
  //                                          already 0 so the blur only touches
  //                                          real ink. (~8–12% cov, NOT 41%.)
  //   3. height  = blur(dilated, BEVEL_PX)   tight blur (0.6px) → crisp beveled
  //                                          ridge sides (kills stair-steps, keeps
  //                                          thin ridge tops sharp).
  //
  // Coverage of the raw binary and of the dilated mask are logged so the bake can
  // be verified to stay near ink level (crispness comes from tessellation).
  // Written at the albedo's native size, single grayscale channel, LINEAR (raw
  // ->webp keeps values as authored — displacement, like normals, is not colour).

  // Step 1 — HARD THRESHOLD to a clean binary ink mask.
  const binary = Buffer.alloc(W * H);
  const inkCut255 = INK_CUT * 255; // compare on the inverted height h = 1 - luma
  let rawInkPx = 0;
  for (let p = 0; p < binary.length; p++) {
    const hgt = 255 - heightRaw[p]; // DARK INK = HIGH, 0..255
    if (hgt > inkCut255) {
      binary[p] = 255;
      rawInkPx++;
    } else {
      binary[p] = 0;
    }
  }
  const rawCoveragePct = (rawInkPx / binary.length) * 100;

  // Step 2 — DILATE: blur the binary then re-threshold LOW (classic dilation).
  const binaryBlurred = await sharp(binary, { raw: { width: W, height: H, channels: 1 } })
    .blur(DILATE_PX)
    .raw()
    .toBuffer();
  const dilated = Buffer.alloc(W * H);
  const dilateCut255 = DILATE_CUT * 255;
  let dilatedInkPx = 0;
  for (let p = 0; p < dilated.length; p++) {
    if (binaryBlurred[p] > dilateCut255) {
      dilated[p] = 255;
      dilatedInkPx++;
    } else {
      dilated[p] = 0;
    }
  }
  const dilatedCoveragePct = (dilatedInkPx / dilated.length) * 100;

  // Step 3 — LIGHT BEVEL BLUR: smooth ridge sides without eroding the ridge tops.
  const heightField = await sharp(dilated, { raw: { width: W, height: H, channels: 1 } })
    .blur(BEVEL_PX)
    .raw()
    .toBuffer();
  // Mean height (0..1) after the bevel — a proxy for overall raised area/height.
  let heightSum = 0;
  for (let p = 0; p < heightField.length; p++) heightSum += heightField[p];
  const meanPct = (heightSum / heightField.length / 255) * 100;
  await sharp(heightField, { raw: { width: W, height: H, channels: 1 } })
    .webp({ quality: 90 })
    .toFile(OUT_HEIGHT);
  const heightStat = await stat(OUT_HEIGHT);
  console.log(
    `Wrote height  : ${OUT_HEIGHT.replace(ROOT + '/', '')} (${heightStat.size} bytes) [morphology: threshold(>${INK_CUT}) → dilate(${DILATE_PX}px@${DILATE_CUT}) → bevel(${BEVEL_PX}px)]`,
  );
  console.log(
    `  coverage    : raw-binary=${rawCoveragePct.toFixed(1)}% (target ~6–8%)  post-dilate=${dilatedCoveragePct.toFixed(1)}% (target ~8–12%, NOT 41%)  mean=${meanPct.toFixed(1)}%`,
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
