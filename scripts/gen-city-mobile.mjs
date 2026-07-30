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
 *   1b. EDGE-THIRD Z CUT (MOBILE-ONLY): remove the THIRD of the city that hugs ONE
 *      physical board edge — the STRAND / CHANCE / FLEET STREET / TRAFALGAR SQUARE /
 *      FENCHURCH ST STATION / LEICESTER SQ / COVENTRY ST side (board tiles 21–29,
 *      the printed TOP row) — and keep the other two-thirds intact. This is a PURE
 *      POSITIONAL cut on ONE axis (model −Z). The cut REGION/SIDE is UNCHANGED from
 *      the prior build — the user confirmed "the cut was fine"; only the previous
 *      build's OVER-removal (a footprint cap that also deleted the city floor, the
 *      roads and the large buildings) is fixed here.
 *
 *      AXIS BINDING (rigorous — see positions.ts + GameScene.tsx): those tiles are
 *      the board TOP row at board-local z = -4.33; their edge's OUTWARD normal is
 *      board-local (0,0,-1). The city renders inside GameScene's board group
 *      (rotation Y = BOARD_ROTATION = -π/2) plus CityDressing's CITY_ROT = 0, i.e.
 *      a TOTAL city Y-rotation of -π/2. Ry(-π/2) maps board-local (0,0,-1) → WORLD
 *      (+1,0,0) = world +X (verified: Strand tile idx 21 lands at world x = +4.33),
 *      and world +X maps back to the city-MODEL -Z end. CityDressing only recenters
 *      (pure translate) + uniform-scales the source, so model -Z == the SMALLEST
 *      source-Z coordinates. The source city spans Z ∈ [-230.8, 30.0]; the low-Z
 *      third is Z ≤ Z_CUT (-143 ≈ zmin + span/3) and is the third that hugs the
 *      STRAND/FLEET edge.
 *
 *      HOW THE CUT IS APPLIED (this is the fix). The desktop source is NOT a clean
 *      list of separable buildings: 50 nodes are EXT_mesh_gpu_instancing (small
 *      repeated units — road tiles, props, small buildings; footprint ≤ ~20) and 53
 *      are plain nodes that are actually JOINED merges of many DISJOINT buildings
 *      PLUS the flat city FLOOR / ROAD / PLAZA slabs (footprints up to 260). A
 *      whole-node footprint test (the old `foot ≤ 60` cap) therefore deleted every
 *      plain node that carried a large building or a slab — the missing-floor,
 *      missing-roads, missing-big-buildings bug. So the cut is now applied at the
 *      correct granularity for each kind:
 *        • INSTANCED nodes → keep each INSTANCE whose ENTIRE world bbox is on the
 *          kept side (MIN Z ≥ Z_CUT, not just its center — so no instance pokes past
 *          the cut plane), no foot cap. Instances are small whole units, so a
 *          whole-instance side test never slices one. The min-Z test drops the thin
 *          straddling fringe of flat road-tiles / props at the very −Z edge (≈20,
 *          all height ≤ 1.0) that a center test left overhanging to Z ≈ -150 — that
 *          fringe overflowed the STRAND tiles after the runtime fit; dropping it
 *          makes the −Z edge end cleanly at ≈ Z_CUT, matching the floor clip.
 *        • PLAIN nodes → keep each TRIANGLE whose world-bbox center Z ≥ Z_CUT. A
 *          pre-pass verified ZERO source triangles straddle the plane Z = Z_CUT (it
 *          lands in a natural EMPTY gap between the kept downtown at Z ≥ ~-137 and
 *          the removed low-rise strip at Z ≤ ~-166), so every triangle is wholly on
 *          one side. A per-triangle keep therefore (a) keeps each whole building on
 *          the kept side intact, (b) drops each whole building on the removed side,
 *          and (c) clips the flat FLOOR / ROAD / PLAZA sheets to a clean straight
 *          boundary at Z_CUT (a flat sheet → a flat line, not a hollow open face).
 *          No triangle is split and no wall is cut open.
 *      Kept footprint ≈ 300×180 (aspect ~1.67), X preserved in full. Desktop
 *      city.glb is untouched (this script only ever writes OUT). Paired with a
 *      UNIFORM XZ runtime fit in CityDressing.tsx (keyed to the LONG axis) so the
 *      rectangular remainder fills the board center undistorted, centered, with a
 *      small empty strip on the short axis (distortion is not acceptable; a strip
 *      is).
 *   2. ATLAS: pack the 69 baseColor images into ONE PNG atlas — CELL=256,
 *      GUTTER=8, grid 9×8 (72 cells ≥ 69). Each image is sharp-resized to
 *      (CELL-2*GUTTER)=240px square and composited into its cell with a gutter
 *      so bilinear sampling never bleeds across neighbours.
 *   3. ONE shared material (OPAQUE, baseColorFactor [1,1,1,1], roughness 0.69,
 *      metallic 0, baseColorTexture = atlas, sampler CLAMP_TO_EDGE on S and T).
 *   4. REMAP every primitive's TEXCOORD_0 into its material's atlas cell
 *      (clamping the ~4 stray UVs to [0,1] first), then point every primitive
 *      at the shared material.
 *   5. TRANSFORM: prune → uninstance (bake the surviving instances into real
 *      geometry) → flatten → dedup → weld → join (now single-material, so
 *      everything merges to ~1-2 meshes) → simplify → prune → draco.
 *   6. WRITE public/models/city.mobile.glb (draco-compressed) + print stats.
 *
 * The rendered triangle count is PRESERVED (minus the cropped third): uninstance
 * bakes the instances into real triangles, so the kept region's tris survive — just
 * carried by ~1-2 meshes instead of 103 + instance draws.
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

