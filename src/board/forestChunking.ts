import * as THREE from 'three';

/**
 * ── MOBILE-ONLY FOREST CHUNKING (frustum-cullable forest) ────────────────────
 *
 * The forest glb loads as one island-wide `InstancedMesh` per prop type (23
 * types / ~1162 instances DENSELY filling a ~92-unit box — NOT a sparse annulus:
 * trees, flowers, mushrooms and rocks blanket the terrain, and the "floor" itself
 * is instanced ground patches — Meadow, Grass, Meadow_Path, Lake_Ground). three's
 * frustum culler tests a mesh's bounding volume against the camera frustum, and an
 * island-wide bound ALWAYS intersects the frustum, so NONE of the forest is ever
 * culled — trees behind and beside the camera are still processed and (with the
 * per-fragment fade `discard`) pay full overdraw.
 *
 * This helper REBUILDS every island-wide mesh into a spatial GRID of smaller
 * `InstancedMesh` chunks — each chunk holding only the instances whose position
 * falls in its cell, with a LOCAL bounding sphere (via `computeBoundingSphere`)
 * covering just that cell. Chunks keep `frustumCulled` at its default `true`, so
 * three culls the off-screen cells. Same geometry, same shared (already
 * fade-patched) material, same per-instance transforms → with the whole scene in
 * view the render is pixel-identical; ONLY the draw organization changes.
 *
 * EVERY forest type ends up with LOCAL bounds + `frustumCulled=true` — the pass
 * NEVER leaves a type island-wide with culling off. Three rules keep the draw-call
 * count a LOW multiple of the ~23 baseline instead of exploding it (a naive
 * per-cell split over every type produced ~6-7×):
 *
 *   1. GROUND/FLOOR types are CHUNKED (for local, cullable bounds) but NEVER
 *      THINNED — so the far forest floor is never holed while the island-wide
 *      floor becomes cullable (see {@link isForestGroundMesh}). Only
 *      trees/foliage/rocks are eligible for thinning.
 *   2. MIN-CHUNK FLOOR (`minChunkInstances`): a type whose TOTAL instance count is
 *      below the floor is NOT spatially partitioned — but it is still emitted as
 *      ONE local-bounded, cullable chunk of all its instances (chunking a
 *      low-count type into many cells wastes draw calls; one cullable mesh does
 *      not, and it costs the same one draw call the island-wide original did).
 *   3. CELL DEFRAG (`mergeCellMin`): within a partitioned type, a grid cell holding
 *      fewer than `mergeCellMin` surviving instances is FOLDED into its nearest
 *      populated cell instead of becoming its own near-empty chunk. If NO cell
 *      clears the threshold the whole type is too sparse to partition usefully and
 *      is emitted as ONE local-bounded, cullable chunk of all its instances
 *      (still cullable — edge-ringing mountains are often fully off-screen).
 *
 * It ALSO statically thins the outer ring of the NON-GROUND (tree/foliage) types
 * ONLY: instances beyond `thinDistance` from the board center are kept at
 * `keepEvery`-stride (1 of every K). Static (not per-frame / per-camera) so
 * nothing pops as the camera orbits. Ground is never thinned (rule 1), and the
 * single-mesh fallbacks (rules 2 & 3) keep ALL instances unthinned. Set
 * `keepFraction >= 1` to disable thinning entirely (chunking still applies).
 *
 * Coordinate frame: `boxMin`, `size`, `center` and every instance position are
 * in the forest scene's ROOT space (the frame `Box3.setFromObject(scene)` used),
 * BEFORE the outer group's scale/offset is applied. `groupScale` converts a
 * root-space XZ delta into world units (the board sits at world origin, and the
 * scene is recentered so `center` maps to origin), so the thinning distance is
 * expressed in world units. This must run BEFORE the caller sets
 * `scene.position`, while each `InstancedMesh.matrixWorld` still reflects only
 * the glb's internal hierarchy.
 */

/**
 * Terrain/FLOOR prop-type classifier — the SINGLE SOURCE OF TRUTH shared with
 * `ForestEnvironment`'s surface-height sampler. Matches the instanced ground
 * patches (Meadow, Grass, Meadow_Path, Lake_Ground) by name. Ground/floor types
 * are CHUNKED like everything else (for local, cullable bounds) but are excluded
 * from THINNING (see rule 1 above), so the far forest floor is never holed.
 */
export const FOREST_GROUND_NAME_RE = /meadow|grass|path|lake/i;

/** True for terrain/floor prop types (see {@link FOREST_GROUND_NAME_RE}). */
export function isForestGroundMesh(name: string): boolean {
  return FOREST_GROUND_NAME_RE.test(name);
}

