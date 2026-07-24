/**
 * gen-character-thumbnails.mjs — render a static portrait PNG for each of the 52
 * character SKINS (CT4, Part A), for the Fortnite-locker grid on CharacterSelect.
 *
 * Runs the headless-Blender renderer (scripts/blender/gen_character_thumbnails.py)
 * which, per source `.gltf`:
 *   - imports the rigged model,
 *   - poses it to a mid-frame of the **Idle** action (natural stance, not T/bind),
 *   - frames a fixed front ~3/4 camera + soft even lighting on a TRANSPARENT bg,
 *   - renders a square PNG to public/images/characters/<id>.png.
 *
 * The grid cards use these STATIC images (52 <img> tags), NOT 52 live canvases —
 * only the big preview on the right is a live R3F canvas. Thumbnails are small
 * public assets (never JS-bundled), lazy-served by the dev/prod static server.
 *
 * Run:  npm run models:thumbnails
 * Or:   node scripts/gen-character-thumbnails.mjs [srcDir] [outDir] [size]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const BLENDER = process.env.BLENDER_BIN || '/Applications/Blender.app/Contents/MacOS/Blender';
const PY = resolve(__dirname, 'blender', 'gen_character_thumbnails.py');

const SRC =
  process.argv[2] ||
  resolve(process.env.HOME, 'Downloads/drive-download-20260724T173400Z-1-001/glTF');
const OUT = process.argv[3] || resolve(PROJECT_ROOT, 'public/images/characters');
const SIZE = process.argv[4] || '320';

if (!existsSync(BLENDER)) {
  console.error(`Blender not found at ${BLENDER}. Set BLENDER_BIN to override.`);
  process.exit(1);
}
if (!existsSync(SRC)) {
  console.error(`Source glTF dir not found: ${SRC}`);
  process.exit(1);
}

console.log(`Rendering character thumbnails`);
console.log(`  blender: ${BLENDER}`);
console.log(`  src:     ${SRC}`);
console.log(`  out:     ${OUT}`);
console.log(`  size:    ${SIZE}x${SIZE}\n`);

const res = spawnSync(
  BLENDER,
  ['--background', '--python', PY, '--', SRC, OUT, SIZE],
  { stdio: 'inherit' },
);

if (res.status !== 0) {
  console.error(`\nBlender render failed (exit ${res.status}).`);
  process.exit(res.status || 1);
}

// Report the resulting portraits.
const pngs = existsSync(OUT)
  ? readdirSync(OUT).filter((f) => f.toLowerCase().endsWith('.png'))
  : [];
let totalKB = 0;
let minKB = Infinity;
let maxKB = 0;
for (const f of pngs) {
  const kb = statSync(join(OUT, f)).size / 1024;
  totalKB += kb;
  minKB = Math.min(minKB, kb);
  maxKB = Math.max(maxKB, kb);
}
console.log(
  `\n${pngs.length} portraits -> ${OUT}\n` +
    `  total: ${(totalKB / 1024).toFixed(2)} MB   avg: ${(totalKB / (pngs.length || 1)).toFixed(
      0,
    )} KB   min: ${minKB.toFixed(0)} KB   max: ${maxKB.toFixed(0)} KB`,
);
