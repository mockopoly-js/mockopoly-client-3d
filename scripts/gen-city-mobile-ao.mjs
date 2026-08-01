/**
 * gen-city-mobile-ao.mjs — bake a subtle contact-AO lightmap into the MOBILE
 * city variant and produce the compressed AO texture. MOBILE-ONLY; the
 * desktop-frozen `public/models/city.glb` is never read or written.
 *
 * WHY: the mobile city (`public/models/city.mobile.glb`) is a merged, atlas-
 * textured draco mesh whose atlas UV0 is heavily overlapping/tiled, so it has no
 * usable second UV for a lightmap and no baked occlusion. This pass adds cheap
 * DEPTH to the mobile city with ZERO framerate cost: a baked AO applied at
 * runtime as an `aoMap` (aoMap.channel = 1 → sampled from a fresh TEXCOORD_1) is
 * exactly +1 texture tap on the buildings fragments — no post pass, no render
 * target, no extra draws. three multiplies aoMap into INDIRECT/ambient light
 * only, so it never fights the real-time daylight sun.
 *
 * PIPELINE:
 *   1. BAKE (Blender/Cycles, scripts/blender/bake_city_ao.py): import the mobile
 *      glb, DELETE the cars mesh (keeps its COLOR_0 pristine — cars never enter
 *      Blender), lightmap-unwrap the BUILDINGS mesh into a fresh non-overlapping
 *      UV (→ TEXCOORD_1), bake bounded ambient occlusion, save the AO PNG, and
 *      re-export a buildings-only glb carrying
 *      POSITION/NORMAL/TEXCOORD_0(atlas)/TEXCOORD_1(lightmap).
 *   2. REASSEMBLE (this script, gltf-transform): read the ORIGINAL mobile glb
 *      (pristine cars + shared material + atlas) and the Blender buildings glb;
 *      REPLACE the buildings primitive's attributes/indices with Blender's whole
 *      set (Blender re-indexed the verts, so the full set must move together —
 *      you cannot inject TEXCOORD_1 alone); leave the cars mesh + COLOR_0 +
 *      shared material + atlas texture UNTOUCHED; dedup → prune → draco; overwrite
 *      public/models/city.mobile.glb.
 *   3. COMPRESS the AO PNG → public/images/city.mobile.ao.ktx2 (UASTC, primary,
 *      VRAM-optimal, matches the board.mobile.ktx2 pipeline) AND a
 *      public/images/city.mobile.ao.webp fallback.
 *
 * This script does NOT wire the aoMap into three — that is a later runtime phase
 * (CityDressing.tsx, isMobile branch only).
 *
 * Run:  npm run models:city:ao   (or: node scripts/gen-city-mobile-ao.mjs)
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { dedup, prune, draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const IN = join(ROOT, 'public/models/city.mobile.glb'); // read + overwrite (mobile-only)
const OUT = IN;
const BAKE_PY = join(ROOT, 'scripts/blender/bake_city_ao.py');
const OUT_KTX2 = join(ROOT, 'public/images/city.mobile.ao.ktx2');
const OUT_WEBP = join(ROOT, 'public/images/city.mobile.ao.webp');

const LOCAL_TOKTX = join(ROOT, 'tools/ktx/bin/toktx');
const LOCAL_KTX_LIB = join(ROOT, 'tools/ktx/lib');

const MB = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
const KB = (n) => (n / 1024).toFixed(1) + ' KB';
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Resolve the Blender binary. */
function resolveBlender() {
  const candidates = [
    process.env.BLENDER,
    '/opt/homebrew/bin/blender',
    '/Applications/Blender.app/Contents/MacOS/Blender',
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === 'blender' || existsSync(c)) return c;
  }
  const onPath = spawnSync('blender', ['--version'], { encoding: 'utf8' });
  if (!onPath.error) return 'blender';
  throw new Error('Blender not found. Set $BLENDER to the Blender 5.x binary.');
}

