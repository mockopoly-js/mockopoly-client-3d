import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  rebuildForestAsChunks,
  isForestGroundMesh,
  selectForestLodTier,
  selectForestDensityTier,
  densityKeepForTier,
  hashInstancePosition,
  orderByPositionHash,
  horizontalNearestDistanceToBox,
  type ForestChunkLod,
} from './forestChunking';

/** Read the LOD tiers the chunker stashed on a chunk (null for non-eligible types). */
function chunkLod(im: THREE.InstancedMesh): ForestChunkLod | null {
  return (im.userData as { forestLod?: ForestChunkLod }).forestLod ?? null;
}

/** Build an InstancedMesh named `name` with instances at the given XZ positions. */
function makeMesh(name: string, positions: [number, number][]): THREE.InstancedMesh {
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const im = new THREE.InstancedMesh(geom, mat, positions.length);
  im.name = name;
  const m = new THREE.Matrix4();
  positions.forEach(([x, z], i) => {
    m.makeTranslation(x, 0, z);
    im.setMatrixAt(i, m);
  });
  im.instanceMatrix.needsUpdate = true;
  return im;
}

/** Wrap one or more InstancedMeshes in a scene with world matrices resolved. */
function makeScene(...meshes: THREE.InstancedMesh[]): THREE.Group {
  const scene = new THREE.Group();
  for (const im of meshes) scene.add(im);
  scene.updateMatrixWorld(true);
  return scene;
}

function allInstanced(scene: THREE.Object3D): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  scene.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: o is Object3D; only actual InstancedMeshes have isInstancedMesh===true
    if (im.isInstancedMesh) out.push(im);
  });
  return out;
}

function countInstances(scene: THREE.Object3D): number {
  return allInstanced(scene).reduce((sum, im) => sum + im.count, 0);
}

/** Total instances across meshes whose name matches `re` (chunks keep the base name). */
function countMatching(scene: THREE.Object3D, re: RegExp): number {
  return allInstanced(scene)
    .filter((im) => re.test(im.name))
    .reduce((sum, im) => sum + im.count, 0);
}

/** Read back the XZ translation of every instance of a chunk, in RENDER order. */
function chunkOrderXZ(im: THREE.InstancedMesh): [number, number][] {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const out: [number, number][] = [];
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    out.push([p.x, p.z]);
  }
  return out;
}

/** A lodGeometry map marking every listed type as FOLIAGE (eligible relief). */
function foliageMap(...names: string[]): Map<string, { lod1: THREE.BufferGeometry; lod2: THREE.BufferGeometry }> {
  const map = new Map<string, { lod1: THREE.BufferGeometry; lod2: THREE.BufferGeometry }>();
  for (const n of names) map.set(n, { lod1: new THREE.BoxGeometry(2, 2, 2), lod2: new THREE.BoxGeometry(3, 3, 3) });
  return map;
}

const BOX_MIN = new THREE.Vector3(-12, 0, -12);
const SIZE = new THREE.Vector3(24, 1, 24);
const CENTER = new THREE.Vector3(0, 0, 0);

// Shipped defaults (mirrored so tests exercise the real thresholds).
const MIN_CHUNK = 4;
const MERGE_MIN = 1;

/** Base params for a chunk build over the 24-unit box; override per test. */
function params(over: Partial<Parameters<typeof rebuildForestAsChunks>[0]>) {
  return {
    scene: new THREE.Group(),
    boxMin: BOX_MIN,
    size: SIZE,
    center: CENTER,
    groupScale: 1,
    gridN: 4,
    thinDistance: 18,
    keepFraction: 1,
    minChunkInstances: MIN_CHUNK,
    mergeCellMin: MERGE_MIN,
    ...over,
  };
}

// Four dense 4-instance clusters, one per corner cell of the 4×4 grid → chunkable.
const DENSE_CLUSTERS: [number, number][] = [
  [-10, -10], [-9, -9], [-10, -9], [-9, -10], // cell (0,0)
  [9, 9], [8, 8], [9, 8], [8, 9], // cell (3,3)
  [-10, 9], [-9, 8], [-10, 8], [-9, 9], // cell (0,3)
  [9, -10], [8, -9], [9, -9], [8, -10], // cell (3,0)
];

describe('isForestGroundMesh', () => {
  it('classifies terrain/floor prop names as ground, foliage/rock as not', () => {
    for (const n of ['PP_Meadow_08', 'PP_Grass_11', 'PP_Meadow_Path_05', 'PP_Lake_Ground_04']) {
      expect(isForestGroundMesh(n)).toBe(true);
    }
    for (const n of ['PP_Tree_10', 'PP_Birch_Tree_05', 'PP_Hyacinth_04', 'PP_Rock_Moss_Grown_11']) {
      expect(isForestGroundMesh(n)).toBe(false);
    }
  });
});

