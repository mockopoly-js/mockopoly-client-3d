import { describe, it, expect } from 'vitest';
import {
  SPACE_POSITIONS,
  tileToWorld,
  tileToWorldRotated,
  BOARD_WORLD_SIZE,
  thirdPersonPose,
  THIRD_PERSON_DIST,
  THIRD_PERSON_HEIGHT,
  THIRD_PERSON_TARGET_Y,
} from './positions';

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

import { BOARD_SPACES } from '../constants/board';
describe('BOARD_SPACES', () => {
  it('has 40 spaces indexed 0..39', () => {
    expect(BOARD_SPACES).toHaveLength(40);
    BOARD_SPACES.forEach((s, i) => expect(s.index).toBe(i));
  });
});
