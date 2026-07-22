import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TurnHud } from './TurnHud';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function setState(turn: Partial<Record<string, unknown>>, money = 15_000_000) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money, position: 0, isBankrupt: false, isConnected: true }],
    turn: { currentPlayerId: 'p1', phase: 'waiting', hasRolled: false, ...turn },
    config: { maxPlayers: 4 }, properties: [],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('TurnHud', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('enables Roll on my waiting turn and emits TURN_ROLL_DICE', () => {
    setState({ phase: 'waiting', hasRolled: false });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<TurnHud />);
    const roll = screen.getByRole('button', { name: /roll/i });
    expect((roll as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(roll);
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_ROLL_DICE);
  });

  it('disables Roll during moving and shows my money', () => {
    setState({ phase: 'moving', hasRolled: true });
    render(<TurnHud />);
    expect((screen.getByRole('button', { name: /roll/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/£15\.000M/)).toBeTruthy();
  });

  it('enables End Turn in action phase and emits TURN_END', () => {
    setState({ phase: 'action', hasRolled: true });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<TurnHud />);
    const endBtn = screen.getByRole('button', { name: /end turn/i });
    expect((endBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(endBtn);
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_END);
  });
});