describe('rebuildForestAsChunks', () => {
  it('(a) chunks GROUND/FLOOR types for local cullable bounds but NEVER thins them', () => {
    // Every ground-named type: a dense spread with FAR instances + aggressive thinning.
    for (const name of ['PP_Meadow_08', 'PP_Grass_11', 'PP_Meadow_Path_05', 'PP_Lake_Ground_04']) {
      const spread: [number, number][] = [];
      for (let x = -10; x <= 10; x += 2) for (let z = -10; z <= 10; z += 2) spread.push([x, z]);
      const ground = makeMesh(name, spread);
      const scene = makeScene(ground);
      rebuildForestAsChunks(params({ scene, keepFraction: 0.25, thinDistance: 3 }));

      const meshes = allInstanced(scene);
      expect(ground.parent).toBeNull(); // original island-wide mesh replaced by chunks
      expect(countInstances(scene)).toBe(spread.length); // NEVER thinned (keepFraction ignored for ground)
      for (const c of meshes) {
        expect(c.name).toMatch(/-chunk\d+$/); // emitted as chunk(s)
        expect(c.frustumCulled).toBe(true); // local bound → cullable
        expect(c.boundingSphere).not.toBeNull();
      }
    }
  });

  it('(b) emits a NON-ground type below MIN_CHUNK_INSTANCES as a single local-bounded cullable chunk', () => {
    const tree = makeMesh('PP_Tree_10', [
      [-9, -9], [9, 9], [0, 0], // 3 < MIN_CHUNK(4)
    ]);
    const scene = makeScene(tree);
    rebuildForestAsChunks(params({ scene }));

    expect(tree.parent).toBeNull(); // original island-wide mesh replaced
    const meshes = allInstanced(scene);
    expect(meshes).toHaveLength(1); // single chunk, not spatially partitioned
    expect(meshes[0].name).toMatch(/-chunk\d+$/);
    expect(meshes[0].frustumCulled).toBe(true); // cullable local bound
    expect(meshes[0].boundingSphere).not.toBeNull();
    expect(countInstances(scene)).toBe(3); // no instances lost, not thinned
  });

  it('(c) splits a dense tree type into >1 frustum-cullable chunk with LOCAL bounds', () => {
    const tree = makeMesh('PP_Rock_Moss_Grown_11', DENSE_CLUSTERS); // 16 ≥ MIN_CHUNK
    const scene = makeScene(tree);
    rebuildForestAsChunks(params({ scene }));

    expect(tree.parent).toBeNull(); // original island-wide mesh removed
    const chunks = allInstanced(scene);
    expect(chunks.length).toBeGreaterThan(1); // spatial partition happened
    for (const c of chunks) {
      expect(c.name).toMatch(/-chunk\d+$/);
      expect(c.frustumCulled).toBe(true); // default → off-screen chunks cull
      expect(c.boundingSphere).not.toBeNull(); // LOCAL bound computed
      expect(c.boundingSphere?.radius).toBeLessThan(12); // far smaller than the 24-unit island
    }
    expect(countInstances(scene)).toBe(DENSE_CLUSTERS.length); // no instances lost
  });

  it('(d) parity at keepFraction=1 loses no non-ground instances (thinning disabled)', () => {
    // All instances "far" (thinDistance tiny) — only keepFraction=1 preserves them.
    const tree = makeMesh('PP_Hyacinth_04', DENSE_CLUSTERS);
    const scene = makeScene(tree);
    rebuildForestAsChunks(params({ scene, thinDistance: 1, keepFraction: 1 }));
    expect(countInstances(scene)).toBe(DENSE_CLUSTERS.length);
  });

  it('(d2) thins the far non-ground ring when keepFraction<1', () => {
    // 4 near (kept) + 8 far (half kept) → 8 survive. Below-floor count stays single,
    // so bump total ≥ MIN_CHUNK by making it a chunkable spread.
    const near: [number, number][] = [[2, 0], [-2, 0], [0, 2], [0, -2]];
    const far: [number, number][] = [
      [10, 0], [-10, 0], [0, 10], [0, -10], [8, 8], [-8, 8], [8, -8], [-8, -8],
    ];
    const tree = makeMesh('PP_Daffodil_03', [...near, ...far]);
    const scene = makeScene(tree);
    rebuildForestAsChunks(params({ scene, thinDistance: 5, keepFraction: 0.5, mergeCellMin: 1 }));
    expect(countInstances(scene)).toBe(8); // 4 near + 4 of 8 far
  });

  it('(e) ground instance count is fully preserved regardless of aggressive thinning', () => {
    const groundSpread: [number, number][] = [];
    for (let x = -10; x <= 10; x += 4) for (let z = -10; z <= 10; z += 4) groundSpread.push([x, z]);
    const ground = makeMesh('PP_Grass_11', groundSpread);
    const tree = makeMesh('PP_Tree_02', DENSE_CLUSTERS);
    const scene = makeScene(ground, tree);

    rebuildForestAsChunks(params({ scene, keepFraction: 0.1, thinDistance: 1 }));

    // Ground fully preserved (never thinned), now emitted as local-bounded cullable chunk(s).
    expect(countMatching(scene, /Grass/)).toBe(groundSpread.length);
    expect(ground.parent).toBeNull(); // original replaced by chunk(s)
    const groundMeshes = allInstanced(scene).filter((im) => im.name.includes('Grass'));
    expect(groundMeshes.length).toBeGreaterThanOrEqual(1);
    for (const g of groundMeshes) {
      expect(g.name).toMatch(/-chunk\d+$/);
      expect(g.frustumCulled).toBe(true); // cullable
    }
  });

  it('(f) grid-splits a sparse NON-ground type (mountains) into small chunks instead of one island-wide chunk', () => {
    // 9 instances, one per distinct grid cell, count(9) ≥ MIN_CHUNK(4). With
    // MERGE_MIN(1) every occupied cell trivially clears the fold threshold (≥1
    // surviving instance), so the old "too-sparse → ONE island-wide fallback
    // chunk" path is no longer reachable this way — the type grid-splits into
    // one tight chunk per cell instead. This is the fix for real sparse types
    // (e.g. the Forest_Mountain_Moss_* types at 9-11 instances) that used to
    // fall back to a single chunk spanning the whole ~55-65u ring — a bound fat
    // enough to contain the camera and defeat frustum culling from any angle.
    const spread: [number, number][] = [];
    for (const x of [-9, -3, 3]) for (const z of [-9, -3, 3]) spread.push([x, z]);
    const mountain = makeMesh('Forest_Mountain_Moss_01', spread);
    const scene = makeScene(mountain);
    rebuildForestAsChunks(params({ scene })); // keepFraction defaults to 1 → nothing thinned

    expect(mountain.parent).toBeNull(); // original island-wide mesh replaced
    const chunks = allInstanced(scene);
    expect(chunks.length).toBeGreaterThan(1); // grid-split, NOT one giant fallback chunk
    for (const c of chunks) {
      expect(c.name).toMatch(/-chunk\d+$/);
      expect(c.frustumCulled).toBe(true); // local bound → cullable when off-screen
      expect(c.boundingSphere).not.toBeNull();
      // Tight per-cell bound, nowhere near the ~17-unit half-diagonal of the
      // 24-unit test box (the old fallback's bound would have spanned that).
      expect(c.boundingSphere?.radius).toBeLessThan(3);
    }
    expect(countInstances(scene)).toBe(spread.length); // all 9 preserved
  });

  it('(g) eligible relief chunks are born FULL-detail and tagged with {full, lod1, lod2} tiers', () => {
    // The chunker no longer picks an LOD geometry statically — the tier is chosen
    // per-frame by camera distance at runtime. So every chunk starts on the FULL
    // source geometry, and eligible relief chunks carry the pre-created tiers in
    // userData.forestLod for the runtime swap. Near/far no longer matters here.
    const near: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const far: [number, number][] = [[-10, -10], [-9, -9], [-10, -9], [-9, -10]];
    const tree = makeMesh('PP_Tree_10', [...near, ...far]);
    const fullGeom = tree.geometry;
    const lod1 = new THREE.BoxGeometry(2, 2, 2); // distinct references
    const lod2 = new THREE.BoxGeometry(3, 3, 3);
    const scene = makeScene(tree);
    rebuildForestAsChunks(
      params({
        scene,
        thinDistance: 5,
        keepFraction: 1, // no thinning → all 8 survive
        lodGeometry: new Map([['PP_Tree_10', { lod1, lod2 }]]),
      }),
    );

    const chunks = allInstanced(scene);
    expect(chunks.length).toBeGreaterThan(1); // near + far land in different cells
    expect(countInstances(scene)).toBe(8); // nothing lost

    for (const c of chunks) {
      expect(c.geometry).toBe(fullGeom); // BORN full-detail (runtime swaps the tier)
      const lod = chunkLod(c);
      expect(lod).not.toBeNull();
      expect(lod?.full).toBe(fullGeom);
      expect(lod?.lod1).toBe(lod1);
      expect(lod?.lod2).toBe(lod2);
    }
  });

  it('(g2) a type with NO LOD entry (e.g. ground/mountain) uses full geometry and carries no tiers', () => {
    // Ground/mountains are kept full and have no LOD siblings in forest.mobile.glb
    // → absent from the map → chunks must keep the source geometry and carry NO
    // forestLod tag (so the runtime loop leaves them full forever). Also re-confirms
    // ground is never thinned.
    const spread: [number, number][] = [];
    for (let x = -10; x <= 10; x += 4) for (let z = -10; z <= 10; z += 4) spread.push([x, z]);
    const ground = makeMesh('PP_Meadow_08', spread);
    const fullGeom = ground.geometry;
    const lod1 = new THREE.BoxGeometry(2, 2, 2);
    const lod2 = new THREE.BoxGeometry(3, 3, 3);
    const scene = makeScene(ground);
    rebuildForestAsChunks(
      params({
        scene,
        thinDistance: 3,
        keepFraction: 0.1,
        // Map has an entry for a DIFFERENT type; ground ("PP_Meadow_08") is absent.
        lodGeometry: new Map([['PP_Tree_10', { lod1, lod2 }]]),
      }),
    );

    const chunks = allInstanced(scene);
    expect(countInstances(scene)).toBe(spread.length); // ground never thinned
    for (const c of chunks) {
      expect(c.geometry).toBe(fullGeom); // no LOD entry → source geometry everywhere
      expect(chunkLod(c)).toBeNull(); // and NO tiers tagged → stays full at runtime
    }
  });

  it('(g3) with NO lodGeometry map, every chunk uses full geometry and carries no tiers (pre-LOD parity)', () => {
    const tree = makeMesh('PP_Tree_02', DENSE_CLUSTERS);
    const fullGeom = tree.geometry;
    const scene = makeScene(tree);
    rebuildForestAsChunks(params({ scene })); // no lodGeometry provided
    for (const c of allInstanced(scene)) {
      expect(c.geometry).toBe(fullGeom);
      expect(chunkLod(c)).toBeNull();
    }
  });

  it('(g4) ROCKS are excluded from LOD (no _LOD* siblings → absent from map → full geometry, no tiers) but ARE still chunked + thinned', () => {
    // gen-forest-mobile.mjs routes /rock/i to the "no _LOD*" branch, so rocks
    // never appear in the runtime lodGeometry map. The chunker is data-driven by
    // that PRESENCE, so a rock type with no map entry keeps full geometry forever
    // and carries no tiers — while still being chunked (local cullable bounds) and
    // far-ring thinned like any other non-ground relief type.
    const rock = makeMesh('PP_Rock_Moss_Grown_11', DENSE_CLUSTERS); // 16 ≥ MIN_CHUNK
    const fullGeom = rock.geometry;
    const treeLod1 = new THREE.BoxGeometry(2, 2, 2);
    const treeLod2 = new THREE.BoxGeometry(3, 3, 3);
    const scene = makeScene(rock);
    rebuildForestAsChunks(
      params({
        scene,
        thinDistance: 5,
        keepFraction: 0.5, // far ring thinned (rocks are NOT ground)
        // Map only carries a DIFFERENT type; the rock is absent (as in the real glb).
        lodGeometry: new Map([['PP_Tree_10', { lod1: treeLod1, lod2: treeLod2 }]]),
      }),
    );

    expect(rock.parent).toBeNull(); // original island-wide mesh replaced by chunks
    const chunks = allInstanced(scene);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.name).toMatch(/-chunk\d+$/);
      expect(c.frustumCulled).toBe(true); // still chunked + cullable
      expect(c.geometry).toBe(fullGeom); // full geometry (no LOD entry)
      expect(chunkLod(c)).toBeNull(); // NO tiers → stays full at runtime
    }
    // Far ring thinned (rocks are eligible for thinning even without LOD): the
    // 16 far instances (all beyond thinDistance=5) keep 1 of 2 → 8 survive.
    expect(countInstances(scene)).toBe(8);
  });

  it('(f2) the underlying "no cell clears the threshold" fallback still works with an explicit high mergeCellMin', () => {
    // Regression coverage for the fallback branch itself, independent of the
    // shipped default (1): with mergeCellMin explicitly raised back to the old
    // style threshold (3), these 9 one-instance-per-cell buckets never clear
    // it, so the type is still emitted as ONE local-bounded, cullable chunk of
    // ALL its instances rather than left island-wide. (With the shipped default
    // of 1 this branch is effectively unreachable via thinning alone, since the
    // first surviving instance of any type always occupies some cell — see (f)
    // for the shipped, grid-split behavior.)
    const spread: [number, number][] = [];
    for (const x of [-9, -3, 3]) for (const z of [-9, -3, 3]) spread.push([x, z]);
    const mountain = makeMesh('Forest_Mountain_Sparse_01', spread);
    const scene = makeScene(mountain);
    rebuildForestAsChunks(params({ scene, mergeCellMin: 3 }));

    expect(mountain.parent).toBeNull(); // never left island-wide
    const meshes = allInstanced(scene);
    expect(meshes).toHaveLength(1); // no cell (1 instance each) clears mergeCellMin(3)
    expect(meshes[0].name).toMatch(/-chunk\d+$/);
    expect(meshes[0].frustumCulled).toBe(true); // local bound → cullable when off-screen
    expect(meshes[0].boundingSphere).not.toBeNull();
    expect(countInstances(scene)).toBe(spread.length); // all 9 preserved — unthinned
  });

  it('(h) reorders a FOLIAGE chunk deterministically by position hash (same input → same order)', () => {
    // gridN=1 → every instance lands in one cell → ONE chunk holding all of them,
    // so we can read back the exact render order the reorder produced.
    const positions: [number, number][] = [];
    for (const x of [-9, -3, 3, 9]) for (const z of [-9, -3, 3, 9]) positions.push([x, z]); // 16 ≥ MIN_CHUNK
    const build = (): [number, number][] => {
      const tree = makeMesh('PP_Tree_10', positions);
      const scene = makeScene(tree);
      rebuildForestAsChunks(
        params({ scene, gridN: 1, keepFraction: 1, lodGeometry: foliageMap('PP_Tree_10') }),
      );
      const chunks = allInstanced(scene);
      expect(chunks).toHaveLength(1); // single cell → single chunk
      return chunkOrderXZ(chunks[0]);
    };

    const first = build();
    const second = build();
    expect(second).toEqual(first); // deterministic across rebuilds (no Math.random)
    expect(first).toHaveLength(positions.length); // ALL instances kept (dynamic reduction)

    // The render order is exactly the hash-sorted permutation of the positions.
    const perm = orderByPositionHash(positions.map(([x, z]) => ({ x, z })));
    const expected = perm.map((i) => positions[i]);
    expect(first).toEqual(expected);
    // …and it is a genuine REORDER (not identity) — the input is not hash-sorted.
    expect(first).not.toEqual(positions);
    // Reorder is a PERMUTATION: no instance dropped or duplicated.
    expect([...perm].sort((a, b) => a - b)).toEqual([...positions.keys()]);
  });

  it('(i) ANY PREFIX of a reordered FOLIAGE chunk is spatially SPREAD, not clustered in one cell', () => {
    // A 6×6 grid spanning four quadrants. A good white-noise hash makes any prefix
    // an even spatial sample, so a prefix of ~1/4 the instances must touch most
    // quadrants (never pile into one corner — the whole point for fog thinning).
    const positions: [number, number][] = [];
    for (const x of [-9, -6, -3, 3, 6, 9]) for (const z of [-9, -6, -3, 3, 6, 9]) positions.push([x, z]);
    const perm = orderByPositionHash(positions.map(([x, z]) => ({ x, z })));

    const quad = ([x, z]: [number, number]): string => `${Math.sign(x)},${Math.sign(z)}`;
    const prefixLen = 12; // ~1/3 of 36
    const prefix = perm.slice(0, prefixLen).map((i) => positions[i]);
    const counts = new Map<string, number>();
    for (const p of prefix) counts.set(quad(p), (counts.get(quad(p)) ?? 0) + 1);

    expect(counts.size).toBe(4); // all four quadrants represented in the prefix
    // No quadrant hogs the prefix (perfectly even = 3 each; allow slack).
    for (const c of counts.values()) expect(c).toBeLessThanOrEqual(6);
  });

  it('(j) GROUND and ROCK chunks are NOT reordered (reorder is foliage-only)', () => {
    // Neither type is in the lodGeometry map → not foliage → original order kept.
    const positions: [number, number][] = [];
    for (const x of [-9, -3, 3, 9]) for (const z of [-9, -3, 3, 9]) positions.push([x, z]);
    for (const name of ['PP_Grass_11', 'PP_Rock_Moss_Grown_11']) {
      const im = makeMesh(name, positions);
      const scene = makeScene(im);
      rebuildForestAsChunks(
        params({ scene, gridN: 1, keepFraction: 1, lodGeometry: foliageMap('PP_Tree_10') }),
      );
      const chunks = allInstanced(scene);
      expect(chunks).toHaveLength(1);
      expect(chunkOrderXZ(chunks[0])).toEqual(positions); // untouched insertion order
    }
  });
});

