/**
 * gen-city.mjs — build the committed, decoder-free `public/models/city.glb`
 * (the low-poly city that sits in the board's empty center) from the SimplePoly
 * City asset pack.
 *
 * RAW SOURCE (NOT committed — lives in the user's Downloads):
 *   ~/Downloads/uploads_files_6462436_uploads_files_328363_SimplePoly+City.FBX(1).rar
 * It contains 101 individual FBX pieces PLUS a prebuilt full-city scene at
 *   SimplePoly City.FBX/Scene/Scene_City.fbx
 * — a ready-composed diorama city, so no manual Blender layout is needed.
 *
 * Pipeline:
 *   1. bsdtar extract the .rar → /tmp/simplepoly-city-fbx  (libarchive; no unrar needed)
 *   2. Blender headless: import Scene_City.fbx → export /tmp/city-raw.glb (~18 MB,
 *      embeds the 512×512 color-atlas PNGs that carry the SimplePoly palette)
 *   3. gltf-transform CLI `optimize` (dedup → instance → palette → flatten →
 *      join → weld → resample → prune → sparse) → PLAIN glb (~5.7 MB, 0 exts).
 *      Texture dedup + instancing here is what collapses the repeated buildings
 *      (18 MB raw → ~5.7 MB); doing this by hand under-deduped, so we reuse the
 *      CLI recipe the spike validated. `--compress false` = no Draco/meshopt;
 *      `--texture-compress false` = keep the already-tiny atlases as-is (no webp);
 *      `--simplify false` = don't decimate the already-low-poly geometry.
 *
 * The SimplePoly look comes from small texture atlases (not vertex colors), so
 * we keep textures but skip texture recompression (they're already tiny). Output
 * is PLAIN glb (no Draco/meshopt/webp) → bare drei `useGLTF` loads it, no decoder.
 *
 * Run:  npm run models:city
 * Verifies size + tri/vert/mesh/texture counts + a full read-back after writing.
 */
import { NodeIO } from '@gltf-transform/core';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const RAR = process.env.CITY_RAR
  || resolve(process.env.HOME || '',
       'Downloads/uploads_files_6462436_uploads_files_328363_SimplePoly+City.FBX(1).rar');
const EXTRACT_DIR = '/tmp/simplepoly-city-fbx';
const SCENE_FBX = `${EXTRACT_DIR}/SimplePoly City.FBX/Scene/Scene_City.fbx`;
const RAW_GLB = '/tmp/city-raw.glb';
const OUT = resolve(PROJECT_ROOT, 'public/models/city.glb');

const BLENDER = process.env.BLENDER
  || '/Applications/Blender.app/Contents/MacOS/Blender';
const IMPORT_PY = resolve(__dirname, 'blender/import_city.py');

const MB = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

function run(cmd, args) {
  console.log(`[gen-city] $ ${cmd} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit' });
}

async function main() {
  // 1. Extract the .rar (idempotent — re-extract each run so it's reproducible).
  if (!existsSync(RAR)) {
    console.error(`\n[gen-city] RAW SOURCE NOT FOUND:\n  ${RAR}\n`);
    console.error('This raw asset pack is intentionally NOT committed. Place the');
    console.error('SimplePoly City .rar there (or set CITY_RAR).');
    process.exit(1);
  }
  mkdirSync(EXTRACT_DIR, { recursive: true });
  console.log(`[gen-city] extracting ${RAR} → ${EXTRACT_DIR} ...`);
  run('/usr/bin/bsdtar', ['-xf', RAR, '-C', EXTRACT_DIR]);
  if (!existsSync(SCENE_FBX)) {
    console.error(`\n[gen-city] prebuilt scene not found after extract:\n  ${SCENE_FBX}`);
    process.exit(1);
  }

  // 2. Blender: FBX → raw glb.
  if (!existsSync(BLENDER)) {
    console.error(`\n[gen-city] Blender not found at ${BLENDER} (set BLENDER env).`);
    process.exit(1);
  }
  console.log('[gen-city] Blender import Scene_City.fbx → raw glb ...');
  run(BLENDER, ['--background', '--python', IMPORT_PY, '--', SCENE_FBX, RAW_GLB]);
  if (!existsSync(RAW_GLB)) {
    console.error('[gen-city] Blender did not produce the raw glb.');
    process.exit(1);
  }
  console.log(`[gen-city] raw glb: ${MB(statSync(RAW_GLB).size)}`);

  // 3. gltf-transform CLI `optimize` → PLAIN, decoder-free. We shell out to the
  //    committed `@gltf-transform/cli` dev dep (same recipe the spike validated)
  //    because its dedup+instance+texture-dedup collapses the repeated buildings
  //    far better than a hand-rolled transform list did (18 MB → ~5.7 MB).
  console.log('[gen-city] optimizing via gltf-transform CLI (plain, no compress/texture-compress/simplify) ...');
  const CLI = resolve(PROJECT_ROOT, 'node_modules/.bin/gltf-transform');
  run(CLI, [
    'optimize', RAW_GLB, OUT,
    '--compress', 'false',
    '--texture-compress', 'false',
    '--simplify', 'false',
  ]);
  const outSize = statSync(OUT).size;

  // Read-back verification.
  const io = new NodeIO();
  const check = await io.read(OUT);
  let meshes = 0;
  let tris = 0;
  let verts = 0;
  for (const mesh of check.getRoot().listMeshes()) {
    meshes++;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      tris += idx ? idx.getCount() / 3 : (pos ? pos.getCount() / 3 : 0);
      verts += pos ? pos.getCount() : 0;
    }
  }
  const textures = check.getRoot().listTextures().length;
  const exts = check.getRoot().listExtensionsUsed().map((e) => e.extensionName);

  console.log('\n[gen-city] DONE');
  console.log(`  out:        ${OUT}`);
  console.log(`  size:       ${MB(outSize)} (${outSize} bytes)`);
  console.log(`  meshes:     ${meshes}`);
  console.log(`  triangles:  ~${Math.round(tris).toLocaleString()}`);
  console.log(`  vertices:   ~${verts.toLocaleString()}`);
  console.log(`  textures:   ${textures}`);
  console.log(`  extensions: ${exts.length ? exts.join(', ') : '(none — decoder-free)'}`);
  if (exts.some((e) => /draco|meshopt|webp/i.test(e))) {
    console.error('\n[gen-city] ERROR: output uses a decoder-only extension. Client cannot load it.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[gen-city] FAILED:', err);
  process.exit(1);
});