/** Resolve the toktx binary + any dylib dir it needs (mirrors gen-board-mobile). */
function resolveToktx() {
  if (process.env.TOKTX && existsSync(process.env.TOKTX)) return { bin: process.env.TOKTX, libDir: null };
  const onPath = spawnSync('toktx', ['--version'], { encoding: 'utf8' });
  if (!onPath.error && onPath.status === 0) return { bin: 'toktx', libDir: null };
  if (existsSync(LOCAL_TOKTX)) return { bin: LOCAL_TOKTX, libDir: existsSync(LOCAL_KTX_LIB) ? LOCAL_KTX_LIB : null };
  return null;
}

/** Find the buildings + cars primitives in a mobile-city document. Buildings =
 * the mesh with more verts and NO COLOR_0; cars = the mesh WITH COLOR_0. */
function classifyPrims(root) {
  let buildings = null;
  let cars = null;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const prim = mesh.listPrimitives()[0];
    const entry = { node, mesh, prim };
    if (prim.getAttribute('COLOR_0')) cars = entry;
    else buildings = entry;
  }
  if (!buildings) throw new Error('reassembly: buildings prim (no COLOR_0) not found in mobile glb');
  if (!cars) throw new Error('reassembly: cars prim (with COLOR_0) not found in mobile glb');
  return { buildings, cars };
}

function posBBox(prim) {
  const p = prim.getAttribute('POSITION');
  return { min: p.getMin([]), max: p.getMax([]) };
}

async function reassemble(io) {
  console.log(`[gen-city-mobile-ao] reading original ${IN} (${MB(statSync(IN).size)})`);
  const docA = await io.read(IN);
  const rootA = docA.getRoot();
  const { buildings, cars } = classifyPrims(rootA);
  const oldBox = posBBox(buildings.prim);
  const oldVerts = buildings.prim.getAttribute('POSITION').getCount();

  console.log(`[gen-city-mobile-ao] reading Blender buildings ${BLENDER_GLB} (${MB(statSync(BLENDER_GLB).size)})`);
  const docB = await io.read(BLENDER_GLB);
  const bMeshes = docB.getRoot().listMeshes();
  if (bMeshes.length !== 1) throw new Error(`reassembly: expected 1 mesh in Blender glb, got ${bMeshes.length}`);
  const bPrim = bMeshes[0].listPrimitives()[0];
  for (const sem of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1']) {
    if (!bPrim.getAttribute(sem)) throw new Error(`reassembly: Blender buildings prim missing ${sem}`);
  }

  // Pull the whole attribute set + indices from Blender (self-consistent, re-indexed).
  const posArr = bPrim.getAttribute('POSITION').getArray().slice();
  const nrmArr = bPrim.getAttribute('NORMAL').getArray().slice();
  const uv0Arr = bPrim.getAttribute('TEXCOORD_0').getArray().slice();
  const uv1Arr = bPrim.getAttribute('TEXCOORD_1').getArray().slice();
  const idxArr = bPrim.getIndices().getArray().slice();

  // Clamp the lightmap UV into [0,1] — lightmap_pack overshoots the border by a
  // few texels; clamping avoids any wrap sampling regardless of runtime sampler.
  let clamped = 0;
  for (let i = 0; i < uv1Arr.length; i++) {
    const c = clamp01(uv1Arr[i]);
    if (c !== uv1Arr[i]) { uv1Arr[i] = c; clamped++; }
  }

  // Build fresh accessors in docA and swap them onto the buildings primitive.
  const buf = rootA.listBuffers()[0];
  const mk = (name, arr, type) => docA.createAccessor(name).setBuffer(buf).setType(type).setArray(arr);
  const prim = buildings.prim;
  prim.setAttribute('POSITION', mk('city_ao_POSITION', posArr, 'VEC3'));
  prim.setAttribute('NORMAL', mk('city_ao_NORMAL', nrmArr, 'VEC3'));
  prim.setAttribute('TEXCOORD_0', mk('city_ao_TEXCOORD_0', uv0Arr, 'VEC2'));
  prim.setAttribute('TEXCOORD_1', mk('city_ao_TEXCOORD_1', uv1Arr, 'VEC2'));
  prim.setIndices(mk('city_ao_indices', idxArr, 'SCALAR'));

  // ── Asserts (fail loud) ──────────────────────────────────────────────────
  const newBox = posBBox(prim);
  const tol = 0.05;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(newBox.min[i] - oldBox.min[i]) > tol || Math.abs(newBox.max[i] - oldBox.max[i]) > tol) {
      throw new Error(
        `reassembly: buildings POSITION bbox drifted (axis ${i}) — Blender frame mismatch. ` +
          `old=[${oldBox.min}..${oldBox.max}] new=[${newBox.min}..${newBox.max}]`,
      );
    }
  }
  if (!prim.getAttribute('TEXCOORD_1')) throw new Error('reassembly: buildings TEXCOORD_1 missing after swap');
  if (cars.prim.getAttribute('TEXCOORD_1')) throw new Error('reassembly: cars must NOT have TEXCOORD_1');
  if (!cars.prim.getAttribute('COLOR_0')) throw new Error('reassembly: cars COLOR_0 was lost');

  console.log(
    `[gen-city-mobile-ao] swapped buildings geometry: verts ${oldVerts} -> ${prim.getAttribute('POSITION').getCount()} ` +
      `(+TEXCOORD_1, clamped ${clamped} uv coords); bbox preserved within ${tol}. Cars COLOR_0 intact, no cars uv1.`,
  );

  // keepAttributes: true is MANDATORY — the glTF material references no
  // occlusionTexture (aoMap is attached at runtime), so a default prune() would
  // delete the "unused" TEXCOORD_1 lightmap UV. draco keeps all attributes it is
  // given, with TEXCOORD quantized to 12 bits (ample for a 2048² lightmap).
  await docA.transform(dedup(), prune({ keepAttributes: true }), draco());
  await io.write(OUT, docA);
  console.log(`[gen-city-mobile-ao] wrote ${OUT} (${MB(statSync(OUT).size)})`);
}

