/**
 * gen-night-sky.mjs — build the mobile-sized real night-sky equirect webps from
 * the 8K tonemapped HDRI sources on the user's Desktop (NOT committed to the
 * repo — only the resized webp output is).
 *
 * WHY: the mobile NIGHT sky previously used a cheap procedural dark-navy
 * gradient (see src/board/ProceduralSky.ts, getProceduralNightSky). This
 * script produces REAL night-sky equirects (actual stars + Milky Way baked
 * in) sized to match the existing sky.webp convention (2048×1024, matching
 * HdriSkyMobileDay/HdriSkyDesktop's daytime equirect) so they can be swapped
 * in as scene.background/scene.environment on mobile at night, at a websafe
 * size. The 8K JPG sources (13–22 MB each) are far too large to ship; this
 * downsamples to 2048×1024 webp (~a few hundred KB).
 *
 * Sources (NOT committed — Desktop only, read-only inputs):
 *   /Users/arslan/Desktop/Monopoly/NightSkyHDRI003_8K/NightSkyHDRI003_8K_TONEMAPPED.jpg
 *   /Users/arslan/Desktop/Monopoly/NightSkyHDRI008_8K/NightSkyHDRI008_8K_TONEMAPPED.jpg
 *
 * Outputs (committed):
 *   public/images/night-sky-003.webp — moonlit clean sky
 *   public/images/night-sky-008.webp — Milky Way band
 *
 * Run: node scripts/gen-night-sky.mjs
 */
import sharp from 'sharp';
import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const OUT_W = 2048;
const OUT_H = 1024;
const QUALITY = 82;

const JOBS = [
  {
    label: 'NightSkyHDRI003 (moonlit clean sky)',
    in: '/Users/arslan/Desktop/Monopoly/NightSkyHDRI003_8K/NightSkyHDRI003_8K_TONEMAPPED.jpg',
    out: resolve(PROJECT_ROOT, 'public/images/night-sky-003.webp'),
  },
  {
    label: 'NightSkyHDRI008 (Milky Way band)',
    in: '/Users/arslan/Desktop/Monopoly/NightSkyHDRI008_8K/NightSkyHDRI008_8K_TONEMAPPED.jpg',
    out: resolve(PROJECT_ROOT, 'public/images/night-sky-008.webp'),
  },
];

const KB = (n) => (n / 1024).toFixed(1) + ' KB';

async function main() {
  for (const job of JOBS) {
    console.log(`[gen-night-sky] ${job.label}: reading ${job.in} ...`);
    await sharp(job.in)
      .resize(OUT_W, OUT_H, { fit: 'fill' }) // equirect: exact target dims, no crop/pad
      .webp({ quality: QUALITY })
      .toFile(job.out);
    const size = statSync(job.out).size;
    console.log(`[gen-night-sky] wrote ${job.out} (${OUT_W}x${OUT_H}, q${QUALITY}) — ${KB(size)}`);
  }
  console.log('[gen-night-sky] done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
