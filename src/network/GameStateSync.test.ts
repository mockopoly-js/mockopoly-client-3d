import { describe, it, expect, beforeEach, vi } from 'vitest';

// A fake socket registry so we can drive server events by hand.
const handlers = new Map<string, (data: unknown) => void>();
vi.mock('./SocketManager', () => ({
  socketManager: {
    on: (event: string, cb: (data: unknown) => void) => handlers.set(event, cb),
    emit: vi.fn(),
  },
}));

import { gameStateSync } from './GameStateSync';
import { useGameStore } from '../state/gameStore';
import { gameBus } from '../state/gameBus';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function fire(event: string, data: unknown) {
  const h = handlers.get(event);
  if (!h) throw new Error(`no handler registered for ${event}`);
  h(data);
}

describe('gameStateSync', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('writes GAME_STATE_UPDATE into the store', () => {
    gameStateSync.register();
    const state = { players: [], turn: { currentPlayerId: null } } as unknown as GameState;
    fire(EVENTS.GAME_STATE_UPDATE, { state });
    expect(useGameStore.getState().state).toBe(state);
  });

  it('relays a transient animation event onto the bus', () => {
    gameStateSync.register();
    const spy = vi.fn();
    gameBus.on('player-moved', spy);
    const payload = { playerId: 'p1' };
    fire(EVENTS.TURN_PLAYER_MOVED, payload);
    expect(spy).toHaveBeenCalledWith(payload);
    gameBus.off('player-moved', spy);
  });

  it('routes a server jail event to a toast', () => {
    gameStateSync.register();
    const state = {
      players: [{ id: 'p1', name: 'Maya' }],
      turn: { currentPlayerId: 'p1' },
    } as unknown as GameState;
    fire(EVENTS.GAME_STATE_UPDATE, { state });
    fire(EVENTS.JAIL_SENT, { playerId: 'p1' });
    const toasts = useGameStore.getState().toasts;
    expect(toasts.at(-1)?.message).toContain('Maya');
    expect(toasts.at(-1)?.type).toBe('warning');
  });
});
