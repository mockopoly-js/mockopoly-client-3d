import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { BigMomentOverlay } from './BigMomentOverlay';
import { useGameStore } from '../state/gameStore';
import { gameBus } from '../state/gameBus';
import type { GameState } from '../types/GameState';

function players() {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red' }, { id: 'p2', name: 'Jonas', token: 'blue' }],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 }, properties: [],
  } as unknown as GameState);
}

describe('BigMomentOverlay', () => {
  beforeEach(() => { useGameStore.getState().reset(); players(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('shows nothing initially', () => {
    const { container } = render(<BigMomentOverlay />);
    expect(container.firstChild).toBe(null);
  });

  it('announces a rent hit with names + amount', () => {
    render(<BigMomentOverlay />);
    act(() => { gameBus.emit('rent-collected', { fromId: 'p2', toId: 'p1', amount: 2_400_000, spaceIndex: 6 }); });
    const t = screen.getByText(/jonas/i).textContent ?? '';
    expect(t).toMatch(/jonas/i); expect(t).toMatch(/maya/i); expect(t).toMatch(/2\.400M/);
  });

  it('announces jail and auto-dismisses', () => {
    render(<BigMomentOverlay />);
    act(() => { gameBus.emit('jail-sent', { playerId: 'p1' }); });
    expect(screen.getByText(/maya.*jail/i)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2800); });
    expect(screen.queryByText(/jail/i)).toBe(null);
  });

  it('announces bankruptcy', () => {
    render(<BigMomentOverlay />);
    act(() => { gameBus.emit('player-bankrupt', { playerId: 'p2', creditorId: 'p1' }); });
    expect(screen.getByText(/jonas.*bankrupt/i)).toBeTruthy();
  });
});