/**
 * HORIZONTAL (ground-plane, XZ-only) nearest distance from a point to a world-space
 * AABB — the vertical (Y) extent of the box is deliberately ignored.
 *
 * This is the metric the mobile render-distance cull uses, and ignoring Y is the
 * whole fix for a UNIFORM draw-distance ring with no mid-field holes:
 *
 *   A chunk's world AABB is instanced-aware and correct, but its Y extent varies
 *   HUGELY by prop type over the SAME ground cell — a flat ground tile spans a few
 *   tenths of a unit in Y, the trees standing on it span several units, a moss
 *   mountain spans tens of units. The camera orbits a few units ABOVE the ground,
 *   so a full 3-D nearest-point test (`Box3.clampPoint`) folds that per-type Y
 *   extent into the distance: a tall chunk whose box rises toward the camera's
 *   height reports a SMALLER nearest distance than the flat ground box directly
 *   under it. At the ring boundary the two therefore cross FOREST_RENDER_DISTANCE
 *   at DIFFERENT camera distances → the ground culls while the trees/mountain on
 *   it stay (or the reverse): a hole in the middle of the visible terrain, and a
 *   ragged (type-dependent) ring rather than a clean one.
 *
 *   Measuring only the horizontal (XZ) distance removes Y from the comparison
 *   entirely, so every chunk covering a given ground patch — ground, foliage,
 *   rock, mountain — reports the SAME distance and crosses the ring TOGETHER. The
 *   result is a clean Minecraft-style ground-plane ring (Minecraft's render
 *   distance is likewise a horizontal chunk distance), and because the horizontal
 *   distance is always ≤ the 3-D distance the test is strictly MORE inclusive than
 *   the old one — anything that rendered before still renders, so close chunks can
 *   never be culled and holes can only ever fall BEYOND the ring.
 *
 * Returns the true nearest horizontal distance (0 when the point's XZ is inside
 * the box footprint). Pure scalar math — no allocation, safe to call per chunk per
 * frame.
 */
export function horizontalNearestDistanceToBox(box: THREE.Box3, x: number, z: number): number {
  const dx = x < box.min.x ? box.min.x - x : x > box.max.x ? x - box.max.x : 0;
  const dz = z < box.min.z ? box.min.z - z : z > box.max.z ? z - box.max.z : 0;
  return Math.sqrt(dx * dx + dz * dz);
}

export interface ForestChunkParams {
  /** The cloned forest scene whose InstancedMeshes will be replaced in place. */
  scene: THREE.Object3D;
  /** Root-space min corner of the whole-scene bounding box. */
  boxMin: THREE.Vector3;
  /** Root-space size of the whole-scene bounding box. */
  size: THREE.Vector3;
  /** Root-space center of the whole-scene bounding box (maps to world origin). */
  center: THREE.Vector3;
  /** Outer-group scale: root-space unit → world unit. */
  groupScale: number;
  /** Grid resolution per horizontal axis (gridN × gridN cells over the scene box). */
  gridN: number;
  /** World-unit radius from board center beyond which instances are thinned. */
  thinDistance: number;
  /** Fraction of FAR-ring instances to keep (0<f≤1; 1 = keep all / no thinning). */
  keepFraction: number;
  /**
   * Min TOTAL instances for a type to be SPATIALLY partitioned. A type below this
   * is emitted as ONE local-bounded, cullable chunk instead of many cells
   * (partitioning a low-count type wastes draw calls; it is still made cullable).
   */
  minChunkInstances: number;
  /**
   * Min surviving instances for a grid cell to become its own chunk. Cells below
   * this are folded into the nearest populated cell (defrag); if no cell clears
   * it, the whole type is emitted as ONE local-bounded, cullable chunk.
   */
  mergeCellMin: number;
  /**
   * OPTIONAL far-chunk LOD geometry, keyed by source InstancedMesh name (== the
   * full mesh name). A chunk of a type present in this map uses the decimated
   * `_LOD` geometry when it is FAR (every instance it holds lies beyond
   * `thinDistance` from the board center) and the full geometry otherwise. Types
   * absent from the map (e.g. the already-decimated ground/flat tiles) always
   * use their single full geometry. The decision is STATIC (build-time, from the
   * fixed instance positions), so nothing pops as the camera orbits. Omit to
   * disable LOD swapping entirely (every chunk uses full geometry — the
   * pre-LOD behavior, byte-identical for the existing tests).
   */
  lodGeometry?: Map<string, THREE.BufferGeometry>;
}

