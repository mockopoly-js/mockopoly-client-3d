import { describe, it, expect, vi } from 'vitest';
import { gameBus } from './gameBus';

describe('gameBus', () => {
  it('delivers emitted payloads to listeners', () => {
    const spy = vi.fn();
    gameBus.on('player-moved', spy);
    const payload = { playerId: 'p1', to: 7 };
    gameBus.emit('player-moved', payload);
    expect(spy).toHaveBeenCalledWith(payload);
    gameBus.off('player-moved', spy);
  });
});