describe('selectForestLodTier (dynamic camera-distance LOD)', () => {
  // Mirrors the SHIPPED thresholds (ForestEnvironment LOD_DIST_1 / LOD_DIST_2 /
  // LOD_HYSTERESIS). RETUNED 7/14 → 6/20 for the NEAREST-EDGE metric: the call site
  // now feeds the camera→chunk-NEAREST-edge distance (max(0, centerDist − radius)),
  // not the CENTER, so a chunk stays MEDIUM (LOD1) while its nearest tree is within
  // 20u and drops to ultra-low LOD2 only once its NEAR edge passes 20u (deep in
  // fog). The selector itself is UNCHANGED — pure on the scalar `dist` (see the
  // metric-agnostic case below) — only the thresholds and the metric fed to it moved.
  const D1 = 6; // full <-> LOD1 threshold (nearest-edge units)
  const D2 = 20; // LOD1 <-> LOD2 threshold (nearest-edge units)
  const H = 1.5; // hysteresis dead-band

  it('picks near→full, mid→LOD1, far→LOD2 from a cold start (current tier 0)', () => {
    expect(selectForestLodTier(0, 4, D1, D2, H)).toBe(0); // well inside near band
    expect(selectForestLodTier(0, 13, D1, D2, H)).toBe(1); // between the thresholds
    expect(selectForestLodTier(0, 30, D1, D2, H)).toBe(2); // beyond the far threshold
  });

  it('applies hysteresis at the full<->LOD1 boundary (no flicker)', () => {
    // Sitting at full: must travel PAST D1 + H (7.5) before upgrading to LOD1.
    expect(selectForestLodTier(0, 7, D1, D2, H)).toBe(0); // 7 < 7.5 → stays full
    expect(selectForestLodTier(0, 8, D1, D2, H)).toBe(1); // 8 > 7.5 → LOD1
    // Sitting at LOD1: must travel PAST D1 - H (4.5) before downgrading to full.
    expect(selectForestLodTier(1, 5, D1, D2, H)).toBe(1); // 5 > 4.5 → stays LOD1
    expect(selectForestLodTier(1, 4, D1, D2, H)).toBe(0); // 4 < 4.5 → full
  });

  it('applies hysteresis at the LOD1<->LOD2 boundary (no flicker)', () => {
    // Edge D2 = 20, dead-band ±H → upgrade past 21.5, downgrade below 18.5.
    expect(selectForestLodTier(1, 21, D1, D2, H)).toBe(1); // 21 < 21.5 → stays LOD1
    expect(selectForestLodTier(1, 22, D1, D2, H)).toBe(2); // 22 > 21.5 → LOD2
    expect(selectForestLodTier(2, 19, D1, D2, H)).toBe(2); // 19 > 18.5 → stays LOD2
    expect(selectForestLodTier(2, 18, D1, D2, H)).toBe(1); // 18 < 18.5 → LOD1
  });

  it('resolves multi-tier jumps in a single call (teleporting camera)', () => {
    expect(selectForestLodTier(0, 100, D1, D2, H)).toBe(2); // full → LOD2 directly
    expect(selectForestLodTier(2, 0, D1, D2, H)).toBe(0); // LOD2 → full directly
  });

  it('is metric-agnostic (pure on `dist`) — the CALL SITE feeds NEAREST-EDGE, fixing faceted foreground', () => {
    // The selector never knew whether `dist` is a CENTER or an EDGE distance — it
    // is pure on the scalar. The ForestEnvironment call site changed from passing
    // centerDist to passing the chunk's NEAREST-edge distance
    // (max(0, centerDist − worldRadius)). This pins the exact behavioural gain for
    // one large chunk with near trees — the bug the user reported.
    const centerDist = 30; //   a big chunk whose CENTER is far …
    const worldRadius = 12; //  … but whose NEAREST edge is close (foreground trees!)
    const nearestEdge = Math.max(0, centerDist - worldRadius); // 18
    // OLD metric (centerDist) collapsed the ENTIRE chunk to faceted ultra-low LOD2:
    expect(selectForestLodTier(0, centerDist, D1, D2, H)).toBe(2);
    // NEW metric (nearest edge) keeps those near trees at MEDIUM LOD1 (~30%):
    expect(selectForestLodTier(0, nearestEdge, D1, D2, H)).toBe(1);
  });

  it('end-to-end: a tagged relief chunk resolves its geometry to the decimated tier at range', () => {
    // Reproduces the ForestEnvironment per-frame swap WITHOUT the React component:
    // the chunker tags `userData.forestLod = {full, lod1, lod2}`, the selector picks
    // a tier by camera distance, and the loop swaps `mesh.geometry` to that tier's
    // buffer. This asserts the whole wired pipeline reduces geometry at range — the
    // "hard proof it is NOT a no-op" the audit established, pinned as a regression.
    const tree = makeMesh('PP_Tree_10', [[-9, -9], [-8, -8], [-9, -8], [-8, -9]]);
    const lod1 = new THREE.BoxGeometry(2, 2, 2);
    const lod2 = new THREE.BoxGeometry(3, 3, 3);
    const scene = makeScene(tree);
    rebuildForestAsChunks(
      params({ scene, keepFraction: 1, lodGeometry: new Map([['PP_Tree_10', { lod1, lod2 }]]) }),
    );
    const chunk = allInstanced(scene)[0];
    const lod = chunkLod(chunk);
    if (!lod) throw new Error('expected the tree chunk to carry LOD tiers'); // narrows below

    // The exact tier→geometry expression the loop uses, at three camera distances.
    const geomForDist = (camDist: number): THREE.BufferGeometry => {
      const tier = selectForestLodTier(0, camDist, D1, D2, H);
      return tier === 0 ? lod.full : tier === 1 ? lod.lod1 : lod.lod2;
    };
    expect(geomForDist(4)).toBe(lod.full); // near → full detail
    expect(geomForDist(10)).toBe(lod1); // mid → LOD1 (~30%)
    expect(geomForDist(30)).toBe(lod2); // far → LOD2 (~5%), decimated buffer
  });
});

