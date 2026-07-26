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
 * This helper REBUILDS the TREE/FOLIAGE island-wide meshes into a spatial GRID of
 * smaller `InstancedMesh` chunks — each chunk holding only the instances whose
 * position falls in its cell, with a LOCAL bounding sphere (via
 * `computeBoundingSphere`) covering just that cell. Chunks keep `frustumCulled`
 * at its default `true`, so three culls the off-screen cells. Same geometry, same
 * shared (already fade-patched) material, same per-instance transforms → with the
 * whole scene in view the render is pixel-identical; ONLY the draw organization
 * changes.
 *
 * THREE GUARDS keep the draw-call count a LOW multiple of the ~23 baseline instead
 * of exploding it (a naive per-cell split over every type produced ~6-7×):
 *
 *   1. GROUND/FLOOR types are left ENTIRELY UNTOUCHED — never chunked, never
 *      thinned — so they stay exactly the single island-wide `InstancedMesh` the
 *      desktop path uses (see {@link isForestGroundMesh}). They are flat, cheap
 *      and low-overdraw: culling saves little, chunking them inflates draw calls,
 *      and thinning them punches visible HOLES in the far terrain. Only
 *      trees/foliage/rocks are eligible for chunking + thinning.
 *   2. MIN-CHUNK FLOOR (`minChunkInstances`): a tree type whose TOTAL instance
 *      count is below the floor is left as ONE island-wide mesh — chunking a
 *      low-count type wastes draw calls for negligible culling benefit.
 *   3. CELL DEFRAG (`mergeCellMin`): within a chunked type, a grid cell holding
 *      fewer than `mergeCellMin` surviving instances is FOLDED into its nearest
 *      populated cell instead of becoming its own near-empty chunk. If NO cell
 *      clears the threshold the whole type is too sparse to chunk usefully and is
 *      left as one island-wide mesh.
 *
 * It ALSO statically thins the outer ring of the CHUNKED (tree/foliage) types
 * ONLY: instances beyond `thinDistance` from the board center are kept at
 * `keepEvery`-stride (1 of every K). Static (not per-frame / per-camera) so
 * nothing pops as the camera orbits. Ground is never thinned (guard 1). Set
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
 * are excluded from mobile chunking + thinning (see guard 1 above): they stay the
 * same single island-wide `InstancedMesh` as desktop, so the far forest floor is
 * never holed by thinning and no draw calls are spent chunking flat terrain.
 */
export const FOREST_GROUND_NAME_RE = /meadow|grass|path|lake/i;

/** True for terrain/floor prop types (see {@link FOREST_GROUND_NAME_RE}). */
export function isForestGroundMesh(name: string): boolean {
  return FOREST_GROUND_NAME_RE.test(name);
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
   * Min TOTAL instances for a (non-ground) type to be chunked at all. A type
   * below this stays one island-wide mesh (chunking it wastes draw calls).
   */
  minChunkInstances: number;
  /**
   * Min surviving instances for a grid cell to become its own chunk. Cells below
   * this are folded into the nearest populated cell (defrag); if no cell clears
   * it, the whole type stays one island-wide mesh.
   */
  mergeCellMin: number;
}

/**
 * Replace every TREE/FOLIAGE island-wide forest `InstancedMesh` under `scene`
 * with a grid of per-cell `InstancedMesh` chunks (local bounds, frustum-cullable)
 * and statically thin their far ring. GROUND/FLOOR types (see
 * {@link isForestGroundMesh}) and sub-floor / too-sparse types are left as their
 * original single island-wide mesh. Mutates the scene graph; reuses geometry +
 * material.
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
  } = params;

  // keep 1 of every `keepEvery` far instances; keepFraction>=1 disables thinning.
  const keepEvery = keepFraction >= 1 ? 1 : Math.max(1, Math.round(1 / keepFraction));

  // Collect CHUNKABLE sources first — do NOT mutate the graph mid-traverse.
  // GROUND/FLOOR types are skipped here → left as their single island-wide mesh
  // (untouched, identical to desktop: not chunked, not thinned).
  const sources: THREE.InstancedMesh[] = [];
  scene.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: o is Object3D; only actual InstancedMeshes have isInstancedMesh===true
    if (!im.isInstancedMesh) return;
    if (isForestGroundMesh(im.name)) return; // ground/floor stays island-wide
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

  for (const im of sources) {
    const parent = im.parent;
    if (!parent) continue;

    // MIN-CHUNK FLOOR: a low-count type isn't worth chunking → leave the original
    // single island-wide mesh in place (untouched: not chunked, not thinned).
    if (im.count < minChunkInstances) continue;

    // Bucket surviving instance indices by grid cell (cx * gridN + cz), thinning
    // the far ring as we go.
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
        const keep = farKept % keepEvery === 0;
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
    // no cell clears the threshold the type is too sparse to chunk usefully →
    // leave the original single island-wide mesh in place.
    const entries = [...buckets.entries()];
    const bigBuckets = entries.filter(([, v]) => v.length >= mergeCellMin);
    if (bigBuckets.length === 0) continue; // too sparse → keep original single mesh

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
      const chunk = new THREE.InstancedMesh(im.geometry, im.material, indices.length);
      chunk.name = `${im.name}-chunk${chunkIdx}`;
      chunkIdx += 1;
      chunk.receiveShadow = im.receiveShadow;
      chunk.castShadow = im.castShadow;
      // frustumCulled stays at its default (true) — THIS is the point: with a
      // local per-cell bound, off-screen chunks now cull.
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

      // Local bound covering ONLY this chunk's instances → frustum-cullable.
      chunk.computeBoundingSphere();

      parent.add(chunk);
    }

    // Drop the original island-wide InstancedMesh (geometry + material are shared
    // with the chunks, so we do NOT dispose them).
    parent.remove(im);
  }
}
