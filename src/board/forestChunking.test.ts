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
const MIN_CHUNK = 8;
const MERGE_MIN = 3;

/** Base params for a chunk build over the 24-unit box; override per test. */
function params(over: Partial<Parameters<typeof rebuildForestAsChunks>[0]>) {
  return {
    scene: new THREE.Group(),
    boxMin: BOX_MIN,
    size: SIZE,
    center: CENTER,
    groupScale: 1,
    gridN: 4,
    thinDistance: 30,
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
  it('(a) leaves GROUND/FLOOR types untouched: not chunked, not thinned', () => {
    // Every ground-named type: a dense spread with FAR instances + aggressive thinning.
    for (const name of ['PP_Meadow_08', 'PP_Grass_11', 'PP_Meadow_Path_05', 'PP_Lake_Ground_04']) {
      const spread: [number, number][] = [];
      for (let x = -10; x <= 10; x += 2) for (let z = -10; z <= 10; z += 2) spread.push([x, z]);
      const ground = makeMesh(name, spread);
      const scene = makeScene(ground);
      rebuildForestAsChunks(params({ scene, keepFraction: 0.25, thinDistance: 3 }));

      const meshes = allInstanced(scene);
      expect(meshes).toHaveLength(1); // NOT split into chunks
      expect(meshes[0]).toBe(ground); // same object, left in place
      expect(ground.parent).not.toBeNull();
      expect(ground.count).toBe(spread.length); // NOT thinned
      expect(meshes[0].name).not.toMatch(/-chunk/); // no chunk was emitted
    }
  });

  it('(b) leaves a tree type below MIN_CHUNK_INSTANCES as a single island-wide mesh', () => {
    const tree = makeMesh('PP_Tree_10', [
      [-9, -9], [9, 9], [-9, 9], [9, -9], [0, 0], // 5 < MIN_CHUNK(8)
    ]);
    const scene = makeScene(tree);
    rebuildForestAsChunks(params({ scene }));

    const meshes = allInstanced(scene);
    expect(meshes).toHaveLength(1);
    expect(meshes[0]).toBe(tree); // untouched original
    expect(tree.parent).not.toBeNull();
    expect(countInstances(scene)).toBe(5);
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

    // Ground fully preserved (never thinned), still one un-chunked mesh.
    expect(countMatching(scene, /Grass/)).toBe(groundSpread.length);
    const groundMeshes = allInstanced(scene).filter((im) => im.name.includes('Grass'));
    expect(groundMeshes).toHaveLength(1);
    expect(groundMeshes[0]).toBe(ground);
  });
});
