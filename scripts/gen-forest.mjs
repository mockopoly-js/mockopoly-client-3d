/**
 * gen-forest.mjs — optimize the raw low-poly forest GLB into a committed,
 * decoder-free, ~4.3 MB `public/models/forest.glb`.
 *
 * RAW SOURCE (NOT committed — lives in the user's Downloads):
 *   ~/Downloads/free_low_poly_forest.glb  (~86 MB, Sketchfab low-poly forest)
 *
 * Why the raw file is 86 MB: it is ~1,249 meshes / ~1.06M triangles of
 * uncompressed f32 geometry with only 2 trivial textures. The size is pure
 * geometry, so the levers are dedup + instance + join + weld + simplify — NOT
 * texture compression.
 *
 * Pipeline (all lossless-ish; simplify barely triggers because the geometry is
 * many small disjoint flora objects, so dedup/join is the real win):
 *   dedup → instance → flatten → join → weld → simplify(0.001) → prune
 *
 * Output is PLAIN glb with ZERO extensions (no Draco, no meshopt, no webp) so
 * the client's bare drei `useGLTF` loads it with no decoder wiring. See
 * scripts note: KHR_mesh_quantization is decoder-free too, but plain already
 * hits target so we keep it maximally compatible.
 *
 * Run:  npm run models:forest
 * Verifies size + tri/vert/mesh counts + a full read-back after writing.
 */
import { NodeIO } from '@gltf-transform/core';
import {
  dedup,
  instance,
  flatten,
  join,
  weld,
  simplify,
  prune,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const SRC = process.env.FOREST_SRC
  || resolve(process.env.HOME || '', 'Downloads/free_low_poly_forest.glb');
const OUT = resolve(PROJECT_ROOT, 'public/models/forest.glb');

const MB = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

async function main() {
  if (!existsSync(SRC)) {
    console.error(`\n[gen-forest] RAW SOURCE NOT FOUND:\n  ${SRC}\n`);
    console.error('This raw 86 MB asset is intentionally NOT committed. Place the');
    console.error('Sketchfab "free_low_poly_forest.glb" there (or set FOREST_SRC).');
    process.exit(1);
  }

  const io = new NodeIO();
  console.log(`[gen-forest] reading ${SRC} (${MB(statSync(SRC).size)}) ...`);
  const doc = await io.read(SRC);

  await MeshoptSimplifier.ready;
  console.log('[gen-forest] optimizing (dedup → instance → flatten → join → weld → simplify → prune) ...');
  await doc.transform(
    dedup(),
    instance({ min: 2 }),
    flatten(),
    join(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 1.0, error: 0.001 }),
    prune(),
  );

  await io.write(OUT, doc);
  const outSize = statSync(OUT).size;

  // Read-back verification: prove the committed glb re-parses and count geo.
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
  const exts = check.getRoot().listExtensionsUsed().map((e) => e.extensionName);

  console.log('\n[gen-forest] DONE');
  console.log(`  out:        ${OUT}`);
  console.log(`  size:       ${MB(outSize)} (${outSize} bytes)`);
  console.log(`  meshes:     ${meshes}`);
  console.log(`  triangles:  ~${Math.round(tris).toLocaleString()}`);
  console.log(`  vertices:   ~${verts.toLocaleString()}`);
  console.log(`  extensions: ${exts.length ? exts.join(', ') : '(none — decoder-free)'}`);
  if (exts.some((e) => /draco|meshopt|webp/i.test(e))) {
    console.error('\n[gen-forest] ERROR: output uses a decoder-only extension. Client cannot load it.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[gen-forest] FAILED:', err);
  process.exit(1);
});
