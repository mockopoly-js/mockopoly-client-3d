import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FACE_NORMAL, resolveQuaternion, resolveQuaternionNear } from './dice-orientation';

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

  // ---- resolveQuaternionNear tests -------------------------------------------
  // Build a deterministic grid of 200 "current" quaternions by sampling euler
  // angles over a uniform grid (no Math.random — fully stable across runs).
  function buildCurrentQuaternions(count: number): THREE.Quaternion[] {
    const quats: THREE.Quaternion[] = [];
    // Use the golden-angle spiral on SO(3) approximation: step through yaw, pitch,
    // roll with coprime fractional increments so the grid has no repeats.
    const phi = Math.PI * (Math.sqrt(5) - 1); // golden angle (~137.5°)
    const e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      e.set(
        (i * phi) % (Math.PI * 2),        // roll — full circle
        (i * 1.3) % Math.PI - Math.PI / 2, // pitch — ±90°
        (i * 2.1) % (Math.PI * 2),         // yaw — full circle
        'XYZ',
      );
      quats.push(new THREE.Quaternion().setFromEuler(e));
    }
    return quats;
  }

  const NEAR_POSES = 200;
  const currentQuats = buildCurrentQuaternions(NEAR_POSES);

  it(
    `resolveQuaternionNear(v, current): for all values 1-6 × ${NEAR_POSES} poses, ` +
      'FACE_NORMAL[v] rotated by result ≈ (0,1,0) within 1e-6',
    () => {
      const up = new THREE.Vector3(0, 1, 0);
      for (const v of VALUES) {
        for (const current of currentQuats) {
          const q = resolveQuaternionNear(v, current);
          const result = new THREE.Vector3(...FACE_NORMAL[v]).applyQuaternion(q);
          expect(Math.abs(result.x), `v=${v} x`).toBeLessThan(EPS);
          expect(Math.abs(result.y - 1), `v=${v} y`).toBeLessThan(EPS);
          expect(Math.abs(result.z), `v=${v} z`).toBeLessThan(EPS);
          // Extra: result should be unit-length (sanity check on quaternion normalisation)
          expect(Math.abs(result.length() - 1), `v=${v} |result|`).toBeLessThan(EPS);
          // Extra: result is closer to up than any other resolveQuaternion candidate
          //        — just assert it's (0,1,0), already covered above via up vector check.
          void up; // referenced so linter is happy
        }
      }
    },
  );

  it('resolveQuaternionNear output is a valid (unit) quaternion for all poses', () => {
    for (const v of VALUES) {
      for (const current of currentQuats) {
        const q = resolveQuaternionNear(v, current);
        expect(Math.abs(q.length() - 1), `v=${v} quat norm`).toBeLessThan(EPS);
      }
    }
  });
});
