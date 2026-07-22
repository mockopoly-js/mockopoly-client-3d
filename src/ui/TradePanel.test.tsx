import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TradePanel } from './TradePanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import type { GameState } from '../types/GameState';

const mineProp = BOARD_SPACES.find((s) => s.type === 'property')!.index;
const theirProp = BOARD_SPACES.filter((s) => s.type === 'property')[3].index;

function base(activeTrade: unknown = null) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money: 15_000_000, isBankrupt: false },
              { id: 'p2', name: 'Jonas', token: 'blue', money: 15_000_000, isBankrupt: false }],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 },
    properties: [
      { spaceIndex: mineProp, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
      { spaceIndex: theirProp, ownerId: 'p2', houses: 0, hasHotel: false, isMortgaged: false },
    ],
    activeTrade,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('TradePanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('is null when closed and no active trade', () => {
    base();
    const { container } = render(<TradePanel />);
    expect(container.firstChild).toBe(null);
  });

  it('proposal form emits TRADE_OFFER with selected items', () => {
    base();
    useGameStore.getState().toggleTradePanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<TradePanel />);
    // pick opponent Jonas
    fireEvent.click(screen.getByRole('button', { name: /jonas/i }));
    // offer my property, request theirs
    fireEvent.click(screen.getByTestId(`offer-${mineProp}`));
    fireEvent.click(screen.getByTestId(`request-${theirProp}`));
    fireEvent.click(screen.getByRole('button', { name: /send offer/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_OFFER, expect.objectContaining({
      toPlayerId: 'p2', offeredProperties: [mineProp], requestedProperties: [theirProp],
      offeredMoney: 0, requestedMoney: 0, offeredJailCards: 0, requestedJailCards: 0,
    }));
  });

  it('incoming trade shows Accept and emits TRADE_ACCEPT', () => {
    base({ tradeId: 't1', fromPlayerId: 'p2', toPlayerId: 'p1', offeredProperties: [theirProp], requestedProperties: [], offeredMoney: 0, requestedMoney: 0, offeredJailCards: 0, requestedJailCards: 0, status: 'pending' });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<TradePanel />);
    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_ACCEPT, { tradeId: 't1' });
  });

  it('my outgoing trade shows Cancel and emits TRADE_CANCEL', () => {
    base({ tradeId: 't2', fromPlayerId: 'p1', toPlayerId: 'p2', offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0, offeredJailCards: 0, requestedJailCards: 0, status: 'pending' });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<TradePanel />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_CANCEL, { tradeId: 't2' });
  });
});
