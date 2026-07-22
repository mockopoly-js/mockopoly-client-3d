import { describe, it, expect } from 'vitest';
import { hopPath, stackOffset } from './hopPath';

describe('hopPath', () => {
  it('lists each tile from+1..to for a simple forward move', () => {
    expect(hopPath(12, 20)).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
  });
  it('wraps past GO (39 -> 0)', () => {
    expect(hopPath(38, 2)).toEqual([39, 0, 1, 2]);
  });
  it('length equals spaces moved', () => {
    expect(hopPath(0, 5)).toHaveLength(5);
    expect(hopPath(37, 4)).toHaveLength(7); // 38,39,0,1,2,3,4
  });
});

describe('stackOffset', () => {
  it('cycles through 4 distinct planar offsets', () => {
    const a = stackOffset(0), b = stackOffset(1), c = stackOffset(4);
    expect(a).not.toEqual(b);
    expect(stackOffset(4)).toEqual(a); // wraps mod 4
    expect(c).toEqual(a);
  });
});