describe('horizontalNearestDistanceToBox (ring-cull metric)', () => {
  // A 4×4 world box centered at origin on the XZ plane (Y ignored).
  const BOX = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };

  it('returns 0 when the camera XZ is inside the box', () => {
    expect(horizontalNearestDistanceToBox(0, 0, BOX)).toBe(0);
    expect(horizontalNearestDistanceToBox(1.9, -1.9, BOX)).toBe(0); // still inside
  });

  it('measures the perpendicular gap to a face (axis-aligned approach)', () => {
    expect(horizontalNearestDistanceToBox(5, 0, BOX)).toBeCloseTo(3); // 5 - maxX(2)
    expect(horizontalNearestDistanceToBox(-5, 0, BOX)).toBeCloseTo(3); // minX(-2) - (-5)
    expect(horizontalNearestDistanceToBox(0, 6, BOX)).toBeCloseTo(4); // 6 - maxZ(2)
  });

  it('measures the corner (diagonal) gap when the camera clears the box on both axes', () => {
    // Nearest corner is (maxX, maxZ) = (2, 2); camera at (5, 6) → dx=3, dz=4 → 5.
    expect(horizontalNearestDistanceToBox(5, 6, BOX)).toBeCloseTo(5);
  });

  it('ignores Y entirely (a box is a footprint here)', () => {
    // Same XZ query regardless of how the box is described — no Y field exists.
    expect(horizontalNearestDistanceToBox(5, 6, BOX)).toBeCloseTo(5);
  });

  it('crosses the ship FOG_FAR×1.27 cutoff exactly where expected', () => {
    // A chunk footprint whose nearest edge sits at horizontal 66 (FOREST_CULL_DISTANCE)
    // is right at the cull boundary; one just inside stays, one just outside culls.
    const far = { minX: 66, maxX: 80, minZ: -5, maxZ: 5 };
    expect(horizontalNearestDistanceToBox(0, 0, far)).toBeCloseTo(66);
    expect(horizontalNearestDistanceToBox(4, 0, far)).toBeCloseTo(62); // camera moved in → inside ring
  });
});