async function verifyOutput(io) {
  const doc = await io.read(OUT); // re-decode (proves draco round-trips)
  const root = doc.getRoot();
  if (root.listExtensionsRequired().find((e) => e.extensionName === 'KHR_draco_mesh_compression') == null) {
    throw new Error('verify: output is not draco-compressed');
  }
  const { buildings, cars } = classifyPrims(root);
  const bSem = buildings.prim.listSemantics();
  for (const need of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1']) {
    if (!bSem.includes(need)) throw new Error(`verify: buildings missing ${need} (has ${bSem})`);
  }
  if (cars.prim.getAttribute('TEXCOORD_1')) throw new Error('verify: cars unexpectedly has TEXCOORD_1');
  if (!cars.prim.getAttribute('COLOR_0')) throw new Error('verify: cars lost COLOR_0');
  const mat = buildings.prim.getMaterial();
  if (!mat || mat.getName() !== 'city-mobile') throw new Error(`verify: shared material not intact (${mat?.getName()})`);
  if (mat.getAlphaMode() !== 'OPAQUE' || mat.getRoughnessFactor() !== 0.69 || mat.getMetallicFactor() !== 0) {
    throw new Error('verify: material factors changed');
  }
  const tex = mat.getBaseColorTexture();
  if (!tex || tex.getName() !== 'city-atlas') throw new Error('verify: atlas baseColorTexture not intact');
  console.log(
    `[gen-city-mobile-ao] VERIFY OK: draco ✓  buildings[${bSem.join(',')}]  ` +
      `cars[${cars.prim.listSemantics().join(',')}]  material=city-mobile(atlas) alpha=OPAQUE rough=0.69`,
  );
}

