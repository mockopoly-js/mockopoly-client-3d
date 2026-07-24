/**
 * gen-forest.mjs — build the committed, decoder-free `public/models/forest.glb`
 * used by `src/board/ForestEnvironment.tsx` to ring the board with real trees.
 *
 * RAW SOURCE (NOT committed — lives in the user's Downloads):
 *   ~/Downloads/free_low_poly_forest.glb  (~86 MB, Sketchfab low-poly forest)
 *
 * WHY THE PREVIOUS BUILD LOOKED LIKE ONE GIANT MOUNTAIN
 * ----------------------------------------------------
 * The raw file is a genuine demo diorama: ~1,249 individually placed objects
 * (trees, birches, meadows, rocks, flowers, mushrooms, lake, and a handful of
 * "moss mountain" props) spread across a HUGE, OFF-CENTER footprint
 * (~47,000 × 28,000 units, centered near (-8059, 2699)). The scene is actually
 * FLAT — total Y extent is only ~1,400 units.
 *
 * The old pipeline registered NO extensions, so `instance({min:2})` could not
 * emit EXT_mesh_gpu_instancing and instead the later `join()` FUSED every copy
 * of each prop into a single mesh whose bbox spanned the whole 4,000+ unit
 * scene. The two "moss mountain" mega-meshes then became solid ~4,000-wide,
 * ~2,100-tall blobs — and after the client's auto-fit + a camera 11 units from
 * origin, the camera sat INSIDE that blob: "one brown/green mountain".
 *
 * THE FIX (this script)
 * ---------------------
 *   1. REGISTER EXTMeshGPUInstancing so `instance()` produces real,
 *      decoder-free GPU instances (three/drei load it natively) instead of the
 *      pipeline silently falling back to fusing geometry.
 *   2. CROP to a square window around the world origin (CROP_HALF). Around the
 *      origin the raw scene has a natural CLEARING (only ~2 trees within 3,000
 *      units of center) ringed by trees/rocks/flowers at r≈3,000–6,000 — exactly
 *      the "board in a forest clearing" look. The crop ALSO drops every moss
 *      mountain (they all live beyond r≈10,000), so no mountain can reappear.
 *   3. DO NOT `join()` (it fuses distinct props into blobs) and DO NOT simplify
 *      (the low-poly trees are already tiny; decimation just melts their shape).
 *      dedup + instance + weld + prune alone shrink it far below target because
 *      the scene is hundreds of repeated props.
 *
 * Output is decoder-free: the ONLY extension it may carry is
 * EXT_mesh_gpu_instancing, which is NOT a compression codec — three.js loads it
 * with no Draco/meshopt/webp decoder wiring. The script hard-fails if any
 * decoder-only extension (draco/meshopt/webp) sneaks in.
 *
 * Run:  npm run models:forest
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  instance,
  weld,
  prune,
  createTransform,
} from '@gltf-transform/functions';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const SRC = process.env.FOREST_SRC
  || resolve(process.env.HOME || '', 'Downloads/free_low_poly_forest.glb');
const OUT = resolve(PROJECT_ROOT, 'public/models/forest.glb');

/**
 * Half-size (in RAW source units) of the square kept around the world origin.
 * The raw scene is ~47k×28k units, flat. ±8000 keeps the natural clearing at
 * center + a full ring of trees/rocks/meadow/flowers and drops all the distant
 * moss-mountain props (they sit beyond r≈10,000). Tune if you want a denser or
 * wider treeline; keep it small enough to exclude the mountains (< ~9000).
 */
const CROP_HALF = Number(process.env.FOREST_CROP_HALF || 8000);

const MB = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

/** Column-major mat4 helpers (mirror three's Matrix4) for world-space cropping. */
function mul(a, b) {
  const o = new Array(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      o[r * 4 + c] = s;
    }
  return o;
}
function fromTRS(t, q, s) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

/**
 * Custom transform: delete any mesh-bearing node whose WORLD center falls
 * outside the ±CROP_HALF square (x/z). Runs BEFORE instance()/prune() so the
 * dropped props never contribute to instancing or the final bounds.
 */
