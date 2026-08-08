import { describe, it, expect, beforeEach, vi } from 'vitest';
import { noop } from '../test-utils';
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

  it('renders a slot per player and marks host + your own seat', () => {
    setState([seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas')]);
    render(<Lobby />);
    expect(screen.getByText('Maya')).toBeTruthy();
    expect(screen.getByText('Jonas')).toBeTruthy();
    expect(screen.getByText(/host/i)).toBeTruthy();
    // My seat is the one in the interactive column, captioned rather than tagged.
    expect(screen.getByText(/your seat/i)).toBeTruthy();
  });

  it('emits ROOM_READY when the ready switch is flipped', () => {
    setState([seat('p1', 'Maya', { isHost: true })]);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<Lobby />);
    fireEvent.click(screen.getByRole('checkbox', { name: /^ready$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.ROOM_READY, { isReady: true });
  });

  it('shows START only for the host and soft-disables below 2 players', () => {
    setState([seat('p1', 'Maya', { isHost: true })]);
    render(<Lobby />);
    expect((screen.getByRole('button', { name: /^start/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a non-host gets a waiting slot, not a START button', () => {
    setState([seat('p1', 'Maya'), seat('p2', 'Jonas', { isHost: true })]);
    render(<Lobby />);
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
    expect(screen.getByRole('button', { name: /waiting for host/i })).toBeTruthy();
  });

  it('routes to game when status becomes in-progress', () => {
    setState([seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas')]);
    render(<Lobby />);
    act(() => {
      useGameStore.getState().update({ roomCode: 'ABCD', status: 'in-progress', players: [seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas')], config: { maxPlayers: 4 } } as unknown as GameState);
    });
    expect(useGameStore.getState().screen).toBe('game');
  });

  it('shows the countdown from the gameBus, in the display-only band', () => {
    setState([seat('p1', 'Maya', { isHost: true })], 'starting');
    render(<Lobby />);
    act(() => { gameBus.emit('countdown', { seconds: 3 }); });
    const numeral = screen.getByTestId('countdown');
    expect(numeral.textContent).toBe('3');
    expect(numeral.getAttribute('aria-label')).toMatch(/3/);
    // The room code gives way to the countdown — the band shows one thing at a time.
    expect(screen.queryByText('ABCD')).toBeNull();
  });

  it('shows the room code in the mono face — the one place mono is used', () => {
    setState([seat('p1', 'Maya', { isHost: true })]);
    render(<Lobby />);
    const code = screen.getByText('ABCD');
    expect(code.style.fontFamily).toBe('var(--font-mono)');
  });

  it('marks a disconnected player offline rather than fading them out', () => {
    setState([seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas', { isConnected: false })]);
    const { container } = render(<Lobby />);
    expect(screen.getByText(/offline/i)).toBeTruthy();
    // Rule R3: never opacity on a text-bearing box. The kit's is-offline class
    // desaturates the chrome instead, and this asserts we opted into it.
    const offline = container.querySelector('.kit-pod.is-offline');
    expect(offline).toBeTruthy();
    expect((offline as HTMLElement).style.opacity).toBe('');
  });

  it('shows an open seat for every unfilled place at the table', () => {
    setState([seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas')]);
    render(<Lobby />);
    expect(screen.getAllByText(/open seat/i)).toHaveLength(2);
    expect(screen.getByText(/table · 2\/4/i)).toBeTruthy();
  });

  it('copy code writes the room code and confirms, once', () => {
    setState([seat('p1', 'Maya', { isHost: true })]);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Lobby />);
    fireEvent.click(screen.getByRole('button', { name: /copy code/i }));
    expect(writeText).toHaveBeenCalledWith('ABCD');
    expect(screen.getByRole('button', { name: /code copied/i })).toBeTruthy();
  });

  it('leaving emits ROOM_LEAVE and resets to the menu', () => {
    setState([seat('p1', 'Maya', { isHost: true })]);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<Lobby />);
    fireEvent.click(screen.getByRole('button', { name: /leave lobby/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.ROOM_LEAVE);
    expect(useGameStore.getState().screen).toBe('menu');
  });
});
