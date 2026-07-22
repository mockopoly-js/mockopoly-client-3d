import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MainMenu } from './MainMenu';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function fakeState(status = 'lobby'): GameState {
  return {
    roomCode: 'ABCD',
    status,
    players: [{ id: 'p1', name: 'Maya', token: 'red', isHost: true, isReady: false, isConnected: true, reconnectToken: 'tok-1' }],
    config: { maxPlayers: 4 },
  } as unknown as GameState;
}

describe('MainMenu', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    vi.restoreAllMocks();
    // Deliberately different from player.id ('p1') — proves identity comes from state, not socket.
    vi.spyOn(socketManager, 'playerId', 'get').mockReturnValue('socket-temp');
  });

  it('disables CREATE until a name is entered', () => {
    render(<MainMenu />);
    const create = screen.getByRole('button', { name: /create room/i });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/your name/i), { target: { value: 'Maya' } });
    expect((create as HTMLButtonElement).disabled).toBe(false);
  });

  it('emits ROOM_CREATE with name + token on create', () => {
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<MainMenu />);
    fireEvent.change(screen.getByPlaceholderText(/your name/i), { target: { value: 'Maya' } });
    fireEvent.click(screen.getByRole('button', { name: /create room/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.ROOM_CREATE, { playerName: 'Maya', token: 'red' });
  });

  it('on room-created: writes store, sets my id from state (not socket.id), navigates to lobby', () => {
    render(<MainMenu />);
    act(() => { gameBus.emit('room-created', { roomCode: 'ABCD', state: fakeState() }); });
    const s = useGameStore.getState();
    expect(s.roomCode).toBe('ABCD');
    expect(s.state?.roomCode).toBe('ABCD');
    // myPlayerId must be 'p1' (from state.players[last].id), NOT 'socket-temp' (socketManager.playerId)
    expect(s.myPlayerId).toBe('p1');
    expect(s.reconnectToken).toBe('tok-1');
    expect(s.screen).toBe('lobby');
  });

  it('on room-rejected: shows the reason and stays', () => {
    render(<MainMenu />);
    act(() => { gameBus.emit('room-rejected', { reason: 'Room is full' }); });
    expect(screen.getByText(/room is full/i)).toBeTruthy();
    expect(useGameStore.getState().screen).toBe('menu');
  });
});