describe('selectForestDensityTier (dynamic camera-distance foliage density)', () => {
  // Mirrors the SHIPPED bands (ForestEnvironment DENSITY_BAND_DISTS / _HYSTERESIS):
  // FOUR bands split by three ASCENDING euclidean cam→center edges, ±2 hysteresis.
  // These are LIVE-CAMERA distances (the camera is free/movable) so the fog rings
  // track the camera. The edges are PUSHED PAST the fog onset (see the fog-metric
  // regression block below) — they are NOT the raw FOG_NEAR/FOG_FAR values.
  const DISTS = [36, 48, 58] as const; // near | near-fog | fog | deep edges
  const H = 2; // hysteresis dead-band

  it('picks band 0/1/2/3 across the four bands from a cold start (current 0)', () => {
    expect(selectForestDensityTier(0, 10, DISTS, H)).toBe(0); // foreground
    expect(selectForestDensityTier(0, 40, DISTS, H)).toBe(1); // near-fog
    expect(selectForestDensityTier(0, 52, DISTS, H)).toBe(2); // fog ring
    expect(selectForestDensityTier(0, 70, DISTS, H)).toBe(3); // deep fog
  });

  it('treats the -1 "not yet applied" sentinel as band 0 (first tick resolves the real band)', () => {
    expect(selectForestDensityTier(-1, 10, DISTS, H)).toBe(0); // near
    expect(selectForestDensityTier(-1, 70, DISTS, H)).toBe(3); // walks up from 0 to deep
  });

  it('applies hysteresis at the band-0<->1 boundary (edge 36, no flicker)', () => {
    expect(selectForestDensityTier(0, 37, DISTS, H)).toBe(0); // 37 < 38 → stays 0
    expect(selectForestDensityTier(0, 39, DISTS, H)).toBe(1); // 39 > 38 → band 1
    expect(selectForestDensityTier(1, 35, DISTS, H)).toBe(1); // 35 > 34 → stays 1
    expect(selectForestDensityTier(1, 33, DISTS, H)).toBe(0); // 33 < 34 → band 0
  });

  it('applies hysteresis at the band-1<->2 boundary (edge 48, no flicker)', () => {
    expect(selectForestDensityTier(1, 49, DISTS, H)).toBe(1); // 49 < 50 → stays 1
    expect(selectForestDensityTier(1, 51, DISTS, H)).toBe(2); // 51 > 50 → band 2
    expect(selectForestDensityTier(2, 47, DISTS, H)).toBe(2); // 47 > 46 → stays 2
    expect(selectForestDensityTier(2, 45, DISTS, H)).toBe(1); // 45 < 46 → band 1
  });

  it('applies hysteresis at the band-2<->3 boundary (edge 58, no flicker)', () => {
    expect(selectForestDensityTier(2, 59, DISTS, H)).toBe(2); // 59 < 60 → stays 2
    expect(selectForestDensityTier(2, 61, DISTS, H)).toBe(3); // 61 > 60 → band 3
    expect(selectForestDensityTier(3, 57, DISTS, H)).toBe(3); // 57 > 56 → stays 3
    expect(selectForestDensityTier(3, 55, DISTS, H)).toBe(2); // 55 < 56 → band 2
  });

  it('resolves multi-band jumps in a single call (teleporting/panning camera)', () => {
    expect(selectForestDensityTier(0, 200, DISTS, H)).toBe(3); // near → deep directly
    expect(selectForestDensityTier(3, 0, DISTS, H)).toBe(0); // deep → near directly
  });

  it('clamps a stale current band above the max back into range (no OOB walk)', () => {
    expect(selectForestDensityTier(99, 70, DISTS, H)).toBe(3); // stays deepest
    expect(selectForestDensityTier(99, 0, DISTS, H)).toBe(0); // densifies to near
  });

  it('is data-driven in the band count (a 2-edge / 3-band config still works)', () => {
    // The signature does NOT hardcode four bands — fewer edges ⇒ fewer bands. This
    // is what let the near→fog step be SPLIT (finding 1) with no signature change.
    const twoEdges = [20, 40] as const;
    expect(selectForestDensityTier(0, 10, twoEdges, H)).toBe(0);
    expect(selectForestDensityTier(0, 30, twoEdges, H)).toBe(1);
    expect(selectForestDensityTier(0, 50, twoEdges, H)).toBe(2);
  });
});