function cropToWindow(half) {
  return createTransform('cropToWindow', (doc) => {
    const root = doc.getRoot();
    const toRemove = [];

    const walk = (node, parentM) => {
      const local = fromTRS(node.getTranslation(), node.getRotation(), node.getScale());
      const world = mul(parentM, local);
      const mesh = node.getMesh();
      if (mesh) {
        // World-space bbox center of this node's geometry.
        let min = [1e30, 1e30, 1e30];
        let max = [-1e30, -1e30, -1e30];
        for (const prim of mesh.listPrimitives()) {
          const pos = prim.getAttribute('POSITION');
          if (!pos) continue;
          const arr = pos.getArray();
          for (let i = 0; i < arr.length; i += 3) {
            const px = arr[i], py = arr[i + 1], pz = arr[i + 2];
            const wx = world[0] * px + world[4] * py + world[8] * pz + world[12];
            const wy = world[1] * px + world[5] * py + world[9] * pz + world[13];
            const wz = world[2] * px + world[6] * py + world[10] * pz + world[14];
            if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
            if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
            if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
          }
        }
        const cx = (min[0] + max[0]) / 2;
        const cz = (min[2] + max[2]) / 2;
        if (Math.abs(cx) > half || Math.abs(cz) > half) toRemove.push(node);
      }
      for (const c of node.listChildren()) walk(c, world);
    };

    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const scene of root.listScenes())
      for (const n of scene.listChildren()) walk(n, I);

    for (const node of toRemove) node.dispose();
    console.log(`[gen-forest] cropToWindow ±${half}: removed ${toRemove.length} out-of-window nodes`);
  });
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`\n[gen-forest] RAW SOURCE NOT FOUND:\n  ${SRC}\n`);
    console.error('This raw 86 MB asset is intentionally NOT committed. Place the');
    console.error('Sketchfab "free_low_poly_forest.glb" there (or set FOREST_SRC).');
    process.exit(1);
  }

  // Register ALL extensions so instance() can emit EXT_mesh_gpu_instancing and
  // the writer serializes it. (We forbid decoder-only extensions below.)
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  console.log(`[gen-forest] reading ${SRC} (${MB(statSync(SRC).size)}) ...`);
  const doc = await io.read(SRC);

  console.log('[gen-forest] optimizing (crop → dedup → instance → weld → prune; NO join, NO simplify) ...');
  await doc.transform(
    cropToWindow(CROP_HALF),
    dedup(),
    instance({ min: 2 }), // real GPU instances — keeps every tree as a tree
    weld(),
    prune(),
  );

  await io.write(OUT, doc);
  const outSize = statSync(OUT).size;

  // Read-back verification: prove the committed glb re-parses and count geo.
  const check = await io.read(OUT);
  const cRoot = check.getRoot();
  let meshes = 0;
  let tris = 0;
  let verts = 0;
  let treeMeshes = 0;
  for (const mesh of cRoot.listMeshes()) {
    meshes++;
    if (/tree/i.test(mesh.getName() || '')) treeMeshes++;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      tris += idx ? idx.getCount() / 3 : (pos ? pos.getCount() / 3 : 0);
      verts += pos ? pos.getCount() : 0;
    }
  }
  // Count instanced placements so we can confirm trees weren't fused into blobs.
  let instancedNodes = 0;
  let instancePlacements = 0;
  for (const node of cRoot.listNodes()) {
    const inst = node.getExtension && node.getExtension('EXT_mesh_gpu_instancing');
    if (inst) {
      instancedNodes++;
      const tr = inst.getAttribute && inst.getAttribute('TRANSLATION');
      instancePlacements += tr ? tr.getCount() : 0;
    }
  }
  const exts = cRoot.listExtensionsUsed().map((e) => e.extensionName);

  console.log('\n[gen-forest] DONE');
  console.log(`  out:              ${OUT}`);
  console.log(`  size:             ${MB(outSize)} (${outSize} bytes)`);
  console.log(`  meshes:           ${meshes} (of which named "tree": ${treeMeshes})`);
  console.log(`  triangles:        ~${Math.round(tris).toLocaleString()}`);
  console.log(`  vertices:         ~${verts.toLocaleString()}`);
  console.log(`  instanced nodes:  ${instancedNodes} (placements: ${instancePlacements})`);
  console.log(`  extensions:       ${exts.length ? exts.join(', ') : '(none)'}`);

  if (exts.some((e) => /draco|meshopt|webp|avif/i.test(e))) {
    console.error('\n[gen-forest] ERROR: output uses a decoder-only extension. Client cannot load it.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[gen-forest] FAILED:', err);
  process.exit(1);
});
