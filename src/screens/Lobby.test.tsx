import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Lobby } from './Lobby';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function seat(id: string, name: string, extra: Partial<Record<string, unknown>> = {}) {
  return { id, name, token: 'red', isHost: false, isReady: false, isConnected: true, reconnectToken: '', ...extra };
}
function setState(players: unknown[], status = 'lobby') {
  act(() => {
    useGameStore.getState().update({ roomCode: 'ABCD', status, players, config: { maxPlayers: 4 } } as unknown as GameState);
    useGameStore.getState().setRoomCode('ABCD');
    useGameStore.getState().setMyPlayerId('p1');
  });
}

describe('Lobby', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    vi.restoreAllMocks();
    socketManager.setPlayerId('p1');
    vi.spyOn(socketManager, 'playerId', 'get').mockReturnValue('p1');
  });

  it('renders a slot per player and marks host + you', () => {
    setState([seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas')]);
    render(<Lobby />);
    expect(screen.getByText('Maya')).toBeTruthy();
    expect(screen.getByText('Jonas')).toBeTruthy();
    expect(screen.getByText(/host/i)).toBeTruthy();
    expect(screen.getByText(/you/i)).toBeTruthy();
  });

  it('emits ROOM_READY when the ready button is clicked', () => {
    setState([seat('p1', 'Maya', { isHost: true })]);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<Lobby />);
    fireEvent.click(screen.getByRole('button', { name: /ready/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.ROOM_READY, { isReady: true });
  });

  it('shows START only for the host and soft-disables below 2 players', () => {
    setState([seat('p1', 'Maya', { isHost: true })]);
    render(<Lobby />);
    expect((screen.getByRole('button', { name: /start game/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('routes to game when status becomes in-progress', () => {
    setState([seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas')]);
    render(<Lobby />);
    act(() => {
      useGameStore.getState().update({ roomCode: 'ABCD', status: 'in-progress', players: [seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas')], config: { maxPlayers: 4 } } as unknown as GameState);
    });
    expect(useGameStore.getState().screen).toBe('game');
  });

  it('shows the countdown from the gameBus', () => {
    setState([seat('p1', 'Maya', { isHost: true })], 'starting');
    render(<Lobby />);
    act(() => { gameBus.emit('countdown', { seconds: 3 }); });
    expect(screen.getByText(/starting in 3/i)).toBeTruthy();
  });
});