// ── Edge-third Z cut (MOBILE-ONLY), in desktop source-coordinate space ──────────
// Remove the STRAND/FLEET board-edge third of the city (= world +X = city-model -Z
// = the SMALLEST source-Z third). Source city spans Z ∈ [-230.8, 30.0]; the low-Z
// third boundary is zmin + span/3 ≈ -143. Geometry with world-bbox center Z < Z_CUT
// is REMOVED; Z ≥ Z_CUT is KEPT. Full X preserved (no long-axis trim, no square).
// This region/side is UNCHANGED from the prior build — the user confirmed the cut
// was correct; only the over-removal (a footprint cap that also deleted the floor,
// roads and big buildings) is fixed. See the PIPELINE step 1b header for the
// axis-binding derivation and for how the cut is applied (per-instance +
// per-triangle, so the floor / roads / big buildings on the kept side are RETAINED
// whole; nothing is sliced open).
//
// TUNABLE: nudge Z_CUT to move the cut line along model -Z (MORE negative = keep
// more of the city / cut a thinner strip; LESS negative = cut deeper). It sits in a
// natural EMPTY gap — no source triangle straddles it (verified) — so the per-
// triangle clip opens no shells; keep it inside that gap (roughly -166 < Z_CUT <
// -137) when tuning, or re-verify the gap if moving further.
const Z_CUT = -143;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const MB = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

// ── Minimal column-major 4×4 math (no three.js dep in this build script) ──────
const mat4Mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
};
const mat4FromTRS = (t, r, s) => {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  // prettier-ignore
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
};
const mat4Apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

// Local (pre-transform) bbox of a mesh, unioned over its primitives' POSITION
// accessor min/max (present on every SimplePoly primitive).
const meshLocalBox = (mesh) => {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const a = pos.getMin([]);
    const b = pos.getMax([]);
    for (let i = 0; i < 3; i++) {
      if (a[i] < mn[i]) mn[i] = a[i];
      if (b[i] > mx[i]) mx[i] = b[i];
    }
  }
  return [mn, mx];
};

// Axis-aligned world bbox of a local box [mn,mx] transformed by matrix `m`.
const worldBox = (m, mn, mx) => {
  const bmn = [Infinity, Infinity, Infinity];
  const bmx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const w = mat4Apply(m, [i & 1 ? mx[0] : mn[0], i & 2 ? mx[1] : mn[1], i & 4 ? mx[2] : mn[2]]);
    for (let k = 0; k < 3; k++) {
      if (w[k] < bmn[k]) bmn[k] = w[k];
      if (w[k] > bmx[k]) bmx[k] = w[k];
    }
  }
  return [bmn, bmx];
};