describe('densityKeepForTier + chunk.count truncation math', () => {
  // Mirrors the SHIPPED keep-fractions (ForestEnvironment DENSITY_BAND_KEEPS),
  // nearest-first: near / near-fog / fog / deep-fog.
  const KEEPS = [0.65, 0.42, 0.22, 0.1] as const;

  it('maps each density band to its keep-fraction', () => {
    expect(densityKeepForTier(0, KEEPS)).toBe(0.65);
    expect(densityKeepForTier(1, KEEPS)).toBe(0.42);
    expect(densityKeepForTier(2, KEEPS)).toBe(0.22);
    expect(densityKeepForTier(3, KEEPS)).toBe(0.1);
  });

  it('clamps an out-of-range band index to the array bounds', () => {
    expect(densityKeepForTier(-1, KEEPS)).toBe(0.65); // sentinel / underflow → nearest
    expect(densityKeepForTier(99, KEEPS)).toBe(0.1); // overflow → deepest
  });

  it('count = round(fullCount * keep) — incl. the "50 flowers in fog → show ~10" case', () => {
    // The exact expression the per-frame loop writes to chunk.count.
    const count = (full: number, tier: number): number =>
      Math.round(full * densityKeepForTier(tier, KEEPS));
    expect(count(50, 2)).toBe(11); // 50 * 0.22 = 11 (~10, matches the art direction)
    expect(count(50, 3)).toBe(5); // 50 * 0.10 = 5 (deep fog, even fewer)
    expect(count(100, 0)).toBe(65); // 100 * 0.65 = 65 (foreground global reduction)
    expect(count(50, 1)).toBe(21); // 50 * 0.42 = 21 (near-fog, the gentle first cut)
    expect(count(0, 2)).toBe(0); // empty chunk stays empty
  });
});

