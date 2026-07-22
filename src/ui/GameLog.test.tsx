import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameLog } from './GameLog';
import { useGameStore } from '../state/gameStore';
import type { GameState } from '../types/GameState';

function setLog(messages: string[]) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress', players: [], turn: { currentPlayerId: null },
    config: { maxPlayers: 4 }, properties: [],
    log: messages.map((m, i) => ({ timestamp: i, playerId: null, message: m, type: 'system' })),
  } as unknown as GameState);
}

describe('GameLog', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('shows the most recent entries newest-first', () => {
    setLog(['first', 'second', 'third']);
    render(<GameLog />);
    const items = screen.getAllByTestId('log-entry');
    expect(items[0].textContent).toContain('third');
    expect(items[items.length - 1].textContent).toContain('first');
  });

  it('caps at 6 entries', () => {
    setLog(Array.from({ length: 10 }, (_, i) => `m${i}`));
    render(<GameLog />);
    expect(screen.getAllByTestId('log-entry')).toHaveLength(6);
  });
});