// An INSTANCE is KEPT iff its ENTIRE world bbox is on the kept side of the
// edge-third cut — its MIN Z ≥ Z_CUT, not merely its center. NO footprint cap:
// instances are small, whole repeated units (road tiles, props, small buildings,
// footprint ≤ ~20), so a whole-instance side test keeps them intact and never
// slices. (Dropping the old `foot ≤ 60` cap has no effect on instances — every
// instance was already under it — it only stops the big PLAIN nodes below from
// being deleted wholesale.)
//
// The MIN-Z test (vs a center test) is what makes the −Z / STRAND edge CLEAN: a
// center test kept instances whose center is inside the cut but whose geometry pokes
// ~7 units PAST the plane (down to Z ≈ -150), a fringe that — after the even-fill
// runtime fit — overflowed onto the printed STRAND / TRAFALGAR / FLEET tiles.
// Requiring min-Z ≥ Z_CUT drops only that thin straddling fringe (measured: 20 flat
// road-tiles / tiny props, all height ≤ 1.0 — NO interior or tall building), so the
// kept city's −Z extent ends cleanly at ≈ Z_CUT, matching the per-triangle floor
// clip, and the fit fills evenly with nothing poking past the tile ring.
const keepInstance = (m, mn, mx) => {
  const [bmn] = worldBox(m, mn, mx);
  return bmn[2] >= Z_CUT;
};

/**
 * Per-TRIANGLE Z clip for a single non-instanced primitive. Keeps every triangle
 * whose world-space centroid Z ≥ Z_CUT and drops the rest, then COMPACTS all vertex
 * attributes (POSITION/NORMAL/TEXCOORD_0/COLOR_0) down to the surviving vertices and
 * rebuilds the index buffer (so no orphan vertices bloat the output). Returns
 * `{ keptTris, bmn, bmx }` (kept count + world-space bbox of the kept vertices);
 * `{ keptTris: 0 }` when the whole primitive is on the removed side.
 *
 * WHY THIS IS SAFE (no open shells): a pre-pass verified ZERO source triangles
 * straddle the plane Z = Z_CUT = -143 (it sits in a natural empty gap between the
 * kept downtown at Z ≥ ~-137 and the removed low-rise strip at Z ≤ ~-166). So every
 * triangle is wholly on one side and a per-triangle keep:
 *   • keeps each whole building on the kept side intact (all its tris pass);
 *   • drops each whole building on the removed side (all its tris fail);
 *   • clips the flat FLOOR / ROAD / PLAZA slabs to a clean straight boundary at
 *     Z_CUT (flat sheets → a flat line, not a hollow open face).
 * No triangle is split and no vertical wall is cut open.
 *
 * This REPLACES the old whole-node `foot ≤ 60` drop, which deleted the floor, the
 * roads and every large building outright (their whole-node footprint exceeded 60)
 * — the over-removal bug. The plain nodes are JOINED merges of many disjoint
 * buildings + the city floor slabs, so a per-triangle test is the only granularity
 * that can both retain the kept-side buildings of a merge AND bound the merge's
 * removed-side sprawl.
 */
