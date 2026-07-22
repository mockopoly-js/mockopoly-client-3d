import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DealPanel } from './DealPanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function base(turn: object, activeRentDeal: unknown = null, money = 15_000_000, goUsed = 0) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money, position: 5, goDeductionsUsed: goUsed, goSkipsRemaining: 0 },
              { id: 'p2', name: 'Jonas', token: 'blue', money: 9_000_000 }],
    turn: { currentPlayerId: 'p1', ...turn }, config: { maxPlayers: 4 }, properties: [], activeRentDeal,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('DealPanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('is null when not open and no rent owed / deal', () => {
    base({ mustPayRent: false });
    const { container } = render(<DealPanel />);
    expect(container.firstChild).toBe(null);
  });

  it('offers a GO deduction when I owe rent', () => {
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' });
    useGameStore.getState().toggleDealPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /take 2/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.LOAN_GO_DEDUCTION, { count: 2 });
  });

  it('sends a rent-deal offer to the creditor', () => {
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' });
    useGameStore.getState().toggleDealPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /propose deal|send offer/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_OFFER, expect.objectContaining({
      creditorIds: ['p2'], spaceIndex: 5, totalRentOwed: 3_000_000,
    }));
  });

  it('creditor accepts an active deal (I am not lastOfferBy)', () => {
    base({ mustPayRent: false }, { dealId: 'd1', debtorId: 'p2', creditorIds: ['p1'], spaceIndex: 9, totalRentOwed: 2_000_000, offeredProperties: [], offeredMoney: 1_000_000, requestedExemption: 1_000_000, lastOfferBy: 'p2', acceptedPlayerIds: [], status: 'pending' });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_ACCEPT, { dealId: 'd1' });
  });
});
