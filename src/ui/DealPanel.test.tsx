import { describe, it, expect, beforeEach, vi } from 'vitest';
import { noop, requireDefined } from '../test-utils';
import { render, screen, fireEvent } from '@testing-library/react';
import { DealPanel } from './DealPanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function base(turn: object, activeRentDeal: unknown = null, money = 15_000_000, goUsed = 0, goSkips = 0, properties: unknown[] = []) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money, position: 5, goDeductionsUsed: goUsed, goSkipsRemaining: goSkips },
              { id: 'p2', name: 'Jonas', token: 'blue', money: 9_000_000, goDeductionsUsed: 0, goSkipsRemaining: 0 }],
    turn: { currentPlayerId: 'p1', ...turn }, config: { maxPlayers: 4 }, properties, activeRentDeal,
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
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /take 2/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.LOAN_GO_DEDUCTION, { count: 2 });
  });

  it('sends a rent-deal offer to the creditor', () => {
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' });
    useGameStore.getState().toggleDealPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /propose deal|send offer/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_OFFER, expect.objectContaining({
      creditorIds: ['p2'], spaceIndex: 5, totalRentOwed: 3_000_000,
    }));
  });

  it('creditor accepts an active deal (I am not lastOfferBy)', () => {
    base({ mustPayRent: false }, { dealId: 'd1', debtorId: 'p2', creditorIds: ['p1'], spaceIndex: 9, totalRentOwed: 2_000_000, offeredProperties: [], offeredMoney: 1_000_000, requestedExemption: 1_000_000, lastOfferBy: 'p2', acceptedPlayerIds: [], status: 'pending' });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_ACCEPT, { dealId: 'd1' });
  });

  // ── NEW: counter sends EDITED values, not verbatim ──────────────────────────

  it('Counter button enters edit mode — does NOT immediately emit DEAL_COUNTER', () => {
    base({ mustPayRent: false }, {
      dealId: 'd2', debtorId: 'p1', creditorIds: ['p2'], spaceIndex: 9,
      totalRentOwed: 4_000_000, offeredProperties: [1], offeredMoney: 500_000,
      requestedExemption: 2_000_000, lastOfferBy: 'p2', acceptedPlayerIds: [], status: 'pending',
    });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^counter$/i }));
    // Counter mode UI should show, but no DEAL_COUNTER has been emitted yet
    expect(emit).not.toHaveBeenCalledWith(EVENTS.DEAL_COUNTER, expect.anything());
    expect(screen.getByRole('button', { name: /send counter/i })).toBeTruthy();
  });

  it('Counter edit mode is pre-filled from deal and emits edited values on Send Counter', () => {
    const originalDeal = {
      dealId: 'd3', debtorId: 'p1', creditorIds: ['p2'], spaceIndex: 9,
      totalRentOwed: 4_000_000, offeredProperties: [1], offeredMoney: 500_000,
      requestedExemption: 2_000_000, lastOfferBy: 'p2', acceptedPlayerIds: [], status: 'pending',
    };
    base({ mustPayRent: false }, originalDeal);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);

    // Enter counter mode
    fireEvent.click(screen.getByRole('button', { name: /^counter$/i }));

    // The cash input should be pre-filled with the deal's offeredMoney (500_000)
    const cashInput = screen.getByLabelText(/counter money/i);
    expect((cashInput as HTMLInputElement).value).toBe('500000');

    // Change the cash value to something different
    fireEvent.change(cashInput, { target: { value: '750000' } });

    // Change the exemption to something different
    const exemptInput = screen.getByLabelText(/counter exemption/i);
    fireEvent.change(exemptInput, { target: { value: '1500000' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /send counter/i }));

    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_COUNTER, expect.objectContaining({
      dealId: 'd3',
      offeredMoney: 750_000,
      requestedExemption: 1_500_000,
    }));

    // Crucially: emitted values differ from the original deal values
    const call = requireDefined(emit.mock.calls.find((c) => c[0] === EVENTS.DEAL_COUNTER));
    const payload = call[1] as { offeredMoney: number; requestedExemption: number };
    expect(payload.offeredMoney).not.toBe(500_000);       // edited, not verbatim
    expect(payload.requestedExemption).not.toBe(2_000_000); // edited, not verbatim
  });

  // ── NEW: initial offer can include selected properties ───────────────────────

  it('offer sends offeredProperties: [] when none selected', () => {
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' });
    useGameStore.getState().toggleDealPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /propose deal/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_OFFER, expect.objectContaining({
      offeredProperties: [],
    }));
  });

  it('offer includes property spaceIndex when a property pill is selected', () => {
    // p1 owns property at spaceIndex 1 (Old Kent Road) — eligible: not mortgaged, no buildings
    const properties = [
      { spaceIndex: 1, ownerId: 'p1', isMortgaged: false, houses: 0, hasHotel: false },
    ];
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' }, null, 15_000_000, 0, 0, properties);
    useGameStore.getState().toggleDealPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);

    // Find and click the property toggle button for Old Kent Road
    const propBtn = screen.getByRole('button', { name: /old kent road/i });
    fireEvent.click(propBtn);

    // Now propose the deal
    fireEvent.click(screen.getByRole('button', { name: /propose deal/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_OFFER, expect.objectContaining({
      offeredProperties: [1],
    }));
  });

  it('does NOT show mortgaged or built properties in the offer picker', () => {
    const properties = [
      { spaceIndex: 1, ownerId: 'p1', isMortgaged: true,  houses: 0, hasHotel: false }, // mortgaged → excluded
      { spaceIndex: 3, ownerId: 'p1', isMortgaged: false, houses: 2, hasHotel: false }, // has houses → excluded
      { spaceIndex: 6, ownerId: 'p1', isMortgaged: false, houses: 0, hasHotel: true  }, // has hotel → excluded
      { spaceIndex: 8, ownerId: 'p1', isMortgaged: false, houses: 0, hasHotel: false }, // eligible
    ];
    base({ mustPayRent: true, rentAmount: 2_000_000, rentOwnerId: 'p2' }, null, 15_000_000, 0, 0, properties);
    useGameStore.getState().toggleDealPanel(true);
    render(<DealPanel />);

    // Only Euston Road (spaceIndex 8) should appear as selectable
    expect(screen.queryByRole('button', { name: /old kent road/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /whitechapel/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /the angle islington/i })).toBeNull();
    expect(screen.getByRole('button', { name: /euston road/i })).toBeTruthy();
  });

  // ── NEW: goSkipsRemaining display ────────────────────────────────────────────

  it('shows goSkipsRemaining > 0 under the GO advance section', () => {
    base({ mustPayRent: true, rentAmount: 2_000_000, rentOwnerId: 'p2' }, null, 15_000_000, 2, 3);
    useGameStore.getState().toggleDealPanel(true);
    render(<DealPanel />);
    expect(screen.getByText(/go passes to skip: 3/i)).toBeTruthy();
  });

  it('does NOT show goSkipsRemaining when it is 0', () => {
    base({ mustPayRent: true, rentAmount: 2_000_000, rentOwnerId: 'p2' }, null, 15_000_000, 0, 0);
    useGameStore.getState().toggleDealPanel(true);
    render(<DealPanel />);
    expect(screen.queryByText(/go passes to skip/i)).toBeNull();
  });
});