function clipPlainPrimitiveByZ(prim, nodeM) {
  const indices = prim.getIndices();
  const pos = prim.getAttribute('POSITION');
  const idxArr = indices.getArray();
  const posArr = pos.getArray();
  const triCount = idxArr.length / 3;

  const used = new Map(); // old vertex index → new (compacted) index
  const newIdx = [];
  const bmn = [Infinity, Infinity, Infinity];
  const bmx = [-Infinity, -Infinity, -Infinity];

  for (let t = 0; t < triCount; t++) {
    const tri = [idxArr[t * 3], idxArr[t * 3 + 1], idxArr[t * 3 + 2]];
    const ws = tri.map((vi) => mat4Apply(nodeM, [posArr[vi * 3], posArr[vi * 3 + 1], posArr[vi * 3 + 2]]));
    const cz = (ws[0][2] + ws[1][2] + ws[2][2]) / 3;
    if (cz < Z_CUT) continue; // triangle is on the removed side — drop it whole
    for (let j = 0; j < 3; j++) {
      const w = ws[j];
      for (let k = 0; k < 3; k++) {
        if (w[k] < bmn[k]) bmn[k] = w[k];
        if (w[k] > bmx[k]) bmx[k] = w[k];
      }
      let ni = used.get(tri[j]);
      if (ni === undefined) {
        ni = used.size;
        used.set(tri[j], ni);
      }
      newIdx.push(ni);
    }
  }

  const keptTris = newIdx.length / 3;
  if (keptTris === 0) return { keptTris: 0 };

  // Compact every vertex attribute down to the surviving vertices, preserving
  // per-vertex data (UVs are remapped into the atlas cell later, on this subset).
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem);
    const src = acc.getArray();
    const comps = acc.getElementSize();
    const dst = new src.constructor(used.size * comps);
    for (const [oldVi, ni] of used) {
      for (let k = 0; k < comps; k++) dst[ni * comps + k] = src[oldVi * comps + k];
    }
    acc.setArray(dst);
  }
  const IndexArray = used.size > 65535 ? Uint32Array : Uint16Array;
  indices.setArray(new IndexArray(newIdx));
  return { keptTris, bmn, bmx };
}

/**
 * MOBILE-ONLY edge-third crop. Removes the STRAND/FLEET board-edge third of the
 * city (model −Z third, cz < Z_CUT) — the SAME region the prior build removed; only
 * the over-removal is fixed. Mutates `doc` IN PLACE on the still-instanced source
 * (before atlas/uninstance/join/draco). For each mesh-bearing node:
 *   • instanced (EXT_mesh_gpu_instancing): keep every instance whose ENTIRE world
 *     bbox is on the kept side (MIN Z ≥ Z_CUT — keepInstance, NO foot cap, so no
 *     instance overhangs the cut plane); rebuild the instance attributes with the
 *     survivors; dispose the node+mesh if none remain.
 *   • non-instanced (plain): keep every TRIANGLE with world-bbox center Z ≥ Z_CUT
 *     (clipPlainPrimitiveByZ) — this RETAINS the floor, roads and large buildings the
 *     old foot-cap wrongly deleted; dispose the node+mesh if 0 tris remain.
 * Whole buildings only — no triangle straddles the plane (verified), so nothing is
 * sliced open. Orphaned meshes/accessors are cleaned by prune() downstream.
 */
