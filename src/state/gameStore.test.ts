import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useGameStore,
  selectMyPlayer,
  selectIsMyTurn,
  selectCurrentPlayer,
  getStoredReconnectToken,
} from './gameStore';
import { DEFAULT_CHARACTER } from '../constants/characters';
import type { GameState } from '../types/GameState';
import type { S_GameOver } from '../types/SocketEvents';

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

  it('stores and clears the gameOver payload', () => {
    const go: S_GameOver = { winnerId: 'p1', finalStandings: [] };
    useGameStore.getState().setGameOver(go);
    expect(useGameStore.getState().gameOver).toBe(go);
    useGameStore.getState().reset();
    expect(useGameStore.getState().gameOver).toBe(null);
  });

  it('removes a toast by timestamp', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    useGameStore.getState().addToast('a', 'info');
    const ts = useGameStore.getState().toasts[0].timestamp;   // 1000
    useGameStore.getState().addToast('b', 'error');            // 2000
    useGameStore.getState().removeToast(ts);
    const msgs = useGameStore.getState().toasts.map((t) => t.message);
    expect(msgs).not.toContain('a');
    expect(msgs).toContain('b');
    nowSpy.mockRestore();
  });

  it('toggles the dev-hacks panel and reset closes it', () => {
    expect(useGameStore.getState().showDevHacks).toBe(false);
    useGameStore.getState().toggleDevHacks(true);
    expect(useGameStore.getState().showDevHacks).toBe(true);
    useGameStore.getState().toggleDevHacks();       // flips → false
    expect(useGameStore.getState().showDevHacks).toBe(false);
    useGameStore.getState().toggleDevHacks(true);
    useGameStore.getState().reset();
    expect(useGameStore.getState().showDevHacks).toBe(false);
  });

  it('selectedCharacter defaults to DEFAULT_CHARACTER', () => {
    expect(useGameStore.getState().selectedCharacter).toBe(DEFAULT_CHARACTER);
  });

  it('setSelectedCharacter updates state and persists to localStorage', () => {
    useGameStore.getState().setSelectedCharacter('Ninja_Male');
    expect(useGameStore.getState().selectedCharacter).toBe('Ninja_Male');
    expect(localStorage.getItem('mockopoly_character')).toBe('Ninja_Male');
  });

  it('setSelectedCharacter can be called with any character id', () => {
    useGameStore.getState().setSelectedCharacter('Wizard');
    expect(useGameStore.getState().selectedCharacter).toBe('Wizard');
    useGameStore.getState().setSelectedCharacter('Pirate_Female');
    expect(useGameStore.getState().selectedCharacter).toBe('Pirate_Female');
  });

  // ── deedCardIndex (read-only tile inspect) ──────────────────────────────────

  it('deedCardIndex starts null', () => {
    expect(useGameStore.getState().deedCardIndex).toBe(null);
  });

  it('openDeedCard sets deedCardIndex without touching selectedPropertyIndex', () => {
    useGameStore.getState().openDeedCard(5);
    expect(useGameStore.getState().deedCardIndex).toBe(5);
    // MortgagePanel state must be untouched
    expect(useGameStore.getState().selectedPropertyIndex).toBe(null);
    expect(useGameStore.getState().showPropertyCard).toBe(false);
  });

  it('closeDeedCard resets deedCardIndex to null', () => {
    useGameStore.getState().openDeedCard(11);
    expect(useGameStore.getState().deedCardIndex).toBe(11);
    useGameStore.getState().closeDeedCard();
    expect(useGameStore.getState().deedCardIndex).toBe(null);
  });

  it('openDeedCard does not collide with selectProperty — both can coexist', () => {
    useGameStore.getState().selectProperty(3);
    useGameStore.getState().openDeedCard(7);
    expect(useGameStore.getState().selectedPropertyIndex).toBe(3);
    expect(useGameStore.getState().showPropertyCard).toBe(true);
    expect(useGameStore.getState().deedCardIndex).toBe(7);
  });

  it('reset clears deedCardIndex', () => {
    useGameStore.getState().openDeedCard(39);
    useGameStore.getState().reset();
    expect(useGameStore.getState().deedCardIndex).toBe(null);
  });
});
