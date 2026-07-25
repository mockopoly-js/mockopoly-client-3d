import { describe, it, expect } from 'vitest';
import { tileColor } from './tileColor';
import { BOARD_SPACES } from '../constants/board';
import { requireDefined } from '../test-utils';

describe('tileColor', () => {
  it('returns a hex string for every board space', () => {
    for (const s of BOARD_SPACES) {
      expect(tileColor(s)).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
  it('colors a known property by its group', () => {
    const prop = requireDefined(BOARD_SPACES.find((s) => s.type === 'property' && s.colorGroup));
    expect(tileColor(prop)).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
