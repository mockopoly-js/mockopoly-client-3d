import { describe, it, expect, beforeEach } from 'vitest';
import {
  useGameStore,
  selectMyPlayer,
  selectIsMyTurn,
  selectCurrentPlayer,
  getStoredReconnectToken,
} from './gameStore';
import type { GameState } from '../types/GameState';

function fakeState(): GameState {
  // Minimal shape sufficient for the store's reads. Cast covers unused fields.
  return {
    players: [
      { id: 'p1', name: 'Maya' },
      { id: 'p2', name: 'Jonas' },
    ],
    turn: { currentPlayerId: 'p1' },
  } as unknown as GameState;
}

describe('gameStore', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    localStorage.clear();
  });

  it('stores a server state snapshot via update()', () => {
    const s = fakeState();
    useGameStore.getState().update(s);
    expect(useGameStore.getState().state).toBe(s);
  });

  it('resolves my player and whose turn it is via selectors', () => {
    useGameStore.getState().update(fakeState());
    useGameStore.getState().setMyPlayerId('p1');
    const st = useGameStore.getState();
    expect(selectMyPlayer(st)?.name).toBe('Maya');
    expect(selectIsMyTurn(st)).toBe(true);
    expect(selectCurrentPlayer(st)?.name).toBe('Maya');
  });

  it('is not my turn when I am not the current player', () => {
    useGameStore.getState().update(fakeState());
    useGameStore.getState().setMyPlayerId('p2');
    expect(selectIsMyTurn(useGameStore.getState())).toBe(false);
  });

  it('persists and clears the reconnect token in localStorage', () => {
    useGameStore.getState().setReconnectToken('tok-123');
    expect(getStoredReconnectToken()).toBe('tok-123');
    expect(useGameStore.getState().reconnectToken).toBe('tok-123');
    useGameStore.getState().clearReconnectToken();
    expect(getStoredReconnectToken()).toBe(null);
    expect(useGameStore.getState().reconnectToken).toBe(null);
  });

  it('appends toasts with a type', () => {
    useGameStore.getState().addToast('hi', 'success');
    const toasts = useGameStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ message: 'hi', type: 'success' });
  });

  it('opens the property card when a property is selected', () => {
    useGameStore.getState().selectProperty(5);
    expect(useGameStore.getState().selectedPropertyIndex).toBe(5);
    expect(useGameStore.getState().showPropertyCard).toBe(true);
    useGameStore.getState().selectProperty(null);
    expect(useGameStore.getState().showPropertyCard).toBe(false);
  });

  it('starts on the menu screen and can navigate', () => {
    expect(useGameStore.getState().screen).toBe('menu');
    useGameStore.getState().setScreen('lobby');
    expect(useGameStore.getState().screen).toBe('lobby');
  });

  it('reset returns to the menu screen', () => {
    useGameStore.getState().setScreen('game');
    useGameStore.getState().reset();
    expect(useGameStore.getState().screen).toBe('menu');
  });
});
