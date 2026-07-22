import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PropertyListPanel } from './PropertyListPanel';
import { useGameStore } from '../state/gameStore';
import { BOARD_SPACES } from '../constants/board';
import type { GameState } from '../types/GameState';

const props = BOARD_SPACES.filter((s) => s.type === 'property' && s.colorGroup).slice(0, 2);

function setState(properties: unknown[], partnerships: unknown[] = []) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red' }],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 }, partnerships, properties,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('PropertyListPanel', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('lists my directly-owned properties with build badges', () => {
    setState([
      { spaceIndex: props[0].index, ownerId: 'p1', houses: 2, hasHotel: false, isMortgaged: false },
      { spaceIndex: props[1].index, ownerId: 'p2', houses: 0, hasHotel: false, isMortgaged: false },
    ]);
    render(<PropertyListPanel />);
    expect(screen.getByText(props[0].name)).toBeTruthy();     // mine
    expect(screen.queryByText(props[1].name)).toBe(null);      // not mine
    expect(screen.getByText(/2h/i)).toBeTruthy();
  });

  it('includes properties owned via an active partnership on the group', () => {
    const grp = props[0].colorGroup;
    setState(
      [{ spaceIndex: props[0].index, ownerId: 'p2', houses: 0, hasHotel: false, isMortgaged: false }],
      [{ colorGroup: grp, status: 'active', partners: [{ playerId: 'p1', percentage: 50 }, { playerId: 'p2', percentage: 50 }] }],
    );
    render(<PropertyListPanel />);
    expect(screen.getByText(props[0].name)).toBeTruthy(); // via partnership
  });
});
