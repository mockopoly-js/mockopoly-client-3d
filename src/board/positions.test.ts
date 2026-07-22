import { describe, it, expect } from 'vitest';
import { SPACE_POSITIONS, tileToWorld, BOARD_WORLD_SIZE } from './positions';

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

import { BOARD_SPACES } from '../constants/board';
describe('BOARD_SPACES', () => {
  it('has 40 spaces indexed 0..39', () => {
    expect(BOARD_SPACES).toHaveLength(40);
    BOARD_SPACES.forEach((s, i) => expect(s.index).toBe(i));
  });
});