async function compress(aoPng) {
  const srcMeta = await sharp(aoPng).metadata();
  console.log(`[gen-city-mobile-ao] AO source PNG: ${srcMeta.width}x${srcMeta.height} (${KB(statSync(aoPng).size)})`);

  // WEBP fallback (grayscale, low-freq occlusion). MUST be loaded with flipY=false
  // at runtime (webp defaults flipY=true).
  await sharp(aoPng).grayscale().webp({ quality: 82, effort: 6 }).toFile(OUT_WEBP);
  console.log(`[gen-city-mobile-ao] wrote ${OUT_WEBP} (${KB(statSync(OUT_WEBP).size)})`);

  // KTX2 UASTC (primary, VRAM-optimal, matches board.mobile.ktx2). LINEAR
  // transfer (AO is not color); UASTC (not ETC1S) to avoid banding on the smooth
  // gradient. Falls back gracefully to webp-only if toktx is unavailable.
  const tk = resolveToktx();
  if (!tk) {
    console.warn('[gen-city-mobile-ao] toktx not found — skipping KTX2 (webp fallback written). Set $TOKTX or place tools/ktx/bin/toktx.');
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'cityao-ktx-'));
  const grayPng = join(tmp, 'ao_gray.png');
  await sharp(aoPng).grayscale().png({ compressionLevel: 9 }).toFile(grayPng);
  const args = [
    '--encode', 'uastc',
    '--uastc_quality', '3', // AO is smooth — q3 saves size vs q4 with no visible loss
    '--zcmp', '19',
    '--genmipmap',
    '--assign_oetf', 'linear',
    '--assign_primaries', 'none',
    OUT_KTX2,
    grayPng,
  ];
  const env = { ...process.env };
  if (tk.libDir) {
    env.DYLD_FALLBACK_LIBRARY_PATH = [tk.libDir, env.DYLD_FALLBACK_LIBRARY_PATH].filter(Boolean).join(':');
  }
  console.log(`[gen-city-mobile-ao] toktx ${args.join(' ')}`);
  const res = spawnSync(tk.bin, args, { stdio: 'inherit', env });
  rmSync(tmp, { recursive: true, force: true });
  if (res.error || res.status !== 0) {
    throw new Error(`toktx failed: ${res.error?.message ?? 'status ' + res.status}`);
  }
  console.log(`[gen-city-mobile-ao] wrote ${OUT_KTX2} (${KB(statSync(OUT_KTX2).size)})`);
}

// Scratch artifacts produced by the Blender bake (set in main()).
let BLENDER_GLB = '';

async function main() {
  if (!existsSync(IN)) throw new Error(`input not found: ${IN}`);

  const scratch = mkdtempSync(join(tmpdir(), 'city-ao-'));
  const aoPng = join(scratch, 'citymobile_ao.png');
  BLENDER_GLB = join(scratch, 'city.mobile.buildings.uv2.glb');

  // ── 1. Blender bake ────────────────────────────────────────────────────────
  const blender = resolveBlender();
  const bakeArgs = ['--background', '--python', BAKE_PY, '--', IN, aoPng, BLENDER_GLB];
  console.log(`[gen-city-mobile-ao] ${blender} ${bakeArgs.join(' ')}`);
  const bake = spawnSync(blender, bakeArgs, { stdio: 'inherit' });
  if (bake.error || bake.status !== 0) {
    throw new Error(`Blender bake failed: ${bake.error?.message ?? 'status ' + bake.status}`);
  }
  if (!existsSync(aoPng) || !existsSync(BLENDER_GLB)) {
    throw new Error('Blender bake did not produce the expected outputs');
  }

  // ── 2. Reassemble + verify ─────────────────────────────────────────────────
  const decoder = await draco3d.createDecoderModule();
  const encoder = await draco3d.createEncoderModule();
  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({ 'draco3d.decoder': decoder, 'draco3d.encoder': encoder });

  await reassemble(io);
  await verifyOutput(io);

  // ── 3. Compress the AO map ─────────────────────────────────────────────────
  await compress(aoPng);

  rmSync(scratch, { recursive: true, force: true });
  console.log('[gen-city-mobile-ao] done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
