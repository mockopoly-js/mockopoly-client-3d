import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useGameBusEvent } from './useGameBus';
import { gameBus } from './gameBus';

function Listener({ onEvt }: { onEvt: (p: unknown) => void }) {
  useGameBusEvent('player-moved', onEvt);
  return null;
}

describe('useGameBusEvent', () => {
  it('delivers gameBus events to the handler while mounted', () => {
    const spy = vi.fn();
    const { unmount } = render(<Listener onEvt={spy} />);
    gameBus.emit('player-moved', { playerId: 'p1' });
    expect(spy).toHaveBeenCalledWith({ playerId: 'p1' });
    unmount();
    gameBus.emit('player-moved', { playerId: 'p2' });
    expect(spy).toHaveBeenCalledTimes(1); // no delivery after unmount
  });
});
