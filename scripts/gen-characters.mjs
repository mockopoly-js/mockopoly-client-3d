/**
 * gen-characters.mjs — batch-convert the 52 rigged character models from ASCII
 * `.gltf` into committed, decoder-free `.glb` under `public/models/characters/`.
 *
 * RAW SOURCE (NOT committed — lives in the user's Downloads, a Quaternius/
 * KayKit-style rigged character pack, 52 files):
 *   ~/Downloads/drive-download-20260724T173400Z-1-001/glTF/*.gltf
 *
 * PIPELINE (proven in the character spike, see scratchpad/character-spike-report.md):
 *   dedup()    — merge duplicate accessors/materials
 *   weld()     — merge equal vertices
 *   resample() — drop redundant/interpolatable animation keyframes (the real win:
 *                animation keyframe data dominates each file, ~2MB gltf -> ~700KB glb)
 *   prune()    — drop orphaned nodes/accessors
 *
 * DECODER-FREE: NO Draco, NO meshopt, NO KHR_mesh_quantization. The client wires
 * no decoder — drei/three load these plain glb natively. Quantization was tested
 * and abandoned (≈5–7% gain, adds a skinning-weight footgun; resample is the
 * lossless lever that actually shrinks the dominant animation payload).
 *
 * VALIDATION: after each conversion we assert the skin survives (exactly 1 skin)
 * and NO animation clips were dropped (clipsAfter === clipsBefore, ≥16 expected).
 * A file that loses clips or its skin is reported as FAILED and the script exits
 * non-zero so a broken batch never silently commits.
 *
 * These assets are LARGE in aggregate (~35 MB) but are STATIC public/ assets
 * (never JS-bundled) and are lazy-loaded per selected character at runtime via
 * drei's per-url useGLTF cache. Only the characters actually in a game (≤8) are
 * ever resident.
 *
 * Run:  npm run models:characters
 * Or:   node scripts/gen-characters.mjs [srcDir] [outDir]
 */
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, weld, resample } from '@gltf-transform/functions';
import { readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC =
  process.argv[2] ||
  resolve(process.env.HOME, 'Downloads/drive-download-20260724T173400Z-1-001/glTF');
const OUT = process.argv[3] || resolve(process.cwd(), 'public/models/characters');

if (!existsSync(SRC)) {
  console.error(`Source directory not found: ${SRC}`);
  console.error('Point arg 1 at the glTF pack dir, e.g.:');
  console.error('  node scripts/gen-characters.mjs ~/Downloads/.../glTF');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const io = new NodeIO();

const names = readdirSync(SRC)
  .filter((f) => f.toLowerCase().endsWith('.gltf'))
  .map((f) => f.replace(/\.gltf$/i, ''))
  .sort();

if (names.length === 0) {
  console.error(`No .gltf files found in ${SRC}`);
  process.exit(1);
}

console.log(`Converting ${names.length} characters`);
console.log(`  src: ${SRC}`);
console.log(`  out: ${OUT}\n`);

let totalKB = 0;
let minKB = Infinity;
let maxKB = 0;
const failures = [];

for (const name of names) {
  const inPath = join(SRC, `${name}.gltf`);
  const outPath = join(OUT, `${name}.glb`);
  try {
    const doc = await io.read(inPath);
    const clipsBefore = doc.getRoot().listAnimations().length;

    await doc.transform(dedup(), weld(), resample(), prune());

    const clipsAfter = doc.getRoot().listAnimations().length;
    const skins = doc.getRoot().listSkins().length;

    await io.write(outPath, doc);
    const kb = statSync(outPath).size / 1024;
    totalKB += kb;
    minKB = Math.min(minKB, kb);
    maxKB = Math.max(maxKB, kb);

    const clipOk = clipsAfter === clipsBefore && clipsAfter >= 16;
    const skinOk = skins === 1;
    const flag = clipOk && skinOk ? 'ok ' : 'BAD';
    if (!clipOk || !skinOk) {
      failures.push(
        `${name}: clips ${clipsBefore}->${clipsAfter} (want >=16, no loss), skins ${skins} (want 1)`,
      );
    }
    console.log(
      `[${flag}] ${name.padEnd(22)} ${kb.toFixed(0).padStart(4)}KB  clips ${String(
        clipsBefore,
      ).padStart(2)}->${String(clipsAfter).padStart(2)}  skins ${skins}`,
    );
  } catch (err) {
    failures.push(`${name}: conversion threw — ${err.message}`);
    console.log(`[ERR] ${name.padEnd(22)} ${err.message}`);
  }
}

console.log(
  `\n${names.length} characters -> ${OUT}\n` +
    `  total: ${(totalKB / 1024).toFixed(1)} MB   avg: ${(totalKB / names.length).toFixed(
      0,
    )} KB   min: ${minKB.toFixed(0)} KB   max: ${maxKB.toFixed(0)} KB`,
);

if (failures.length) {
  console.error(`\nFAILED — ${failures.length} file(s) did not validate:`);
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log('\nAll files valid: single skin + no clip loss (>=16 clips each).');
