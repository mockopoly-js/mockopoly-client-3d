/**
 * gen-forest-mobile.mjs — build the MOBILE-ONLY forest variant
 * `public/models/forest.mobile.glb` from the committed, desktop-frozen
 * `public/models/forest.glb`.
 *
 * WHY: the shared desktop `forest.glb` is a decoder-free, GPU-instanced diorama
 * (~2.0 MB, 23 prop types / 1,162 instances / ~991K rendered tris). It is fine
 * on desktop but the download/parse cost and per-instance triangle load are
 * heavier than a low-end mobile GPU wants. This script produces a
 * VISUALLY-NEAR-IDENTICAL variant loaded at runtime only when `isMobile`.
 * Desktop keeps `forest.glb` byte-identical.
 *
 * TWO INVISIBLE / NEAR-INVISIBLE OPTIMIZATIONS
 * --------------------------------------------
 *   (A) MESHOPT compression on the whole asset (EXT_meshopt_compression, FILTER
 *       method). Smaller download + faster parse, ZERO visual change. The
 *       decoder is bundled in three-stdlib and auto-installed by drei's useGLTF,
 *       so NO decoder wiring is needed on the client. We deliberately use the
 *       FILTER method (NOT quantize): quantize bakes a non-zero dequantization
 *       OFFSET into the mesh — turning geometry.boundingBox into quantized ints
 *       and shifting instance origins — which would corrupt BOTH the chunker's
 *       instance-position reads AND ForestEnvironment's vertical-anchor sampler
 *       (`instPos.y + geomMaxY*scaleY`). FILTER keeps every vertex + instance
 *       transform in the original FLOAT space (verified byte-identical instance
 *       T/S), so all downstream position math is unchanged.
 *
 *   (B) TRUE far-chunk LOD: every SMALL-PROP relief type (trees, flowers,
 *       mushrooms, grass, rocks) keeps its FULL geometry AND gains a decimated
 *       `<name>_LOD` sibling mesh (kept ~50%). MOUNTAINS are EXCLUDED — they are
 *       large relief surfaces like the ground and their decimation tore the ridge
 *       on device, so they keep full geometry with NO `_LOD` (see below). The
 *       chunker (mobile only) points
 *       FAR chunks — those whose every instance sits beyond FOREST_THIN_DISTANCE
 *       from the board — at the `_LOD` geometry while NEAR chunks keep full
 *       detail. Static distance-from-board (the camera stays near the board), so
 *       nothing pops mid-motion. The `_LOD` meshes ride in the glb as
 *       non-instanced nodes at the origin; ForestEnvironment harvests their
 *       geometry into a lookup and removes them before they can render.
 *
 * LARGE-RELIEF DECIMATION (GROUND + MOUNTAINS) — REMOVED. Earlier builds
 * decimated the flat ground tiles (Meadow / Meadow_Path / Lake_Ground) ~90% in
 * place on the assumption they were near-planar. They are NOT: the tiles carry
 * ~12-15% Y-relief, so the position-weld + simplify + attribute-rebuild mangled
 * their surface, UVs and normals — producing a torn/jagged ground on device. The
 * MOUNTAINS (Forest_Mountain_Moss_*) hit the SAME failure: they are large relief
 * surfaces, and their `_LOD` decimation tore the peaks/ridge (a visible gash/seam)
 * on device. BOTH now keep their ORIGINAL geometry and get NO `_LOD` sibling, so
 * the runtime chunker falls back to the full geometry for them. Both are still
 * chunked + frustum-culled at runtime, so there is no perf regression. Grass is
 * NOT ground here — the geometry scan showed PP_Grass_* to be small 3D relief
 * tufts, so it stays a relief type with an `_LOD`.
 *
 * meshoptimizer's simplifier collapses edges in the INDEX topology. The source
 * props are hard-edged low-poly "triangle soup": corner positions are bitwise
 * identical but per-face normals differ, so an attribute-preserving weld leaves
 * almost no shared edges and the simplifier can barely reduce anything (this is
 * the failure the original gen-forest.mjs banner warned about). We therefore
 * position-weld first (canonicalize vertices by rounded POSITION only, ignoring
 * normals/uvs), simplify on that connected topology, then rebuild the attribute
 * streams from a representative source vertex per canonical position.
 *
 * EXT_mesh_gpu_instancing, the single shared material, UVs and normals are all
 * preserved; all 1,162 instances survive.
 *
 * Run:  npm run models:forest:mobile
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const IN = resolve(PROJECT_ROOT, 'public/models/forest.glb');
const OUT = resolve(PROJECT_ROOT, 'public/models/forest.mobile.glb');

/**
 * FLAT ground tiles — Meadow / Meadow_Path / Lake_Ground. These now KEEP their
 * ORIGINAL geometry: decimation was REMOVED (see the banner — the tiles carry
 * ~12-15% Y-relief and the simplify pass tore the surface on device). We still
 * MATCH them here to route them AWAY from the relief branch so they get NO `_LOD`
 * sibling; the runtime chunker then falls back to their full geometry. Grass is
 * intentionally EXCLUDED: the geometry scan measured PP_Grass_11/15 as small
 * bushy 3D tufts (Y/XZ ≈ 1.0), not flat planes, so it is treated as relief and
 * gets an `_LOD` instead (below).
 */
