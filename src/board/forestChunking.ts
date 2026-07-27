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
 * The pre-created LOD geometry TIERS for one eligible relief type, stashed on
 * each chunk's `userData.forestLod` by {@link rebuildForestAsChunks} so the
 * per-frame camera-distance LOD swap (in ForestEnvironment) can flip a chunk's
 * `geometry` between them with zero allocation and zero GPU re-upload (all three
 * geometries are already uploaded). `full` is the source geometry the chunk is
 * born with; `lod1`/`lod2` are the ~50% / ~25% decimated siblings. Non-eligible
 * types (mountains/ground) get NO `forestLod` and stay on `full` forever.
 */
export interface ForestChunkLod {
  full: THREE.BufferGeometry;
  lod1: THREE.BufferGeometry;
  lod2: THREE.BufferGeometry;
}

/** LOD tier index: 0 = full detail, 1 = LOD1 (~50%), 2 = LOD2 (~25%). */
export type ForestLodTier = 0 | 1 | 2;

/**
 * DYNAMIC camera-distance LOD tier selection with HYSTERESIS. Given a chunk's
 * CURRENT tier and its distance to the camera, returns the tier it should render
 * at: `< dist1` → full (0), `dist1..dist2` → LOD1 (1), `> dist2` → LOD2 (2).
 *
 * Each threshold carries a ±`hysteresis` dead-band: a boundary is only crossed
 * once the distance is `hysteresis` PAST it in the direction of travel, so a
 * chunk parked right on a boundary (as the free-roam camera drifts) never
 * flip-flops between tiers frame to frame. Multi-tier jumps (a teleporting
 * camera) resolve in a single call. Pure + allocation-free — safe to call every
 * throttled frame per chunk.
 */
export function selectForestLodTier(
  current: ForestLodTier,
  camDist: number,
  dist1: number,
  dist2: number,
  hysteresis: number,
): ForestLodTier {
  let tier: number = current;
  // Upgrade toward lower-detail tiers as the camera pulls away. Only cross a
  // boundary once we are `hysteresis` BEYOND it.
  while (tier < 2) {
    const edge = tier === 0 ? dist1 : dist2;
    if (camDist > edge + hysteresis) tier += 1;
    else break;
  }
  // Downgrade toward higher-detail tiers as the camera closes in.
  while (tier > 0) {
    const edge = tier === 2 ? dist2 : dist1;
    if (camDist < edge - hysteresis) tier -= 1;
    else break;
  }
  return tier as ForestLodTier;
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
   * OPTIONAL per-type LOD geometry TIERS, keyed by source InstancedMesh name
   * (== the full mesh name). For every eligible relief type (trees / flowers /
   * mushrooms / grass / rocks) this supplies the `_LOD1` (~50%) and `_LOD2`
   * (~25%) decimated siblings. A chunk of a type present in this map is BORN with
   * full geometry but is tagged with `userData.forestLod = {full, lod1, lod2}` so
   * ForestEnvironment's throttled per-frame loop can DYNAMICALLY swap
   * `chunk.geometry` by CAMERA distance (near→full, mid→LOD1, far→LOD2). Types
   * absent from the map (e.g. the un-decimated ground/flat tiles and mountains,
   * which tear when simplified) get NO tag and keep full geometry forever. Omit
   * the whole map to disable LOD entirely (every chunk full, no tag — the pre-LOD
   * behavior).
   */
  lodGeometry?: Map<string, { lod1: THREE.BufferGeometry; lod2: THREE.BufferGeometry }>;
}

/**
 * Replace every island-wide forest `InstancedMesh` under `scene` with local-bounded,
 * frustum-cullable `InstancedMesh` chunks. Dense types split into a per-cell grid;
 * low-count / too-sparse types become ONE local-bounded cullable chunk (never left
 * island-wide). NON-ground types have their far ring statically thinned; GROUND/FLOOR
 * types (see {@link isForestGroundMesh}) are chunked but NEVER thinned. When a
 * `lodGeometry` map is supplied, every eligible relief chunk is tagged with its
 * `{full, lod1, lod2}` geometry tiers (`userData.forestLod`) so ForestEnvironment
 * can DYNAMICALLY swap `chunk.geometry` by camera distance at runtime; the chunks
 * are all BORN full-detail here (the swap is per-frame, not build-time). Mutates
 * the scene graph; reuses geometry + material.
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

    // Every chunk is BORN with the FULL source geometry. DYNAMIC LOD selection
    // (by CAMERA distance, with hysteresis) happens per-frame at runtime in
    // ForestEnvironment — NOT here at build time. For eligible relief types we
    // stash the pre-created {full, lod1, lod2} tiers on `userData.forestLod` so
    // that per-frame loop can flip `chunk.geometry` between them with no
    // allocation and no GPU re-upload (all three are already uploaded). Types
    // absent from `lodGeometry` (ground/flat + mountains — they tear when
    // decimated) get NO tag and stay full-detail forever (fallback).
    const chunk = new THREE.InstancedMesh(im.geometry, im.material, indices.length);
    const lod = lodGeometry?.get(im.name);
    if (lod) {
      (chunk.userData as { forestLod?: ForestChunkLod }).forestLod = {
        full: im.geometry,
        lod1: lod.lod1,
        lod2: lod.lod2,
      };
    }
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
