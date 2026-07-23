import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FACE_NORMAL, resolveQuaternion } from './dice-orientation';

const VALUES = [1, 2, 3, 4, 5, 6];
const EPS = 1e-6;

describe('dice-orientation', () => {
  it('has a normal for every value 1–6', () => {
    for (const v of VALUES) expect(FACE_NORMAL[v]).toBeDefined();
  });

  it('normals are unit-length', () => {
    for (const v of VALUES) {
      const n = new THREE.Vector3(...FACE_NORMAL[v]);
      expect(n.length()).toBeCloseTo(1, 12);
    }
  });

  it('normals are axis-aligned (exactly one non-zero ±1 component)', () => {
    for (const v of VALUES) {
      const c = FACE_NORMAL[v];
      const nonZero = c.filter((x) => x !== 0);
      expect(nonZero).toHaveLength(1);
      expect(Math.abs(nonZero[0])).toBe(1);
    }
  });

  it('all 6 normals are distinct', () => {
    const keys = new Set(VALUES.map((v) => FACE_NORMAL[v].join(',')));
    expect(keys.size).toBe(6);
  });

  it('opposite faces sum to 7 (their normals are negatives)', () => {
    const pairs: [number, number][] = [
      [1, 6],
      [2, 5],
      [3, 4],
    ];
    for (const [a, b] of pairs) {
      expect(a + b).toBe(7);
      const na = FACE_NORMAL[a];
      const nb = FACE_NORMAL[b];
      // Component-wise numeric compare (== treats -0 and 0 as equal).
      expect(nb[0] === -na[0]).toBe(true);
      expect(nb[1] === -na[1]).toBe(true);
      expect(nb[2] === -na[2]).toBe(true);
    }
  });

  it('resolveQuaternion(v) rotates FACE_NORMAL[v] to (0,1,0) within 1e-6', () => {
    for (const v of VALUES) {
      const q = resolveQuaternion(v);
      const result = new THREE.Vector3(...FACE_NORMAL[v]).applyQuaternion(q);
      expect(result.x).toBeCloseTo(0, 6);
      expect(result.y).toBeCloseTo(1, 6);
      expect(result.z).toBeCloseTo(0, 6);
      expect(Math.abs(result.x)).toBeLessThan(EPS);
      expect(Math.abs(result.y - 1)).toBeLessThan(EPS);
      expect(Math.abs(result.z)).toBeLessThan(EPS);
    }
  });
});
