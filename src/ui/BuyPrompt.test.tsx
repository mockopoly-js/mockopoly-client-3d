import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BuyPrompt } from './BuyPrompt';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import type { GameState } from '../types/GameState';

// pick a real unowned buyable space (property with a price)
const prop = BOARD_SPACES.find((s) => s.type === 'property' && (s.price ?? 0) > 0)!;

function land(phase: string, money: number, ownerId: string | null = null) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money, position: prop.index, isBankrupt: false, isConnected: true }],
    turn: { currentPlayerId: 'p1', phase, hasRolled: true },
    config: { maxPlayers: 4 },
    properties: [{ spaceIndex: prop.index, ownerId, houses: 0, hasHotel: false, isMortgaged: false }],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('BuyPrompt', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('shows nothing outside the action phase', () => {
    land('moving', 15_000_000);
    const { container } = render(<BuyPrompt />);
    expect(container.textContent).not.toContain(prop.name);
  });

  it('shows the deed and emits TURN_BUY_PROPERTY when affordable', () => {
    land('action', 15_000_000);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<BuyPrompt />);
    expect(screen.getByText(prop.name)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /buy/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_BUY_PROPERTY);
  });

  it('emits TURN_PASS_BUY on decline', () => {
    land('action', 15_000_000);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<BuyPrompt />);
    fireEvent.click(screen.getByRole('button', { name: /decline/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_PASS_BUY);
  });

  it('disables Buy when unaffordable but still allows Decline', () => {
    land('action', 0);
    render(<BuyPrompt />);
    expect((screen.getByRole('button', { name: /buy/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /decline/i })).toBeTruthy();
  });

  it('shows nothing when the space is already owned', () => {
    land('action', 15_000_000, 'p2');
    const { container } = render(<BuyPrompt />);
    expect(container.textContent).not.toContain(prop.name);
  });
});
