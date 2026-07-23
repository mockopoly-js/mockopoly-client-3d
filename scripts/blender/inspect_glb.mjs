import { NodeIO } from '@gltf-transform/core';

/**
 * Inspect one or more .glb files. With no args, validates all 8 token models
 * and prints a table. With file args, prints per-file detail (legacy behavior).
 *
 *   node scripts/blender/inspect_glb.mjs                       # all tokens, table
 *   node scripts/blender/inspect_glb.mjs public/models/x.glb   # single-file detail
 */

const io = new NodeIO();

async function stats(path) {
  const doc = await io.read(path);
  const root = doc.getRoot();
  let tris = 0, verts = 0, meshes = 0;
  let hasColor = false, hasNormal = false;
  const nodes = root.listNodes().length;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of root.listMeshes()) {
    meshes++;
    for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      verts += pos ? pos.getCount() : 0;
      const idx = p.getIndices();
      tris += idx ? idx.getCount() / 3 : (pos ? pos.getCount() / 3 : 0);
      if (pos) {
        const acc = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, acc);
          for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], acc[k]); max[k] = Math.max(max[k], acc[k]); }
        }
      }
      hasColor = hasColor || !!p.getAttribute('COLOR_0');
      hasNormal = hasNormal || !!p.getAttribute('NORMAL');
    }
  }
  const size = max.map((v, i) => v - min[i]);
  // footprint radius ~= half of max(x,z) extent
  const footprintR = Math.max(size[0], size[2]) / 2;
  return { nodes, meshes, verts, tris, min, max, size, footprintR, hasColor, hasNormal };
}

const TOKEN_NAMES = ['tophat', 'car', 'dog', 'ship', 'boot', 'thimble', 'wheelbarrow', 'cat'];

const fileArgs = process.argv.slice(2);

if (fileArgs.length === 0) {
  // Table mode over all token glbs, with validation.
  const { statSync } = await import('node:fs');
  console.log(
    'name         tris  verts  size(kB)  baseY   footR   COLOR_0 NORMAL nodes/meshes'
  );
  let ok = true;
  for (const name of TOKEN_NAMES) {
    const path = `public/models/tokens/${name}.glb`;
    const s = await stats(path);
    const kB = (statSync(path).size / 1024).toFixed(1);
    const baseY = s.min[1];
    const pass =
      s.hasColor && s.hasNormal && s.nodes === 1 && s.meshes === 1 &&
      Math.abs(baseY) < 0.02 && s.tris < 3000 &&
      Math.abs(s.footprintR - 0.32) < 0.06;
    if (!pass) ok = false;
    console.log(
      `${name.padEnd(12)} ${String(Math.round(s.tris)).padStart(4)} ` +
      `${String(s.verts).padStart(5)} ${kB.padStart(8)} ` +
      `${baseY.toFixed(3).padStart(7)} ${s.footprintR.toFixed(3).padStart(6)} ` +
      `${String(s.hasColor).padStart(7)} ${String(s.hasNormal).padStart(6)} ` +
      `  ${s.nodes}/${s.meshes} ${pass ? '' : '  <-- CHECK'}`
    );
  }
  console.log(ok ? '\nALL TOKENS PASS' : '\nSOME TOKENS FAILED VALIDATION');
  process.exit(ok ? 0 : 1);
} else {
  for (const path of fileArgs) {
    const s = await stats(path);
    console.log(`\n${path}`);
    console.log('  has COLOR_0', s.hasColor, 'has NORMAL', s.hasNormal);
    console.log('  bounds min', s.min.map((x) => x.toFixed(3)), 'max', s.max.map((x) => x.toFixed(3)));
    console.log('  size', s.size.map((v) => v.toFixed(3)), 'footprintR', s.footprintR.toFixed(3));
    console.log('  ', { nodes: s.nodes, meshes: s.meshes, verts: s.verts, tris: s.tris });
  }
}