const FLAT_RE = /meadow|path|lake/i;

/**
 * MOUNTAIN types — Forest_Mountain_Moss_*. Like the flat ground, these are LARGE
 * RELIEF SURFACES, not small props: the position-weld + simplify pass tore the
 * ridge/peaks on device (the exact same gash/seam failure the ground had). They
 * now KEEP their ORIGINAL geometry and get NO `_LOD` sibling, so the runtime
 * chunker falls back to their full geometry (`lodGeometry.get()` misses →
 * full-res, identical to the ground path). Mountains are still chunked +
 * frustum-culled at runtime (edge-ringing mountains are often fully off-screen),
 * so there is no perf regression. Every OTHER relief type (trees, flowers,
 * mushrooms, grass, rocks) still gets an `_LOD` — those decimate cleanly.
 */
const MOUNTAIN_RE = /mountain/i;

// Relief LOD: keep ~50% of triangles, tight error bound so silhouettes hold up.
const LOD_RATIO = 0.5;
const LOD_ERROR = 0.05;

const MB = (n) => (n / 1024 / 1024).toFixed(3) + ' MB';
const triOf = (prim) => {
  const idx = prim.getIndices();
  return idx ? idx.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3;
};

/**
 * Position-weld + meshopt-simplify a primitive, returning a NEW primitive with
 * reduced triangles and rebuilt (welded) attribute streams. Does not mutate the
 * source. See the banner for why position-only welding is required here.
 */
function simplifyByPosition(document, srcPrim, ratio, error) {
  const posA = srcPrim.getAttribute('POSITION');
  const idxA = srcPrim.getIndices();
  const positions = posA.getArray();
  const vertCount = posA.getCount();
  const srcIndices = idxA ? idxA.getArray() : null;
  const indices = srcIndices
    ? srcIndices instanceof Uint32Array
      ? srcIndices
      : new Uint32Array(srcIndices)
    : Uint32Array.from({ length: vertCount }, (_, i) => i);

  // Canonicalize vertices by rounded POSITION (~0.001-unit grid; the source
  // props span 35–4000 local units so this never merges distinct features, only
  // hard-edge normal/uv seams that share a position).
  const P = 1024;
  const map = new Map();
  const canonOf = new Int32Array(vertCount);
  const canonRep = []; // canonical vertex -> a representative source vertex
  const canonPos = []; // canonical positions (flat xyz)
  for (let v = 0; v < vertCount; v++) {
    const key =
      Math.round(positions[v * 3] * P) +
      ':' +
      Math.round(positions[v * 3 + 1] * P) +
      ':' +
      Math.round(positions[v * 3 + 2] * P);
    let c = map.get(key);
    if (c === undefined) {
      c = canonRep.length;
      map.set(key, c);
      canonRep.push(v);
      canonPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    }
    canonOf[v] = c;
  }
  const weldedIdx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) weldedIdx[i] = canonOf[indices[i]];
  const canonPosF = new Float32Array(canonPos);

  const triCount = weldedIdx.length / 3;
  const targetCount = Math.max(3, Math.floor(ratio * triCount) * 3);
  const [simpIdx] = MeshoptSimplifier.simplify(weldedIdx, canonPosF, 3, targetCount, error, []);
  const [remap, unique] = MeshoptSimplifier.compactMesh(simpIdx); // compacts simpIdx in place

  const out = document.createPrimitive().setMode(srcPrim.getMode());
  if (srcPrim.getMaterial()) out.setMaterial(srcPrim.getMaterial());
  for (const sem of srcPrim.listSemantics()) {
    const a = srcPrim.getAttribute(sem);
    const comp = a.getElementSize();
    const srcArr = a.getArray();
    const dst = new srcArr.constructor(unique * comp);
    for (let c = 0; c < canonRep.length; c++) {
      const ni = remap[c];
      if (ni === 0xffffffff || ni >= unique) continue;
      const rep = canonRep[c];
      for (let k = 0; k < comp; k++) dst[ni * comp + k] = srcArr[rep * comp + k];
    }
    out.setAttribute(
      sem,
      document.createAccessor().setType(a.getType()).setNormalized(a.getNormalized()).setArray(dst),
    );
  }
  out.setIndices(
    document
      .createAccessor()
      .setType('SCALAR')
      .setArray(unique <= 65534 ? new Uint16Array(simpIdx) : simpIdx),
  );
  return out;
}