describe('foliage density bands hide their steps behind fog (finding-1 regression)', () => {
  // THE BUG (finding 1): the single largest density cut (0.65→0.18, 3.6×) fired at
  // ≈FOG_NEAR where linear fog opacity is exactly 0 (CLEAR AIR), because (a) the
  // near edge equalled FOG_NEAR and (b) density measures EUCLIDEAN cam→center
  // distance while fog measures VIEW-SPACE DEPTH (fogDepth ≈ 0.8 × distance). The
  // fix pushes the edges into fog-opaque space (mirroring the ring cull's
  // FOG_FAR×1.27 correction) AND splits the one big cut into gentle steps. These
  // asserts pin BOTH so the visible thinning pop cannot silently return.
  const DISTS = [36, 48, 58] as const; // shipped DENSITY_BAND_DISTS
  const KEEPS = [0.65, 0.42, 0.22, 0.1] as const; // shipped DENSITY_BAND_KEEPS
  // GameScene fog band + the file's established view-space-depth ratio.
  const FOG_NEAR = 24;
  const FOG_FAR = 52;
  const FOG_DEPTH_RATIO = 0.8; // fogDepth ≈ 0.8 × euclidean cam→center distance
  const fogOpacity = (dist: number): number => {
    const depth = FOG_DEPTH_RATIO * dist;
    return Math.min(1, Math.max(0, (depth - FOG_NEAR) / (FOG_FAR - FOG_NEAR)));
  };

  it('never fires the first step at the fog onset (near edge is past FOG_NEAR)', () => {
    expect(DISTS[0]).toBeGreaterThan(FOG_NEAR); // 36 > 24 — no longer the onset
    expect(fogOpacity(DISTS[0])).toBeGreaterThan(0); // there IS haze at the first cut
  });

  it('keeps every step gentler than the old 3.6× cliff, monotonically thinning', () => {
    const oldCliff = 0.65 / 0.18; // ≈ 3.6× — the single cut the finding flagged
    for (let i = 1; i < KEEPS.length; i++) {
      const ratio = KEEPS[i - 1] / KEEPS[i];
      expect(ratio).toBeGreaterThan(1); // a real cut (density strictly decreases)
      expect(ratio).toBeLessThan(2.4); // each cut ≤ ~2.2×, far below the old cliff
      expect(ratio).toBeLessThan(oldCliff);
    }
  });

  it('places progressively LARGER cuts at progressively HIGHER fog opacity', () => {
    const [o0, o1, o2] = DISTS.map(fogOpacity);
    expect(o1).toBeGreaterThan(o0); // fog opacity strictly increases across edges
    expect(o2).toBeGreaterThan(o1);
    const step0 = KEEPS[0] / KEEPS[1];
    const step1 = KEEPS[1] / KEEPS[2];
    const step2 = KEEPS[2] / KEEPS[3];
    expect(step1).toBeGreaterThan(step0); // steps grow as we go deeper …
    expect(step2).toBeGreaterThan(step1);
    expect(o2).toBeGreaterThan(0.7); // … so the BIGGEST cut is ≥70% hazed to sky
  });
});