/**
 * Replace every island-wide forest `InstancedMesh` under `scene` with local-bounded,
 * frustum-cullable `InstancedMesh` chunks. Dense types split into a per-cell grid;
 * low-count / too-sparse types become ONE local-bounded cullable chunk (never left
 * island-wide). NON-ground types have their far ring statically thinned; GROUND/FLOOR
 * types (see {@link isForestGroundMesh}) are chunked but NEVER thinned. When a
 * `lodGeometry` map is supplied, FAR chunks of relief types (every instance beyond
 * `thinDistance`) render the decimated `_LOD` geometry while near chunks keep full
 * detail — a static, non-popping LOD that stacks with the far-thinning. Mutates the
 * scene graph; reuses geometry + material.
 */
export function rebuildForestAsChunks(params: ForestChunkParams): void {
  const {
    scene,
    boxMin,
    size,
    center,
    groupScale,
    gridN,
    thinDistance,
    keepFraction,
    minChunkInstances,
    mergeCellMin,
    lodGeometry,
  } = params;

  // keep 1 of every `keepEvery` far instances; keepFraction>=1 disables thinning.
  const keepEvery = keepFraction >= 1 ? 1 : Math.max(1, Math.round(1 / keepFraction));

  // Collect ALL forest InstancedMesh sources — do NOT mutate the graph
  // mid-traverse. GROUND/FLOOR types are chunked too now (for LOCAL bounds so the
  // island-wide floor becomes cullable), but they are NEVER thinned (thinning
  // punched visible holes in the far floor); see the per-type `typeKeepEvery`
  // below. Only trees/foliage/rocks are eligible for far-ring thinning.
  const sources: THREE.InstancedMesh[] = [];
  scene.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: o is Object3D; only actual InstancedMeshes have isInstancedMesh===true
    if (!im.isInstancedMesh) return;
    sources.push(im);
  });

  const cellSizeX = size.x / gridN || 1;
  const cellSizeZ = size.z / gridN || 1;
  const thinDistSq = thinDistance * thinDistance;

  const m4 = new THREE.Matrix4();
  const worldM = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const color = new THREE.Color();

  const clampCell = (v: number): number => Math.min(gridN - 1, Math.max(0, Math.floor(v)));
  const cellCenterX = (key: number): number => boxMin.x + (Math.floor(key / gridN) + 0.5) * cellSizeX;
  const cellCenterZ = (key: number): number => boxMin.z + ((key % gridN) + 0.5) * cellSizeZ;

  // Emit ONE local-bounded, frustum-cullable InstancedMesh holding the given
  // instance indices of `im` (reusing geometry+material). The LOCAL
  // `computeBoundingSphere` over just these instances is what lets three's
  // frustum culler drop it when it leaves the view — the whole point of this
  // pass. This is also the single-mesh fallback for types too small/sparse to
  // partition: a local bound over ALL of one type's instances still culls when
  // that whole type is off-screen (e.g. edge-ringing mountains looking at sky),
  // so we NEVER leave a forest type island-wide with frustumCulled=false.
  const emitChunk = (indices: number[], im: THREE.InstancedMesh, name: string): void => {
    const parent = im.parent;
    if (!parent) return;

    // FAR-CHUNK LOD SELECTION. A chunk uses the type's decimated `_LOD` geometry
    // ONLY when EVERY instance it holds sits beyond `thinDistance` from the board
    // center — so any chunk that reaches into the near ring keeps FULL detail and
    // the near view is visually unchanged. The far view is near-identical (a ~50%
    // decimation of already-distant props). Ground/flat types have no `_LOD`
    // entry and fall back to their single (already-decimated) geometry. The test
    // is on the SAME world-unit distance the far-thinning uses, computed from the
    // fixed instance positions → a static decision with no mid-motion popping.
    let geometry = im.geometry;
    const lod = lodGeometry?.get(im.name);
    if (lod) {
      let minDistSq = Infinity;
      for (const idx of indices) {
        im.getMatrixAt(idx, m4);
        worldM.multiplyMatrices(im.matrixWorld, m4);
        pos.setFromMatrixPosition(worldM);
        const wdx = (pos.x - center.x) * groupScale;
        const wdz = (pos.z - center.z) * groupScale;
        const dsq = wdx * wdx + wdz * wdz;
        if (dsq < minDistSq) minDistSq = dsq;
      }
      if (minDistSq > thinDistSq) geometry = lod;
    }

    const chunk = new THREE.InstancedMesh(geometry, im.material, indices.length);
    chunk.name = name;
    chunk.receiveShadow = im.receiveShadow;
    chunk.castShadow = im.castShadow;
    // frustumCulled=true (three's default) — with a LOCAL bound, off-screen
    // chunks now cull. (The island-wide originals had it forced false.)
    chunk.frustumCulled = true;
    for (let k = 0; k < indices.length; k++) {
      im.getMatrixAt(indices[k], m4);
      chunk.setMatrixAt(k, m4);
      if (im.instanceColor) {
        im.getColorAt(indices[k], color);
        chunk.setColorAt(k, color);
      }
    }
    chunk.instanceMatrix.needsUpdate = true;
    if (chunk.instanceColor) chunk.instanceColor.needsUpdate = true;
    chunk.computeBoundingSphere(); // LOCAL bound → frustum-cullable
    parent.add(chunk);
  };

  // [0..n) — the full, UNTHINNED index list for the single-mesh fallbacks.
  const allIndices = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

  for (const im of sources) {
    const parent = im.parent;
    if (!parent) continue;

    // GROUND/FLOOR is chunked for local bounds too, but is NEVER thinned
    // (thinning punched holes in the far floor). keepEvery=1 for ground disables
    // the far-ring stride; non-ground keeps the configured thinning.
    const isGround = isForestGroundMesh(im.name);
    const typeKeepEvery = isGround ? 1 : keepEvery;

    // MIN-CHUNK FLOOR: a low-count type isn't worth SPATIALLY partitioning, but it
    // must still become CULLABLE → emit ONE local-bounded chunk of ALL its
    // instances (unthinned) instead of leaving the island-wide, un-culled original.
    if (im.count < minChunkInstances) {
      emitChunk(allIndices(im.count), im, `${im.name}-chunk0`);
      parent.remove(im);
      continue;
    }

    // Bucket surviving instance indices by grid cell (cx * gridN + cz), thinning
    // the far ring as we go (ground: typeKeepEvery=1 → nothing thinned).
    const buckets = new Map<number, number[]>();
    let farKept = 0; // per-type running index of FAR instances (drives keepEvery stride)

    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m4);
      worldM.multiplyMatrices(im.matrixWorld, m4);
      pos.setFromMatrixPosition(worldM);

      // World-unit distance from board center for static thinning.
      const wdx = (pos.x - center.x) * groupScale;
      const wdz = (pos.z - center.z) * groupScale;
      if (wdx * wdx + wdz * wdz > thinDistSq) {
        const keep = farKept % typeKeepEvery === 0;
        farKept += 1;
        if (!keep) continue;
      }

      const cx = clampCell((pos.x - boxMin.x) / cellSizeX);
      const cz = clampCell((pos.z - boxMin.z) / cellSizeZ);
      const key = cx * gridN + cz;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i);
      else buckets.set(key, [i]);
    }

    // CELL DEFRAG: keep only cells that clear `mergeCellMin` as their own chunk;
    // fold every smaller cell into the nearest kept cell (by cell-center XZ). If
    // NO cell clears the threshold the type is too sparse to partition usefully →
    // still emit ONE local-bounded cullable chunk of ALL its instances (unthinned)
    // rather than leave the island-wide, un-culled original (edge-ringing
    // mountains are often fully off-screen, so a single local bound already culls).
    const entries = [...buckets.entries()];
    const bigBuckets = entries.filter(([, v]) => v.length >= mergeCellMin);
    if (bigBuckets.length === 0) {
      emitChunk(allIndices(im.count), im, `${im.name}-chunk0`);
      parent.remove(im);
      continue;
    }

    const finalBuckets = new Map<number, number[]>(bigBuckets.map(([k, v]) => [k, v.slice()]));
    for (const [key, v] of entries) {
      if (v.length >= mergeCellMin) continue; // already its own chunk
      const sx = cellCenterX(key);
      const sz = cellCenterZ(key);
      let bestKey = bigBuckets[0][0];
      let bestD = Infinity;
      for (const [bk] of bigBuckets) {
        const dx = sx - cellCenterX(bk);
        const dz = sz - cellCenterZ(bk);
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          bestKey = bk;
        }
      }
      const target = finalBuckets.get(bestKey);
      if (target) for (const idx of v) target.push(idx);
    }

    // Emit one chunk InstancedMesh per final (kept) cell, reusing geometry+material.
    let chunkIdx = 0;
    for (const indices of finalBuckets.values()) {
      emitChunk(indices, im, `${im.name}-chunk${chunkIdx}`);
      chunkIdx += 1;
    }

    // Drop the original island-wide InstancedMesh (geometry + material are shared
    // with the chunks, so we do NOT dispose them).
    parent.remove(im);
  }
}
