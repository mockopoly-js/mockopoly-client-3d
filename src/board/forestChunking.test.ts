import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { rebuildForestAsChunks, isForestGroundMesh } from './forestChunking';

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

  it('(g) FAR relief chunks use the *_LOD geometry while NEAR chunks keep full geometry', () => {
    // A near cluster (within thinDistance, at the center cell) and a far cluster
    // (beyond thinDistance, at a corner cell) of the SAME relief type. With a
    // lodGeometry entry for that type, the near chunk must keep the source
    // (full) geometry and the far chunk must swap to the decimated LOD geometry.
    const near: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]]; // dist ~0-1.4 (< 5)
    const far: [number, number][] = [[-10, -10], [-9, -9], [-10, -9], [-9, -10]]; // dist ~13 (> 5)
    const tree = makeMesh('PP_Tree_10', [...near, ...far]);
    const fullGeom = tree.geometry;
    const lodGeom = new THREE.BoxGeometry(2, 2, 2); // distinct geometry reference
    const scene = makeScene(tree);
    rebuildForestAsChunks(
      params({
        scene,
        thinDistance: 5,
        keepFraction: 1, // no thinning → all 8 survive; isolate the LOD-geometry choice
        lodGeometry: new Map([['PP_Tree_10', lodGeom]]),
      }),
    );

    const chunks = allInstanced(scene);
    expect(chunks.length).toBeGreaterThan(1); // near + far land in different cells
    expect(countInstances(scene)).toBe(8); // nothing lost

    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let sawNearFull = false;
    let sawFarLod = false;
    for (const c of chunks) {
      c.getMatrixAt(0, m);
      p.setFromMatrixPosition(m);
      const isFar = p.x * p.x + p.z * p.z > 25; // thinDistance^2 = 25
      if (isFar) {
        expect(c.geometry).toBe(lodGeom); // FAR → decimated LOD geometry
        sawFarLod = true;
      } else {
        expect(c.geometry).toBe(fullGeom); // NEAR → full geometry
        sawNearFull = true;
      }
    }
    expect(sawNearFull).toBe(true);
    expect(sawFarLod).toBe(true);
  });

  it('(g2) a type with NO *_LOD entry (e.g. decimated ground) uses full geometry even when far', () => {
    // Ground is decimated to a single geometry in forest.mobile.glb and has no
    // LOD sibling → its far chunks must fall back to the source geometry, never
    // a missing/other LOD. Also re-confirms ground is never thinned.
    const spread: [number, number][] = [];
    for (let x = -10; x <= 10; x += 4) for (let z = -10; z <= 10; z += 4) spread.push([x, z]);
    const ground = makeMesh('PP_Meadow_08', spread);
    const fullGeom = ground.geometry;
    const lodGeom = new THREE.BoxGeometry(2, 2, 2);
    const scene = makeScene(ground);
    rebuildForestAsChunks(
      params({
        scene,
        thinDistance: 3,
        keepFraction: 0.1,
        // Map has an entry for a DIFFERENT type; ground ("PP_Meadow_08") is absent.
        lodGeometry: new Map([['PP_Tree_10', lodGeom]]),
      }),
    );

    const chunks = allInstanced(scene);
    expect(countInstances(scene)).toBe(spread.length); // ground never thinned
    for (const c of chunks) {
      expect(c.geometry).toBe(fullGeom); // no LOD entry → source geometry everywhere
    }
  });

  it('(g3) with NO lodGeometry map, every chunk uses full geometry (pre-LOD parity)', () => {
    const tree = makeMesh('PP_Tree_02', DENSE_CLUSTERS);
    const fullGeom = tree.geometry;
    const scene = makeScene(tree);
    rebuildForestAsChunks(params({ scene })); // no lodGeometry provided
    for (const c of allInstanced(scene)) expect(c.geometry).toBe(fullGeom);
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
});