describe('hashInstancePosition + orderByPositionHash (deterministic spatial reorder)', () => {
  it('is deterministic and in [0,1) — same position always maps to the same value', () => {
    for (const [x, z] of [[0, 0], [-9, 9], [1234.5, -678.25], [16000, -16000]] as [number, number][]) {
      const h = hashInstancePosition(x, z);
      expect(h).toBe(hashInstancePosition(x, z)); // stable (no Math.random)
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('gives UNCORRELATED values to neighbouring positions (white-noise ordering)', () => {
    // Adjacent quantized cells must NOT produce near-equal hashes, else prefixes
    // would cluster. Sample a small neighbourhood and assert the spread is wide.
    const vals: number[] = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) vals.push(hashInstancePosition(x, z));
    const uniq = new Set(vals);
    expect(uniq.size).toBe(vals.length); // all distinct
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.5); // wide spread
  });

  it('orderByPositionHash returns a full permutation, tie-broken by index for determinism', () => {
    const positions = [
      { x: 3, z: 7 },
      { x: -4, z: 1 },
      { x: 9, z: -2 },
      { x: 0, z: 0 },
      { x: -8, z: -8 },
    ];
    const perm = orderByPositionHash(positions);
    expect([...perm].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]); // permutation of all indices
    expect(orderByPositionHash(positions)).toEqual(perm); // deterministic

    // Identical positions (hash tie) keep ASCENDING index order (stable tiebreak).
    const dupes = [{ x: 5, z: 5 }, { x: 5, z: 5 }, { x: 5, z: 5 }];
    expect(orderByPositionHash(dupes)).toEqual([0, 1, 2]);
  });
});
