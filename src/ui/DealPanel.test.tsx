import { describe, it, expect, beforeEach, vi } from 'vitest';
import { noop, requireDefined } from '../test-utils';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DealPanel } from './DealPanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

/** DealPanel mounts two takeovers: the deal itself, then the GO borrow flow. */
function surfaces(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.kit-takeover'));
}
const deals = () => requireDefined(surfaces()[0]);
const go = () => requireDefined(surfaces()[1]);
const openOf = (el: HTMLElement) => el.getAttribute('aria-hidden') === 'false';

function base(
  turn: object,
  activeRentDeal: unknown = null,
  money = 15_000_000,
  goUsed = 0,
  goSkips = 0,
  properties: unknown[] = [],
) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [
      { id: 'p1', name: 'Maya', token: 'red', money, position: 5, goDeductionsUsed: goUsed, goSkipsRemaining: goSkips },
      { id: 'p2', name: 'Jonas', token: 'blue', money: 9_000_000, goDeductionsUsed: 0, goSkipsRemaining: 0 },
    ],
    turn: { currentPlayerId: 'p1', ...turn }, config: { maxPlayers: 4 }, properties, activeRentDeal,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('DealPanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('stays mounted but closed when no rent is owed and no deal is live', () => {
    base({ mustPayRent: false });
    render(<DealPanel />);
    expect(surfaces()).toHaveLength(2);
    expect(openOf(deals())).toBe(false);
    expect(openOf(go())).toBe(false);
  });

  it('sends a rent-deal offer to the creditor', () => {
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' });
    useGameStore.getState().toggleDealPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /propose deal/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_OFFER, expect.objectContaining({
      creditorIds: ['p2'], spaceIndex: 5, totalRentOwed: 3_000_000,
    }));
  });

  it('offer sends offeredProperties: [] when none selected', () => {
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' });
    useGameStore.getState().toggleDealPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /propose deal/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_OFFER, expect.objectContaining({ offeredProperties: [] }));
  });

  it('offer includes property spaceIndex when a property chip is selected', () => {
    const properties = [{ spaceIndex: 1, ownerId: 'p1', isMortgaged: false, houses: 0, hasHotel: false }];
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' }, null, 15_000_000, 0, 0, properties);
    useGameStore.getState().toggleDealPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);

    // The chip's accessible name is the FULL board name, even though the
    // visible label abbreviates the suffix to fit a 92px two-line box.
    fireEvent.click(screen.getByRole('button', { name: /old kent road/i }));
    fireEvent.click(screen.getByRole('button', { name: /propose deal/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_OFFER, expect.objectContaining({ offeredProperties: [1] }));
  });

  it('does NOT show mortgaged or built properties in the offer picker', () => {
    const properties = [
      { spaceIndex: 1, ownerId: 'p1', isMortgaged: true, houses: 0, hasHotel: false },
      { spaceIndex: 3, ownerId: 'p1', isMortgaged: false, houses: 2, hasHotel: false },
      { spaceIndex: 6, ownerId: 'p1', isMortgaged: false, houses: 0, hasHotel: true },
      { spaceIndex: 8, ownerId: 'p1', isMortgaged: false, houses: 0, hasHotel: false },
    ];
    base({ mustPayRent: true, rentAmount: 2_000_000, rentOwnerId: 'p2' }, null, 15_000_000, 0, 0, properties);
    useGameStore.getState().toggleDealPanel(true);
    render(<DealPanel />);
    expect(screen.queryByRole('button', { name: /old kent road/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /whitechapel/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /the angle islington/i })).toBeNull();
    expect(screen.getByRole('button', { name: /euston road/i })).toBeTruthy();
  });

  it('opens on a deal that already clears the rent, and only nags once you break it', () => {
    // £6M owed against £4.2M of cash. Composing from zero would open on a red
    // "SHORT BY £6.00M" — a callout blaming you for not having used the
    // control yet. It seeds instead: all the cash you can pay (snapped onto
    // the stepper's grid) plus an exemption for the rest.
    base({ mustPayRent: true, rentAmount: 6_000_000, rentOwnerId: 'p2' }, null, 4_200_000);
    useGameStore.getState().toggleDealPanel(true);
    render(<DealPanel />);
    expect(screen.getByText(/exactly covered/i)).toBeTruthy();
    expect(screen.queryByText(/short by/i)).toBeNull();

    // Ask for less forgiveness than you can cover and it says so, loudly.
    const slider = screen.getByLabelText(/rent exemption requested/i);
    fireEvent.change(slider, { target: { value: '500000' } });
    expect(screen.getByText(/short by/i)).toBeTruthy();
  });

  // ── GAP 3: the GO advance had no UI at all ───────────────────────────────

  it('offers a GO advance beside the deal, and emits LOAN_GO_DEDUCTION with the chosen count', () => {
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' });
    useGameStore.getState().toggleDealPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);

    expect(openOf(go())).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /borrow against go/i }));
    expect(openOf(go())).toBe(true);

    // A wide stepper, NOT five segments: five 44px segs plus their gaps
    // measure 274px against 232px of column.
    const stepper = requireDefined(go().querySelector<HTMLElement>('.kit-stepper'));
    fireEvent.click(within(stepper).getByRole('button', { name: 'More' }));

    // <Hold>, because the lifetime cap is never refunded. Enter is the
    // keyboard-parity path.
    fireEvent.keyDown(requireDefined(go().querySelector<HTMLElement>('.kit-hold')), { key: 'Enter' });
    expect(emit).toHaveBeenCalledWith(EVENTS.LOAN_GO_DEDUCTION, { count: 2 });
  });

  it('caps the GO stepper at the lifetime allowance the server enforces', () => {
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' }, null, 15_000_000, 4, 1);
    useGameStore.getState().toggleDealPanel(true);
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /borrow against go/i }));

    const stepper = requireDefined(go().querySelector<HTMLElement>('.kit-stepper'));
    const more = within(stepper).getByRole('button', { name: 'More' }) as HTMLButtonElement;
    // 4 of 5 used, so exactly one is left and + is already dead.
    expect(more.disabled).toBe(true);
    expect(within(go()).getByText(/5 of 5/i)).toBeTruthy();
  });

  it('hides the borrow entry point once the lifetime cap is spent', () => {
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' }, null, 15_000_000, 5, 0);
    useGameStore.getState().toggleDealPanel(true);
    render(<DealPanel />);
    expect(screen.queryByRole('button', { name: /borrow against go/i })).toBeNull();
  });

  // ── GAP 3b: the tracker. An active loan must be impossible to forget ─────

  it('shows the GO-advance tracker in the head whenever a loan is running', () => {
    base({ mustPayRent: true, rentAmount: 2_000_000, rentOwnerId: 'p2' }, null, 15_000_000, 3, 2);
    useGameStore.getState().toggleDealPanel(true);
    render(<DealPanel />);
    const pill = requireDefined(deals().querySelector<HTMLElement>('.rn-golock'));
    expect(pill.textContent).toMatch(/go advance/i);
    expect(pill.textContent).toMatch(/2 skips left/i);
    // Hatched pips for passes already consumed, lit for salaries still owed.
    expect(pill.querySelectorAll('.rn-pip-spent')).toHaveLength(1);
    expect(pill.querySelectorAll('.rn-pip-due')).toHaveLength(2);
  });

  it('does NOT show the tracker for a player who has never taken an advance', () => {
    base({ mustPayRent: true, rentAmount: 2_000_000, rentOwnerId: 'p2' }, null, 15_000_000, 0, 0);
    useGameStore.getState().toggleDealPanel(true);
    render(<DealPanel />);
    expect(deals().querySelector('.rn-golock')).toBeNull();
  });

  // ── whose move ───────────────────────────────────────────────────────────

  it('creditor accepts an active deal through an explicit confirm', () => {
    base({ mustPayRent: false }, {
      dealId: 'd1', debtorId: 'p2', creditorIds: ['p1'], spaceIndex: 9, totalRentOwed: 2_000_000,
      offeredProperties: [], offeredMoney: 1_000_000, requestedExemption: 1_000_000,
      lastOfferBy: 'p2', acceptedPlayerIds: [], status: 'pending',
    });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);

    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    expect(emit).not.toHaveBeenCalled();
    const plate = requireDefined(document.querySelector<HTMLElement>('.rn-confirm'));
    expect(plate.className).toContain('is-on');
    fireEvent.click(within(plate).getByRole('button', { name: /accept deal/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_ACCEPT, { dealId: 'd1' });
  });

  it('lastOfferBy decides whose move it is, in four channels at once', () => {
    // I made the standing offer, so it is on Jonas and nothing here is mine
    // to act on — which is exactly what dealHandlers.ts enforces.
    base({ mustPayRent: false }, {
      dealId: 'd9', debtorId: 'p1', creditorIds: ['p2'], spaceIndex: 9, totalRentOwed: 4_000_000,
      offeredProperties: [], offeredMoney: 1_000_000, requestedExemption: 2_000_000,
      lastOfferBy: 'p1', acceptedPlayerIds: [], status: 'pending',
    });
    render(<DealPanel />);
    expect(screen.getByText(/last offer by maya/i)).toBeTruthy();  // 1 eyebrow
    expect(screen.getByText(/awaiting jonas/i)).toBeTruthy();      // 2 title
    expect(screen.getByText(/jonas's move/i)).toBeTruthy();        // 3 strip
    const primary = requireDefined(deals().querySelector('.kit-btn--primary'));
    expect(primary.className).toContain('is-waiting');             // 4 button
    expect(screen.queryByRole('button', { name: /^accept$/i })).toBeNull();
  });

  it('Counter enters edit mode and sends the EDITED values, not the original', () => {
    base({ mustPayRent: false }, {
      dealId: 'd3', debtorId: 'p1', creditorIds: ['p2'], spaceIndex: 9,
      totalRentOwed: 4_000_000, offeredProperties: [], offeredMoney: 500_000,
      requestedExemption: 2_000_000, lastOfferBy: 'p2', acceptedPlayerIds: [], status: 'pending',
    });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);

    fireEvent.click(screen.getByRole('button', { name: /^counter$/i }));
    expect(emit).not.toHaveBeenCalledWith(EVENTS.DEAL_COUNTER, expect.anything());
    expect(screen.getByRole('button', { name: /send counter/i })).toBeTruthy();

    // Pre-filled from the standing deal — nobody retypes a proposal to change
    // one line of it. Then edit both figures through the real controls.
    const slider = screen.getByLabelText(/rent exemption requested/i) as HTMLInputElement;
    expect(Number(slider.value)).toBe(2_000_000);
    fireEvent.change(slider, { target: { value: '1500000' } });

    const cashStepper = requireDefined(document.querySelector<HTMLElement>('.rn-step'));
    fireEvent.click(within(cashStepper).getByRole('button', { name: 'More' }));

    fireEvent.click(screen.getByRole('button', { name: /send counter/i }));
    const call = requireDefined(emit.mock.calls.find((c) => c[0] === EVENTS.DEAL_COUNTER));
    const payload = call[1] as { dealId: string; offeredMoney: number; requestedExemption: number };
    expect(payload.dealId).toBe('d3');
    expect(payload.requestedExemption).toBe(1_500_000);
    expect(payload.requestedExemption).not.toBe(2_000_000);
    expect(payload.offeredMoney).not.toBe(500_000);
  });

  // ── GAP 6 ────────────────────────────────────────────────────────────────

  it('the receiving side can say "need more" without opening a counter', () => {
    base({ mustPayRent: false }, {
      dealId: 'd4', debtorId: 'p2', creditorIds: ['p1'], spaceIndex: 9, totalRentOwed: 2_000_000,
      offeredProperties: [], offeredMoney: 1_000_000, requestedExemption: 1_000_000,
      lastOfferBy: 'p2', acceptedPlayerIds: [], status: 'pending',
    });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /need more/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_COUNTER, expect.objectContaining({
      dealId: 'd4', requestedExemption: 500_000,
    }));
  });

  it('rejecting a deal takes two taps on an Arm', () => {
    base({ mustPayRent: false }, {
      dealId: 'd5', debtorId: 'p2', creditorIds: ['p1'], spaceIndex: 9, totalRentOwed: 2_000_000,
      offeredProperties: [], offeredMoney: 1_000_000, requestedExemption: 1_000_000,
      lastOfferBy: 'p2', acceptedPlayerIds: [], status: 'pending',
    });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<DealPanel />);
    const arm = requireDefined(document.querySelector<HTMLElement>('.kit-arm'));
    fireEvent.click(arm);
    expect(emit).not.toHaveBeenCalled();
    fireEvent.click(arm);
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_REJECT, { dealId: 'd5' });
  });
});
