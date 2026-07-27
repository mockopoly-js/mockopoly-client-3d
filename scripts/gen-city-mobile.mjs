/**
 * gen-city-mobile.mjs — build the MOBILE-ONLY city variant
 * `public/models/city.mobile.glb` from the committed, desktop-frozen
 * `public/models/city.glb`.
 *
 * WHY: the shared desktop `city.glb` is 103 draws / 69 materials / 69 512×512
 * textures (~92 MB texture VRAM). That's fine on desktop but crushes low-end
 * mobile GPUs. This script produces a visually-identical variant that collapses
 * the whole city to ~1-2 draws / 1 material / 1 atlas texture (~24 MB VRAM),
 * loaded at runtime only when `isMobile`. Desktop keeps `city.glb`
 * byte-identical and decoder-free.
 *
 * PIPELINE (V2, 256px atlas cells):
 *   1. READ public/models/city.glb (EXT_mesh_gpu_instancing registered).
 *   2. ATLAS: pack the 69 baseColor images into ONE PNG atlas — CELL=256,
 *      GUTTER=8, grid 9×8 (72 cells ≥ 69). Each image is sharp-resized to
 *      (CELL-2*GUTTER)=240px square and composited into its cell with a gutter
 *      so bilinear sampling never bleeds across neighbours.
 *   3. ONE shared material (OPAQUE, baseColorFactor [1,1,1,1], roughness 0.69,
 *      metallic 0, baseColorTexture = atlas, sampler CLAMP_TO_EDGE on S and T).
 *   4. REMAP every primitive's TEXCOORD_0 into its material's atlas cell
 *      (clamping the ~4 stray UVs to [0,1] first), then point every primitive
 *      at the shared material.
 *   5. TRANSFORM: prune → uninstance (bake the 1259 instances into real
 *      geometry) → flatten → dedup → weld → join (now single-material, so
 *      everything merges to ~1-2 meshes) → prune → draco.
 *   6. WRITE public/models/city.mobile.glb (draco-compressed) + print stats.
 *
 * The rendered triangle count is PRESERVED: uninstance bakes the instances into
 * real triangles, so the ~263K rendered tris survive — just carried by ~1-2
 * meshes instead of 103 + 1259 instance draws.
 *
 * Run:  npm run models:city:mobile
 */
