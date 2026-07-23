// scripts/gen-icons.mjs
//
// Authors the Mockopoly app icon INLINE as an SVG and rasterizes it to PNG
// with `sharp`. No downloaded assets — the glyph is drawn from scratch here.
//
// Brand: gold (#d4af37) glyph on the dark luxury background (#08080f).
// The glyph is a classic Monopoly "board corner": a rounded gold frame
// with a centered top-hat token (the app's default 3D token) sitting on a
// short baseline, plus a small "GO" arrow accent in the corner. It reads
// cleanly down to ~32px because the shapes are chunky, high-contrast, and
// centered.
//
// Outputs:
//   public/icons/icon-192.png      192x192  (purpose: any)
//   public/icons/icon-512.png      512x512  (purpose: any)
//   public/icons/maskable-512.png  512x512  (purpose: maskable, ~10% safe pad)
//
// Run: npm run icons:build

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public', 'icons');

const BG = '#08080f'; // page background
const GOLD = '#d4af37'; // primary accent
const GOLD_BRIGHT = '#f0d060'; // hover / highlight accent

/**
 * Build the icon SVG at a given canvas size.
 *
 * @param {number} size          Square canvas edge in px.
 * @param {object} [opts]
 * @param {number} [opts.inset]  Fraction (0..0.5) of the canvas kept empty
 *                               around the glyph. Used for the maskable
 *                               variant so the glyph survives circular masks.
 * @param {boolean} [opts.round] Round the background corners (nice for the
 *                               plain `any` icons; the maskable variant fills
 *                               the whole square edge-to-edge instead).
 * @returns {string} SVG markup.
 */
function buildSvg(size, opts = {}) {
  const inset = opts.inset ?? 0;
  const round = opts.round ?? true;

  // The glyph lives inside a padded box so maskable safe-zones don't clip it.
  const pad = size * inset;
  const box = size - pad * 2; // drawable square for the glyph
  const ox = pad; // glyph origin x
  const oy = pad; // glyph origin y

  // Board-corner frame: a rounded gold ring occupying most of the box.
  const frameStroke = box * 0.07;
  const frameInset = box * 0.1;
  const fx = ox + frameInset;
  const fy = oy + frameInset;
  const fw = box - frameInset * 2;
  const frameR = fw * 0.22;

  // Top-hat token, centered inside the frame. Coordinates are relative to the
  // frame's inner area so it scales with `box`.
  const cx = ox + box / 2;
  // Hat geometry (a simple, iconic silhouette).
  const hatW = box * 0.5; // brim width
  const hatH = box * 0.34; // crown height
  const crownW = hatW * 0.6;
  const brimH = hatH * 0.16;
  const hatTop = oy + box * 0.3; // y of crown top
  const brimY = hatTop + hatH; // y of brim center-line
  const crownX = cx - crownW / 2;
  const brimX = cx - hatW / 2;
  const bandY = brimY - hatH * 0.22; // hat band position
  const bandH = hatH * 0.16;

  // Baseline the hat "sits" on (evokes the GO tile edge).
  const baseY = brimY + brimH + box * 0.06;
  const baseW = box * 0.62;
  const baseX = cx - baseW / 2;
  const baseH = box * 0.045;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GOLD_BRIGHT}"/>
      <stop offset="1" stop-color="${GOLD}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" ${round ? `rx="${size * 0.18}" ry="${size * 0.18}"` : ''} fill="${BG}"/>
  <!-- board-corner frame -->
  <rect x="${fx}" y="${fy}" width="${fw}" height="${fw}" rx="${frameR}" ry="${frameR}"
        fill="none" stroke="url(#gold)" stroke-width="${frameStroke}"/>
  <!-- top-hat token -->
  <g fill="url(#gold)">
    <!-- crown -->
    <rect x="${crownX}" y="${hatTop}" width="${crownW}" height="${brimY - hatTop}" rx="${crownW * 0.12}"/>
    <!-- brim -->
    <rect x="${brimX}" y="${brimY}" width="${hatW}" height="${brimH}" rx="${brimH * 0.5}"/>
  </g>
  <!-- hat band (background color notch for definition) -->
  <rect x="${crownX}" y="${bandY}" width="${crownW}" height="${bandH}" fill="${BG}"/>
  <!-- baseline (GO tile edge) -->
  <rect x="${baseX}" y="${baseY}" width="${baseW}" height="${baseH}" rx="${baseH * 0.5}" fill="url(#gold)"/>
</svg>`;
}

async function render(name, size, opts) {
  const svg = buildSvg(size, opts);
  const png = await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toBuffer();
  const dest = resolve(OUT_DIR, name);
  await writeFile(dest, png);
  console.log(`  ${name}  (${size}x${size}, ${png.length} bytes)`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log('Generating Mockopoly icons from authored SVG:');
  // Plain icons: rounded-square background, glyph fills the tile.
  await render('icon-192.png', 192, { round: true });
  await render('icon-512.png', 512, { round: true });
  // Maskable: full-bleed background + ~10% safe padding around the glyph so
  // circular / squircle masks never clip it.
  await render('maskable-512.png', 512, { round: false, inset: 0.1 });
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