function cropRemoveEdgeThird(doc) {
  const root = doc.getRoot();
  let keptInst = 0;
  let droppedInst = 0;
  let keptNodes = 0;
  let droppedNodes = 0;
  let clippedNodes = 0;
  let keptTris = 0;
  let droppedTris = 0;
  const gmn = [Infinity, Infinity, Infinity];
  const gmx = [-Infinity, -Infinity, -Infinity];
  const growBox = (m, mn, mx) => {
    const [bmn, bmx] = worldBox(m, mn, mx);
    for (let k = 0; k < 3; k++) {
      if (bmn[k] < gmn[k]) gmn[k] = bmn[k];
      if (bmx[k] > gmx[k]) gmx[k] = bmx[k];
    }
  };
  const growPoint = (p) => {
    for (let k = 0; k < 3; k++) {
      if (p[k] < gmn[k]) gmn[k] = p[k];
      if (p[k] > gmx[k]) gmx[k] = p[k];
    }
  };

  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const nodeM = mat4FromTRS(node.getTranslation(), node.getRotation(), node.getScale());
    const [mn, mx] = meshLocalBox(mesh);
    const inst = node.getExtension('EXT_mesh_gpu_instancing');

    if (inst) {
      const T = inst.getAttribute('TRANSLATION');
      const R = inst.getAttribute('ROTATION');
      const S = inst.getAttribute('SCALE');
      const ta = T.getArray();
      const ra = R ? R.getArray() : null;
      const sa = S ? S.getArray() : null;
      const keep = [];
      for (let i = 0; i < T.getCount(); i++) {
        const it = [ta[i * 3], ta[i * 3 + 1], ta[i * 3 + 2]];
        const ir = ra ? [ra[i * 4], ra[i * 4 + 1], ra[i * 4 + 2], ra[i * 4 + 3]] : [0, 0, 0, 1];
        const is = sa ? [sa[i * 3], sa[i * 3 + 1], sa[i * 3 + 2]] : [1, 1, 1];
        const m = mat4Mul(nodeM, mat4FromTRS(it, ir, is));
        if (keepInstance(m, mn, mx)) {
          keep.push(i);
          growBox(m, mn, mx);
        }
      }
      const total = T.getCount();
      droppedInst += total - keep.length;
      keptInst += keep.length;
      if (keep.length === 0) {
        mesh.dispose();
        node.dispose();
        droppedNodes++;
        continue;
      }
      if (keep.length < total) {
        for (const sem of inst.listSemantics()) {
          const acc = inst.getAttribute(sem);
          const comps = acc.getElementSize();
          const src = acc.getArray();
          const dst = new src.constructor(keep.length * comps);
          keep.forEach((idx, j) => {
            for (let k = 0; k < comps; k++) dst[j * comps + k] = src[idx * comps + k];
          });
          acc.setArray(dst);
        }
      }
      keptNodes++;
    } else {
      // Plain node: per-triangle Z clip on the single indexed TRIANGLES primitive.
      const prim = mesh.listPrimitives()[0];
      const before = prim.getIndices().getArray().length / 3;
      const res = clipPlainPrimitiveByZ(prim, nodeM);
      if (res.keptTris === 0) {
        mesh.dispose();
        node.dispose();
        droppedNodes++;
        droppedTris += before;
        continue;
      }
      droppedTris += before - res.keptTris;
      keptTris += res.keptTris;
      if (res.keptTris < before) clippedNodes++;
      keptNodes++;
      growPoint(res.bmn);
      growPoint(res.bmx);
    }
  }

  console.log(
    `[gen-city-mobile] edge-third crop (instances: keep min-Z ≥ ${Z_CUT}; plain: keep per-triangle centroid ≥ ${Z_CUT}; NO foot cap): ` +
      `kept ${keptNodes} nodes (${clippedNodes} slab/merge nodes clipped), ${keptInst} instances, ` +
      `${keptTris} plain tris (dropped ${droppedNodes} nodes, ${droppedInst} instances, ${droppedTris} plain tris)`,
  );
  console.log(
    `[gen-city-mobile] crop kept world bbox: ` +
      `X[${gmn[0].toFixed(1)}..${gmx[0].toFixed(1)}] ` +
      `Y[${gmn[1].toFixed(1)}..${gmx[1].toFixed(1)}] ` +
      `Z[${gmn[2].toFixed(1)}..${gmx[2].toFixed(1)}] ` +
      `(${(gmx[0] - gmn[0]).toFixed(1)}×${(gmx[2] - gmn[2]).toFixed(1)}, ` +
      `aspect ${((gmx[0] - gmn[0]) / (gmx[2] - gmn[2])).toFixed(3)})`,
  );
}
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
  console.log(
    `[gen-city-mobile] source: ${root.listMeshes().length} meshes, ${materials.length} materials, ` +
      `${root.listTextures().length} textures`,
  );
  if (materials.length > COLS * ROWS) {
    throw new Error(
      `atlas grid ${COLS}×${ROWS}=${COLS * ROWS} too small for ${materials.length} materials`,
    );
  }

  // ── 1b. Remove the STRAND/FLEET edge third (MOBILE-ONLY) ────────────────────
  // Runs on the still-instanced source, before atlas/uninstance/join/draco.
  // Per-instance + per-triangle Z clip — retains the floor / roads / big buildings
  // on the kept side and never slices a building (no source triangle crosses the
  // plane). See the PIPELINE step 1b header for the full derivation.
  cropRemoveEdgeThird(doc);

  // Re-list AFTER the crop so the atlas UV-remap + shared-material passes below only
  // touch surviving meshes (fully-removed nodes were disposed above).
  const meshes = root.listMeshes();

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
  // open-boundary/silhouette edges (building outlines, city perimeter, and the flat
  // slab cut edge at Z_CUT). The SimplePoly city is hard-edged low-poly "triangle
  // soup", so attribute-consistent welding leaves few interior collapsible edges →
  // expect a CONSERVATIVE reduction, which is exactly the "gentle" intent (see the
  // read-back tri count below to verify).
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