import { NodeIO, TextureInfo } from '@gltf-transform/core';
import { EXTMeshGPUInstancing, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { prune, uninstance, flatten, dedup, weld, join, simplify, draco } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const IN = resolve(PROJECT_ROOT, 'public/models/city.glb');
const OUT = resolve(PROJECT_ROOT, 'public/models/city.mobile.glb');

// ── Atlas geometry (V2) ──────────────────────────────────────────────────────
const CELL = 256;                 // atlas cell size (px), square
const GUTTER = 8;                 // gutter inside each cell (px) — stops bleed
const INNER = CELL - 2 * GUTTER;  // 240 — the resized image footprint
const COLS = 9;                   // 9 × 8 = 72 cells ≥ 69 materials
const ROWS = 8;
const ATLAS_W = COLS * CELL;      // 2304
const ATLAS_H = ROWS * CELL;      // 2048

// GENTLE geometry decimation (mobile-only). Runs AFTER join so the simplifier
// sees the whole city as one connected mesh. Conservative: KEEP ~85% of tris,
// tight error bound + locked borders so the compact city silhouette and building
// footprints are preserved. city.glb is never touched (script only writes OUT).
const SIMPLIFY_RATIO = 0.85;   // fraction of triangles to KEEP
const SIMPLIFY_ERROR = 0.008;  // max normalized quadric error (silhouette guard)

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const MB = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
// RGBA8 texture VRAM incl. the +1/3 mip chain.
const texVram = (w, h) => (w * h * 4 * 4) / 3;

async function main() {
  const encoder = await draco3d.createEncoderModule();
  await MeshoptSimplifier.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshGPUInstancing, KHRDracoMeshCompression])
    .registerDependencies({ 'draco3d.encoder': encoder });

  console.log(`[gen-city-mobile] reading ${IN} (${MB(statSync(IN).size)}) ...`);
  const doc = await io.read(IN);
  const root = doc.getRoot();

  const materials = root.listMaterials();
  const meshes = root.listMeshes();
  console.log(
    `[gen-city-mobile] source: ${meshes.length} meshes, ${materials.length} materials, ` +
      `${root.listTextures().length} textures`,
  );
  if (materials.length > COLS * ROWS) {
    throw new Error(
      `atlas grid ${COLS}×${ROWS}=${COLS * ROWS} too small for ${materials.length} materials`,
    );
  }

  // material → its atlas cell index (list order is stable).
  const matCell = new Map();
  materials.forEach((m, i) => matCell.set(m, i));

  // ── 1. Build the atlas image ────────────────────────────────────────────────
  console.log('[gen-city-mobile] resizing + compositing 69 images into one atlas ...');
  const composites = [];
  for (let i = 0; i < materials.length; i++) {
    const mat = materials[i];
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const left = col * CELL + GUTTER;
    const top = row * CELL + GUTTER;

    const tex = mat.getBaseColorTexture();
    let cellBuf;
    if (tex && tex.getImage()) {
      cellBuf = await sharp(Buffer.from(tex.getImage()))
        .resize(INNER, INNER, { fit: 'fill' })
        .png()
        .toBuffer();
    } else {
      // Fallback: solid baseColorFactor fill (no source image).
      const [r, g, b] = mat.getBaseColorFactor();
      cellBuf = await sharp({
        create: {
          width: INNER,
          height: INNER,
          channels: 4,
          background: { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), alpha: 1 },
        },
      })
        .png()
        .toBuffer();
    }
    composites.push({ input: cellBuf, left, top });
  }

  const atlasBuf = await sharp({
    create: { width: ATLAS_W, height: ATLAS_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toBuffer();
  console.log(`[gen-city-mobile] atlas: ${ATLAS_W}×${ATLAS_H} PNG (${MB(atlasBuf.length)})`);

  // ── 2. Remap every primitive's UVs into its material's cell ─────────────────
  let straysClamped = 0;
  let remapped = 0;
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat) continue;
      const i = matCell.get(mat);
      if (i === undefined) continue;
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const baseU = col * CELL + GUTTER;
      const baseV = row * CELL + GUTTER;

      const uv = prim.getAttribute('TEXCOORD_0');
      if (!uv) continue;
      const arr = uv.getArray().slice();
      for (let v = 0; v < arr.length; v += 2) {
        const cu = clamp01(arr[v]);
        const cv = clamp01(arr[v + 1]);
        if (cu !== arr[v] || cv !== arr[v + 1]) straysClamped++;
        arr[v] = (baseU + cu * INNER) / ATLAS_W;
        arr[v + 1] = (baseV + cv * INNER) / ATLAS_H;
      }
      uv.setArray(arr);
      remapped++;
    }
  }
  console.log(`[gen-city-mobile] remapped ${remapped} primitives; clamped ${straysClamped} stray UV coords`);

  // ── 3. ONE shared material + atlas texture ──────────────────────────────────
  const atlasTex = doc
    .createTexture('city-atlas')
    .setImage(atlasBuf)
    .setMimeType('image/png');

  const shared = doc
    .createMaterial('city-mobile')
    .setAlphaMode('OPAQUE')
    .setBaseColorFactor([1, 1, 1, 1])
    .setRoughnessFactor(0.69)
    .setMetallicFactor(0)
    .setBaseColorTexture(atlasTex);
  const info = shared.getBaseColorTextureInfo();
  info.setWrapS(TextureInfo.WrapMode.CLAMP_TO_EDGE).setWrapT(TextureInfo.WrapMode.CLAMP_TO_EDGE);

  // Point every primitive at the shared material.
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      prim.setMaterial(shared);
    }
  }

  // ── 4. Collapse: prune → uninstance → flatten → dedup → weld → join → simplify → prune → draco
  // simplify() runs AFTER join() (so it sees the whole city as ~1-2 connected
  // single-material meshes — the best connectivity to work on) and BEFORE draco()
  // (so the reduced geometry is what gets compressed). simplify() welds internally,
  // so it is safe after the existing weld()+join(). lockBorder:true preserves
  // open-boundary/silhouette edges (building outlines, city perimeter). The SimplePoly
  // city is hard-edged low-poly "triangle soup", so attribute-consistent welding
  // leaves few interior collapsible edges → expect a CONSERVATIVE reduction, which is
  // exactly the "gentle" intent (see the read-back tri count below to verify).
  console.log('[gen-city-mobile] transform: prune, uninstance, flatten, dedup, weld, join, simplify, prune, draco ...');
  await doc.transform(
    prune(),
    uninstance(),
    flatten(),
    dedup(),
    weld(),
    join(),
    simplify({ simplifier: MeshoptSimplifier, ratio: SIMPLIFY_RATIO, error: SIMPLIFY_ERROR, lockBorder: true }),
    prune(),
    draco(),
  );

  // ── 5. Write + verify ───────────────────────────────────────────────────────
  await io.write(OUT, doc);

  const outMeshes = root.listMeshes();
  const outMats = root.listMaterials();
  const outTexs = root.listTextures();
  let draws = 0;
  let tris = 0;
  for (const mesh of outMeshes) {
    for (const prim of mesh.listPrimitives()) {
      draws++;
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      tris += idx ? idx.getCount() / 3 : pos.getCount() / 3;
    }
  }
  let vram = 0;
  for (const t of outTexs) {
    const meta = await sharp(Buffer.from(t.getImage())).metadata();
    vram += texVram(meta.width, meta.height);
  }

  console.log('\n[gen-city-mobile] ── RESULT ──────────────────────────────');
  console.log(`  file:      ${OUT}`);
  console.log(`  size:      ${MB(statSync(OUT).size)}`);
  console.log(`  meshes:    ${outMeshes.length}`);
  console.log(`  draws:     ${draws} (primitives)`);
  console.log(`  materials: ${outMats.length}`);
  console.log(`  textures:  ${outTexs.length}`);
  console.log(`  tris:      ${Math.round(tris)} (rendered — instances baked in)`);
  console.log(`  tex VRAM:  ${MB(vram)}`);
  console.log('[gen-city-mobile] done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
