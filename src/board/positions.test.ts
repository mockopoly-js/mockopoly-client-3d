import { describe, it, expect } from 'vitest';
import {
  SPACE_POSITIONS,
  tileToWorld,
  tileToWorldRotated,
  buildTilePath,
  BOARD_WORLD_SIZE,
  thirdPersonPose,
  thirdPersonPoseAt,
  THIRD_PERSON_DIST,
  THIRD_PERSON_HEIGHT,
  THIRD_PERSON_TARGET_Y,
} from './positions';
import * as THREE from 'three';

describe('SPACE_POSITIONS', () => {
  it('has 40 tiles', () => {
    expect(SPACE_POSITIONS).toHaveLength(40);
  });
  it('places the four corners correctly', () => {
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    // GO bottom-right, Jail bottom-left, Free Parking top-left, GoToJail top-right
    expect(near(SPACE_POSITIONS[0].x, SPACE_POSITIONS[0].y)).toBe(true); // (CE,CE)
    expect(SPACE_POSITIONS[0].x).toBeGreaterThan(0.9);
    expect(SPACE_POSITIONS[10].x).toBeLessThan(0.1);   // (CC,CE)
    expect(SPACE_POSITIONS[10].y).toBeGreaterThan(0.9);
    expect(SPACE_POSITIONS[20].x).toBeLessThan(0.1);   // (CC,CC)
    expect(SPACE_POSITIONS[20].y).toBeLessThan(0.1);
    expect(SPACE_POSITIONS[30].x).toBeGreaterThan(0.9); // (CE,CC)
    expect(SPACE_POSITIONS[30].y).toBeLessThan(0.1);
  });
  it('all tiles are within the unit square', () => {
    for (const p of SPACE_POSITIONS) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
  it('tileToWorld centers the board at the origin plane', () => {
    const [x, y, z] = tileToWorld(20); // top-left corner → negative x, negative z
    expect(y).toBe(0);
    expect(x).toBeCloseTo((SPACE_POSITIONS[20].x - 0.5) * BOARD_WORLD_SIZE, 6);
    expect(z).toBeCloseTo((SPACE_POSITIONS[20].y - 0.5) * BOARD_WORLD_SIZE, 6);
  });
});

describe('buildTilePath', () => {
  it('includes both endpoints for a single-step move (adjacent tiles)', () => {
    // from → from+1: two vertices, so the walk polyline has exactly one segment.
    expect(buildTilePath(5, 6)).toEqual([5, 6]);
  });
  it('lists from..to inclusive for a straight-line multi-tile move', () => {
    expect(buildTilePath(12, 20)).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
  it('wraps past GO (38 → 2 goes 38,39,0,1,2 — never cuts across)', () => {
    expect(buildTilePath(38, 2)).toEqual([38, 39, 0, 1, 2]);
  });
  it('is one longer than hopPath (includes the start vertex)', () => {
    // 5-space move → 6 vertices (5 segments).
    expect(buildTilePath(0, 5)).toHaveLength(6);
    expect(buildTilePath(37, 4)).toEqual([37, 38, 39, 0, 1, 2, 3, 4]);
  });
  it('returns a single vertex (no movement) when from === to', () => {
    expect(buildTilePath(7, 7)).toEqual([7]);
  });
  it('a full lap is expressible via distinct wrap endpoints (39 → 38 = whole ring)', () => {
    const lap = buildTilePath(39, 38);
    expect(lap[0]).toBe(39);
    expect(lap[lap.length - 1]).toBe(38);
    expect(lap).toHaveLength(40); // 39,0,1,…,38 — every tile exactly once
    expect(new Set(lap).size).toBe(40);
  });
  it('normalizes out-of-range / negative indices', () => {
    expect(buildTilePath(40, 42)).toEqual([0, 1, 2]);
    expect(buildTilePath(-1, 1)).toEqual([39, 0, 1]);
  });

  // ── Backward (counter-clockwise) walks — "Go back N spaces" cards ────────────
  it('walks BACKWARD (counter-clockwise) when backward=true', () => {
    // "Go back 3 spaces" from 7 → 4: 3 tiles the short way, NOT 37 the long way.
    expect(buildTilePath(7, 4, true)).toEqual([7, 6, 5, 4]);
  });
  it('backward walk wraps 0 → 39 (never cuts across)', () => {
    // from 1 back to 38: 1,0,39,38 — rounds the GO corner counter-clockwise.
    expect(buildTilePath(1, 38, true)).toEqual([1, 0, 39, 38]);
  });
  it('backward step count equals the actual spaces moved (timing parity)', () => {
    // 7→4 backward is 3 segments (4 vertices) → matches the server's 3-space move
    // gate, unlike the 37-segment clockwise path (38 vertices) the un-directed
    // helper would return, which is what caused the mid-walk snap.
    expect(buildTilePath(7, 4, true)).toHaveLength(4);  // 3 segments
    expect(buildTilePath(7, 4)).toHaveLength(38);        // forward = 37 segments (the bug)
  });
  it('from === to is a no-op single vertex regardless of direction', () => {
    expect(buildTilePath(7, 7, true)).toEqual([7]);
    expect(buildTilePath(7, 7, false)).toEqual([7]);
  });
  it('forward direction is unchanged when backward is omitted or false', () => {
    // Regression guard: default and explicit-false must match the original
    // clockwise behavior byte-for-byte, including the wrap-past-GO case.
    expect(buildTilePath(38, 2)).toEqual([38, 39, 0, 1, 2]);
    expect(buildTilePath(38, 2, false)).toEqual([38, 39, 0, 1, 2]);
    expect(buildTilePath(12, 20, false)).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
});

describe('thirdPersonPose', () => {
  const TOKEN_BASE_Y = 0.15;

  it('targets the token upper body at its ACTUAL rotated world position (not unrotated)', () => {
    // The forest-camera bug: aiming at unrotated coords points at empty space.
    // The target must land over the token's real visual world position, which is
    // tileToWorldRotated(index), at the configured upper-body height.
    for (const tile of [0, 5, 10, 17, 25, 33, 39]) {
      const pose = thirdPersonPose(tile);
      const world = tileToWorldRotated(tile);
      expect(pose.target.x).toBeCloseTo(world.x, 6);
      expect(pose.target.z).toBeCloseTo(world.z, 6);
      expect(pose.target.y).toBeCloseTo(TOKEN_BASE_Y + THIRD_PERSON_TARGET_Y, 6);
    }
  });

  it('places the camera behind the token along the direction of travel, above it', () => {
    const tile = 5;
    const cur = tileToWorldRotated(tile);
    const next = tileToWorldRotated((tile + 1) % 40);
    const forward = next.clone().sub(cur);
    forward.y = 0;
    forward.normalize();

    const pose = thirdPersonPose(tile);

    // Camera height = base + HEIGHT.
    expect(pose.cameraPos.y).toBeCloseTo(TOKEN_BASE_Y + THIRD_PERSON_HEIGHT, 6);

    // Planar vector from camera to the token base must point ALONG +forward
    // (camera sits behind), with magnitude equal to DIST.
    const camToTokenPlanar = cur.clone();
    camToTokenPlanar.y = 0;
    const camPlanar = pose.cameraPos.clone();
    camPlanar.y = 0;
    const delta = camToTokenPlanar.sub(camPlanar);
    expect(delta.length()).toBeCloseTo(THIRD_PERSON_DIST, 5);
    // Same direction as forward → dot ≈ full magnitude.
    expect(delta.normalize().dot(forward)).toBeCloseTo(1, 5);
  });

  it('normalizes tile index (wraps and handles negatives)', () => {
    // 40 wraps to 0; -1 wraps to 39. Poses must match their wrapped tile.
    const at0 = thirdPersonPose(0);
    const at40 = thirdPersonPose(40);
    expect(at40.cameraPos.x).toBeCloseTo(at0.cameraPos.x, 9);
    expect(at40.cameraPos.z).toBeCloseTo(at0.cameraPos.z, 9);

    const at39 = thirdPersonPose(39);
    const atNeg1 = thirdPersonPose(-1);
    expect(atNeg1.cameraPos.x).toBeCloseTo(at39.cameraPos.x, 9);
    expect(atNeg1.cameraPos.z).toBeCloseTo(at39.cameraPos.z, 9);
  });
});

describe('thirdPersonPoseAt', () => {
  const TOKEN_BASE_Y = 0.15;

  it('is byte-for-byte equal to thirdPersonPose when fed the tile world position', () => {
    // thirdPersonPose delegates to thirdPersonPoseAt(tileToWorldRotated(tile), tile);
    // this guards that the discrete-tile pose is unchanged by the refactor.
    for (const tile of [0, 1, 5, 10, 17, 25, 30, 33, 39]) {
      const discrete = thirdPersonPose(tile);
      const viaAt = thirdPersonPoseAt(tileToWorldRotated(tile), tile);
      expect(viaAt.cameraPos.x).toBeCloseTo(discrete.cameraPos.x, 9);
      expect(viaAt.cameraPos.y).toBeCloseTo(discrete.cameraPos.y, 9);
      expect(viaAt.cameraPos.z).toBeCloseTo(discrete.cameraPos.z, 9);
      expect(viaAt.target.x).toBeCloseTo(discrete.target.x, 9);
      expect(viaAt.target.y).toBeCloseTo(discrete.target.y, 9);
      expect(viaAt.target.z).toBeCloseTo(discrete.target.z, 9);
    }
  });

  it('targets the LIVE world position (mid-tile), not the tile center — the follow fix', () => {
    // A token mid-walk sits BETWEEN two tile centers. The pose target must land
    // over that live position (upper-body height), not snap to the discrete tile.
    const tile = 5;
    const a = tileToWorldRotated(tile);
    const b = tileToWorldRotated(tile + 1);
    const live = a.clone().lerp(b, 0.5); // halfway along the walk
    live.y = TOKEN_BASE_Y;

    const pose = thirdPersonPoseAt(live, tile);
    expect(pose.target.x).toBeCloseTo(live.x, 6);
    expect(pose.target.z).toBeCloseTo(live.z, 6);
    expect(pose.target.y).toBeCloseTo(TOKEN_BASE_Y + THIRD_PERSON_TARGET_Y, 6);
    // It must NOT be the discrete tile center (proves the live position is used).
    expect(Math.abs(pose.target.x - a.x) + Math.abs(pose.target.z - a.z)).toBeGreaterThan(0.1);
  });

  it('places the camera behind the live position along the ring direction, above it', () => {
    const tile = 5;
    const cur = tileToWorldRotated(tile);
    const next = tileToWorldRotated((tile + 1) % 40);
    const forward = next.clone().sub(cur);
    forward.y = 0;
    forward.normalize();

    const live = new THREE.Vector3(cur.x + 0.3, TOKEN_BASE_Y, cur.z + 0.3);
    const pose = thirdPersonPoseAt(live, tile);

    expect(pose.cameraPos.y).toBeCloseTo(TOKEN_BASE_Y + THIRD_PERSON_HEIGHT, 6);
    const camToTokenPlanar = new THREE.Vector3(live.x, 0, live.z);
    const camPlanar = pose.cameraPos.clone();
    camPlanar.y = 0;
    const delta = camToTokenPlanar.sub(camPlanar);
    expect(delta.length()).toBeCloseTo(THIRD_PERSON_DIST, 5);
    expect(delta.normalize().dot(forward)).toBeCloseTo(1, 5);
  });

  it('does not mutate the caller-supplied world position vector', () => {
    const live = new THREE.Vector3(1.23, 0.15, -4.56);
    const snapshot = live.clone();
    thirdPersonPoseAt(live, 7);
    expect(live.x).toBe(snapshot.x);
    expect(live.y).toBe(snapshot.y);
    expect(live.z).toBe(snapshot.z);
  });
});

import { BOARD_SPACES } from '../constants/board';
describe('BOARD_SPACES', () => {
  it('has 40 spaces indexed 0..39', () => {
    expect(BOARD_SPACES).toHaveLength(40);
    BOARD_SPACES.forEach((s, i) => expect(s.index).toBe(i));
  });
});