async function main() {
  if (!existsSync(IN)) {
    console.error(`\n[gen-forest-mobile] SOURCE NOT FOUND:\n  ${IN}\n`);
    console.error('Build the desktop forest first (npm run models:forest).');
    process.exit(1);
  }

  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });

  console.log(`[gen-forest-mobile] reading ${IN} (${MB(statSync(IN).size)}) ...`);
  const doc = await io.read(IN);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];

  // Merge any bitwise-duplicate accessors before we start (harmless no-op if none).
  await doc.transform(dedup());

  let groundBefore = 0;
  let groundAfter = 0;
  let lodMeshes = 0;
  let reliefFullTris = 0;
  let reliefLodTris = 0;

  console.log('[gen-forest-mobile] keeping ground + mountains at full geometry + adding relief *_LOD meshes ...');
  for (const mesh of [...root.listMeshes()]) {
    const name = mesh.getName();
    const prim = mesh.listPrimitives()[0];
    if (!prim) continue;

    if (FLAT_RE.test(name) || MOUNTAIN_RE.test(name)) {
      // Flat ground AND mountains — DECIMATION EXCLUDED (see banner). Both are
      // large relief surfaces whose simplify pass tore the surface/ridge on
      // device. Keep the ORIGINAL geometry untouched and add NO `_LOD` sibling,
      // so the runtime chunker falls back to this full geometry. Both are still
      // chunked + frustum-culled at runtime.
      const tris = triOf(prim);
      groundBefore += tris;
      groundAfter += tris; // unchanged — not decimated
    } else {
      // (B) Relief — keep full geometry, add a decimated `<name>_LOD` sibling.
      reliefFullTris += triOf(prim);
      const lodPrim = simplifyByPosition(doc, prim, LOD_RATIO, LOD_ERROR);
      const lodMesh = doc.createMesh(name + '_LOD').addPrimitive(lodPrim);
      // Non-instanced node at the origin (no EXT_mesh_gpu_instancing) → three
      // loads it as a plain Mesh named `<name>_LOD`. ForestEnvironment harvests
      // its geometry and removes it before render.
      const lodNode = doc.createNode(name + '_LOD').setMesh(lodMesh);
      scene.addChild(lodNode);
      lodMeshes += 1;
      reliefLodTris += triOf(lodPrim);
    }
  }

  // Drop any accessors orphaned by the dedup/LOD passes (harmless no-op if none).
  await doc.transform(prune());

  // (A) Meshopt compression — FILTER method (keeps FLOAT space; see banner).
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });

  await io.write(OUT, doc);
  const outSize = statSync(OUT).size;

  // ── Read-back verification ──────────────────────────────────────────────────
  const check = await io.read(OUT);
  const cRoot = check.getRoot();
  const exts = cRoot.listExtensionsUsed().map((e) => e.extensionName);

  let instPlacements = 0;
  let instancedNodes = 0;
  for (const node of cRoot.listNodes()) {
    const inst = node.getExtension('EXT_mesh_gpu_instancing');
    if (inst) {
      instancedNodes += 1;
      const tr = inst.getAttribute('TRANSLATION');
      instPlacements += tr ? tr.getCount() : 0;
    }
  }
  const lodOut = cRoot.listMeshes().filter((m) => /_LOD$/.test(m.getName() || '')).length;

  console.log('\n[gen-forest-mobile] DONE');
  console.log(`  out:               ${OUT}`);
  console.log(`  size:              ${MB(statSync(IN).size)} -> ${MB(outSize)} (${outSize} bytes)`);
  console.log(`  full-res tris:     ${groundBefore} -> ${groundAfter} (ground + mountains, no _LOD)`);
  console.log(`  relief LOD tiers:  ${lodMeshes} added (full ${reliefFullTris} -> LOD ${reliefLodTris} tris)`);
  console.log(`  instanced nodes:   ${instancedNodes} (placements: ${instPlacements})`);
  console.log(`  _LOD meshes:       ${lodOut}`);
  console.log(`  extensions:        ${exts.join(', ')}`);

  if (!exts.includes('EXT_meshopt_compression')) {
    console.error('\n[gen-forest-mobile] ERROR: EXT_meshopt_compression missing from output.');
    process.exit(1);
  }
  if (exts.some((e) => /draco|basisu|webp|avif|quantization/i.test(e))) {
    console.error(
      `\n[gen-forest-mobile] ERROR: unexpected extension in output (${exts.join(', ')}). ` +
        'Only EXT_mesh_gpu_instancing + EXT_meshopt_compression (FILTER) are expected.',
    );
    process.exit(1);
  }
  if (instPlacements !== 1162) {
    console.warn(
      `[gen-forest-mobile] WARNING: expected 1162 instance placements, got ${instPlacements}.`,
    );
  }
}

main().catch((err) => {
  console.error('[gen-forest-mobile] FAILED:', err);
  process.exit(1);
});
