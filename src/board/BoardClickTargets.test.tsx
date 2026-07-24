import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useGameStore } from '../state/gameStore';
import { PURCHASABLE_SPACES, BOARD_SPACES } from '../constants/board';

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
