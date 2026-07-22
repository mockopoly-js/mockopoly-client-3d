import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerPods } from './PlayerPods';
import { useGameStore } from '../state/gameStore';
import type { GameState } from '../types/GameState';

function setPlayers(players: unknown[], currentPlayerId = 'p1') {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players, turn: { currentPlayerId }, config: { maxPlayers: 4 }, properties: [],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}
const seat = (id: string, name: string, extra = {}) => ({
  id, name, token: 'red', money: 15_000_000, position: 0,
  isJailed: false, isBankrupt: false, isConnected: true, isHost: false, ...extra,
});

describe('PlayerPods', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('renders a pod per player with money', () => {
    setPlayers([seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas', { token: 'blue' })]);
    render(<PlayerPods />);
    expect(screen.getByText('Maya')).toBeTruthy();
    expect(screen.getByText('Jonas')).toBeTruthy();
    expect(screen.getAllByText(/£15\.000M/)).toHaveLength(2);
  });

  it('marks jailed and bankrupt players', () => {
    setPlayers([seat('p1', 'Maya'), seat('p2', 'Jonas', { isJailed: true }), seat('p3', 'Kwan', { isBankrupt: true })]);
    render(<PlayerPods />);
    expect(screen.getByText(/jail/i)).toBeTruthy();
    expect(screen.getByText(/bankrupt/i)).toBeTruthy();
  });
});
