import { describe, it, expect, beforeEach, vi } from 'vitest';
import { noop } from '../test-utils';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MainMenu } from './MainMenu';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import { DEFAULT_CHARACTER, resolveCharacter } from '../constants/characters';
import type { GameState } from '../types/GameState';

function fakeState(status = 'lobby'): GameState {
  return {
    roomCode: 'ABCD',
    status,
    players: [{ id: 'p1', name: 'Maya', token: 'red', isHost: true, isReady: false, isConnected: true, reconnectToken: 'tok-1' }],
    config: { maxPlayers: 4 },
  } as unknown as GameState;
}

function renderMenu() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <MainMenu />
    </MemoryRouter>,
  );
}

const typeName = (value: string) => {
  fireEvent.change(screen.getByPlaceholderText(/your name/i), { target: { value } });
};
const switchTo = (mode: RegExp) => {
  fireEvent.click(within(screen.getByRole('radiogroup', { name: /create or join/i })).getByRole('radio', { name: mode }));
};

describe('MainMenu', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    // `reset()` deliberately keeps the player's cosmetic choices, so a test that
    // picks a colour would otherwise leak into the next one.
    useGameStore.getState().setSelectedToken('red');
    useGameStore.getState().setSelectedCharacter(DEFAULT_CHARACTER);
    vi.restoreAllMocks();
    // Deliberately different from player.id ('p1') — proves identity comes from state, not socket.
    vi.spyOn(socketManager, 'playerId', 'get').mockReturnValue('socket-temp');
  });

  it('disables CREATE until a name is entered', () => {
    renderMenu();
    const create = screen.getByRole('button', { name: /create room/i });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    typeName('Maya');
    expect((create as HTMLButtonElement).disabled).toBe(false);
  });

  it('emits ROOM_CREATE with name + token + character on create', () => {
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    renderMenu();
    typeName('Maya');
    fireEvent.click(screen.getByRole('button', { name: /create room/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.ROOM_CREATE, {
      playerName: 'Maya',
      token: 'red',
      character: DEFAULT_CHARACTER,
    });
  });

  it('on room-created: writes store, sets my id from state (not socket.id), navigates to lobby', () => {
    renderMenu();
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
    renderMenu();
    act(() => { gameBus.emit('room-rejected', { reason: 'Room is full' }); });
    expect(screen.getByText(/room is full/i)).toBeTruthy();
    expect(useGameStore.getState().screen).toBe('menu');
  });

  it('shows the Choose Character button linking to /character-select', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: /choose character/i })).toBeTruthy();
  });

  // ── landscape shell: one layout, and the controls that carry it ────────────

  it('names the equipped skin in the read-only column', () => {
    renderMenu();
    expect(screen.getByText(resolveCharacter(DEFAULT_CHARACTER).name)).toBeTruthy();
  });

  it('offers all eight board colours as 44px radios and commits the pick to the store', () => {
    renderMenu();
    const group = screen.getByRole('radiogroup', { name: /board colour/i });
    const swatches = within(group).getAllByRole('radio');
    expect(swatches).toHaveLength(8);
    fireEvent.click(within(group).getByRole('radio', { name: 'purple' }));
    expect(useGameStore.getState().selectedToken).toBe('purple');
  });

  it('CREATE is the default pane; JOIN swaps in the code input and its own CTA', () => {
    renderMenu();
    expect(screen.queryByLabelText(/room code/i)).toBeNull();
    switchTo(/join/i);
    expect(screen.getByLabelText(/room code/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /create room/i })).toBeNull();
    expect(screen.getByRole('button', { name: /join room/i })).toBeTruthy();
  });

  it('JOIN needs both a name and at least four code characters', () => {
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    renderMenu();
    switchTo(/join/i);
    const join = screen.getByRole('button', { name: /join room/i }) as HTMLButtonElement;
    expect(join.disabled).toBe(true);

    typeName('Maya');
    expect(join.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/room code/i), { target: { value: 'kx7' } });
    expect(join.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/room code/i), { target: { value: 'kx7t2m' } });
    expect(join.disabled).toBe(false);

    fireEvent.click(join);
    expect(emit).toHaveBeenCalledWith(EVENTS.ROOM_JOIN, expect.objectContaining({
      // The code input uppercases as it is typed.
      roomCode: 'KX7T2M',
      playerName: 'Maya',
      token: 'red',
    }));
  });

  it('renders ONE layout — no desktop/mobile branch is left to diverge', () => {
    // The old file shipped three copies of these controls behind useIsMobile /
    // useIsLandscape; a duplicate is the failure mode this guards against.
    renderMenu();
    expect(screen.getAllByPlaceholderText(/your name/i)).toHaveLength(1);
    expect(screen.getAllByRole('radiogroup', { name: /board colour/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /create room/i })).toHaveLength(1);
  });
});
