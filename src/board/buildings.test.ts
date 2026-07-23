/**
 * Unit tests for the Buildings placement helpers: `houseSlots` and `hotelSlot`.
 * No R3F — pure math only.
 */

import { describe, it, expect } from 'vitest';
import { houseSlots, hotelSlot } from './Buildings';
import { tileToWorld, BOARD_WORLD_SIZE } from './positions';

// Helpers
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const dist2 = (ax: number, az: number, bx: number, bz: number) =>
  Math.sqrt((ax - bx) ** 2 + (az - bz) ** 2);

describe('houseSlots', () => {
  it('returns exactly count slots', () => {
    for (const count of [1, 2, 3, 4]) {
      const slots = houseSlots(1, count);
      expect(slots).toHaveLength(count);
    }
  });

  it('all slots rest at TILE_SURFACE_Y (0.02)', () => {
    const slots = houseSlots(3, 4);
    for (const s of slots) {
      expect(s.y).toBeCloseTo(0.02, 5);
    }
  });

  it('single house on tile 1 is inward from tile center', () => {
    const [cx, , cz] = tileToWorld(1);
    const slots = houseSlots(1, 1);
    const s = slots[0];
    // Inward offset means the slot is closer to origin than the tile center.
    const distSlot  = Math.sqrt(s.x ** 2 + s.z ** 2);
    const distTile  = Math.sqrt(cx ** 2 + cz ** 2);
    expect(distSlot).toBeLessThan(distTile);
  });

  it('4 houses on tile 6 are evenly spaced perpendicular to inward', () => {
    const slots = houseSlots(6, 4);
    expect(slots).toHaveLength(4);
    // Adjacent gaps should all be equal.
    const d01 = dist2(slots[0].x, slots[0].z, slots[1].x, slots[1].z);
    const d12 = dist2(slots[1].x, slots[1].z, slots[2].x, slots[2].z);
    const d23 = dist2(slots[2].x, slots[2].z, slots[3].x, slots[3].z);
    expect(near(d01, d12, 1e-5)).toBe(true);
    expect(near(d12, d23, 1e-5)).toBe(true);
  });

  it('3 houses on tile 11 (left column): centroid equals the 1-house position', () => {
    const [s1] = houseSlots(11, 1);
    const slots3 = houseSlots(11, 3);
    const cx = (slots3[0].x + slots3[1].x + slots3[2].x) / 3;
    const cz = (slots3[0].z + slots3[1].z + slots3[2].z) / 3;
    expect(cx).toBeCloseTo(s1.x, 5);
    expect(cz).toBeCloseTo(s1.z, 5);
  });

  it('rotationY for tile 1 (bottom row) is approximately 0 or PI (inward = toward +z)', () => {
    // Tile 1 is on the bottom row: cz > 0, cx varies.
    // Inward direction points toward z=0 from the bottom, i.e., negative z => rotY ~= PI.
    const [s] = houseSlots(1, 1);
    const [cx, , cz] = tileToWorld(1);
    const len = Math.sqrt(cx * cx + cz * cz);
    const inwardX = -cx / len;
    const inwardZ = -cz / len;
    const expected = Math.atan2(inwardX, inwardZ);
    expect(s.rotationY).toBeCloseTo(expected, 5);
  });

  it('slots on tile 21 (top row) have coords with actual computed values', () => {
    // Tile 21 is top-row first: x < 0, z < 0.
    const [cx, , cz] = tileToWorld(21);
    const TILE_WIDTH = BOARD_WORLD_SIZE / 11;
    const INWARD_OFFSET = TILE_WIDTH * 0.35;
    const len = Math.sqrt(cx * cx + cz * cz);
    const inwardX = -cx / len;
    const inwardZ = -cz / len;
    const expectedX = cx + inwardX * INWARD_OFFSET;
    const expectedZ = cz + inwardZ * INWARD_OFFSET;
    const [slot] = houseSlots(21, 1);
    expect(slot.x).toBeCloseTo(expectedX, 5);
    expect(slot.z).toBeCloseTo(expectedZ, 5);
  });
});

describe('hotelSlot', () => {
  it('returns a single centered slot at TILE_SURFACE_Y', () => {
    const slot = hotelSlot(5);
    expect(slot.y).toBeCloseTo(0.02, 5);
  });

  it('hotel slot for tile 5 matches single-house position (same base point)', () => {
    const hotel = hotelSlot(5);
    const [house] = houseSlots(5, 1);
    expect(hotel.x).toBeCloseTo(house.x, 5);
    expect(hotel.z).toBeCloseTo(house.z, 5);
    expect(hotel.rotationY).toBeCloseTo(house.rotationY, 5);
  });

  it('hotel is closer to origin than tile center (inward)', () => {
    const [cx, , cz] = tileToWorld(25);
    const slot = hotelSlot(25);
    expect(Math.sqrt(slot.x ** 2 + slot.z ** 2)).toBeLessThan(
      Math.sqrt(cx ** 2 + cz ** 2)
    );
  });
});
