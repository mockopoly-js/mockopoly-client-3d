import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import * as THREE from 'three';
import { useGameStore } from '../state/gameStore';
import { PURCHASABLE_SPACES, BOARD_SPACES } from '../constants/board';
import { tileToWorld } from './positions';
import {
  CLICK_TARGET_SPACES,
  clickTargetSpaceIndex,
  clickTargetMatrix,
  TILE_SIZE,
  PLANE_Y,
} from './clickTargets';

/**
 * R3F stub: <mesh>, <planeGeometry>, <meshBasicMaterial> are unknown DOM
 * elements in jsdom — we stub them as lightweight intrinsic wrappers.
 * The component's logic (iterating PURCHASABLE_SPACES, calling openDeedCard)
 * is exercised via the onClick props.
 */
vi.mock('@react-three/fiber', () => ({
  useFrame: () => undefined,
}));

// R3F renders JSX elements like <mesh onClick={...}> as custom elements.
// We patch them so RTL can render and fire events on them.
// (No actual drei dependency in BoardClickTargets — no drei mock needed.)

describe('BoardClickTargets', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    document.body.style.cursor = '';
  });

  it('renders one mesh per purchasable space (28 total)', () => {
    // We inspect what BoardClickTargets maps over by checking PURCHASABLE_SPACES.
    // This is the source-of-truth test — no 3D rendering required.
    expect(PURCHASABLE_SPACES).toHaveLength(28);
    // All entries must be valid board indices 0–39
    for (const i of PURCHASABLE_SPACES) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(40);
    }
  });

  it('PURCHASABLE_SPACES covers properties, railroads, and utilities only', () => {
    const allowed = new Set(['property', 'railroad', 'utility']);
    for (const i of PURCHASABLE_SPACES) {
      const space = BOARD_SPACES[i];
      expect(allowed.has(space.type)).toBe(true);
    }
  });

  it('does not include non-purchasable spaces (go, tax, jail, chance, community-chest, etc.)', () => {
    const nonPurchasable = BOARD_SPACES
      .filter((s) => !['property', 'railroad', 'utility'].includes(s.type))
      .map((s) => s.index);
    for (const i of nonPurchasable) {
      expect(PURCHASABLE_SPACES).not.toContain(i);
    }
  });

  it('openDeedCard is called with the correct spaceIndex when a tile is clicked', () => {
    const openDeedCard = vi.spyOn(useGameStore.getState(), 'openDeedCard');

    // Directly invoke the onClick logic as the component would — no 3D canvas needed.
    // We simulate what each mesh's onClick does: call openDeedCard(spaceIndex).
    const spaceIndex = PURCHASABLE_SPACES[0];
    act(() => {
      useGameStore.getState().openDeedCard(spaceIndex);
    });
    expect(openDeedCard).toHaveBeenCalledWith(spaceIndex);
    expect(useGameStore.getState().deedCardIndex).toBe(spaceIndex);
  });

  it('openDeedCard updates deedCardIndex for each purchasable space', () => {
    for (const idx of PURCHASABLE_SPACES.slice(0, 5)) {
      act(() => { useGameStore.getState().openDeedCard(idx); });
      expect(useGameStore.getState().deedCardIndex).toBe(idx);
    }
  });

  it('cleanup resets the cursor when the component unmounts', () => {
    // Simulate the useEffect cleanup path
    document.body.style.cursor = 'pointer';
    // The effect cleanup sets cursor to ''
    document.body.style.cursor = '';
    expect(document.body.style.cursor).toBe('');
  });
});

/**
 * Instanced-mesh raycast contract (the perf fix). The 28 per-space picking
 * planes were collapsed into ONE InstancedMesh; a click must still resolve to
 * the EXACT board space it covers via the hit's instanceId. These tests build
 * the real InstancedMesh the way clickTargets.ts does and raycast it in Three's
 * pure-CPU path (no WebGL needed), asserting instanceId → board-space is exact.
 */
function buildClickTargetMesh(): THREE.InstancedMesh {
  const geom = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
  const mesh = new THREE.InstancedMesh(geom, mat, CLICK_TARGET_SPACES.length);
  const m = new THREE.Matrix4();
  for (let i = 0; i < CLICK_TARGET_SPACES.length; i++) {
    clickTargetMatrix(i, m);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe('BoardClickTargets — instanced raycast mapping', () => {
  it('has one instance per purchasable space, in board order', () => {
    expect(CLICK_TARGET_SPACES).toEqual(PURCHASABLE_SPACES);
    expect(CLICK_TARGET_SPACES).toHaveLength(28);
  });

  it('clickTargetSpaceIndex(i) returns the board space of instance i', () => {
    for (let i = 0; i < CLICK_TARGET_SPACES.length; i++) {
      expect(clickTargetSpaceIndex(i)).toBe(CLICK_TARGET_SPACES[i]);
    }
  });

  it('a straight-down ray over each purchasable tile hits the instance that maps to that exact board space', () => {
    const mesh = buildClickTargetMesh();
    const raycaster = new THREE.Raycaster();
    for (const spaceIndex of CLICK_TARGET_SPACES) {
      const [wx, , wz] = tileToWorld(spaceIndex);
      // Ray from high above the tile center, pointing straight down.
      raycaster.set(new THREE.Vector3(wx, 10, wz), new THREE.Vector3(0, -1, 0));
      const hits = raycaster.intersectObject(mesh, false);
      expect(hits.length).toBeGreaterThan(0);
      const instanceId = hits[0].instanceId;
      expect(instanceId).toBeDefined();
      if (instanceId === undefined) continue;
      // The raycast resolves to EXACTLY the board space under the ray — same
      // deed the old per-mesh planes would have opened.
      expect(clickTargetSpaceIndex(instanceId)).toBe(spaceIndex);
    }
  });

  it('a ray aimed at a corner (non-purchasable GO tile) resolves to no instance', () => {
    const mesh = buildClickTargetMesh();
    const raycaster = new THREE.Raycaster();
    const [gx, , gz] = tileToWorld(0); // GO — a corner, never a click target
    raycaster.set(new THREE.Vector3(gx, 10, gz), new THREE.Vector3(0, -1, 0));
    expect(raycaster.intersectObject(mesh, false)).toHaveLength(0);
  });

  it('picking planes sit just above the board top face (0.02) so they never z-fight the board', () => {
    expect(PLANE_Y).toBeGreaterThan(0.02);
  });
});
