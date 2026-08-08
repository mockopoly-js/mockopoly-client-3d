import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { noop, requireDefined } from '../test-utils';
import { BankruptcyPanel } from './BankruptcyPanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import type { GameState, PropertyState, TurnState } from '../types/GameState';
import {
  blockedReason, buildingsRemaining, raisedPct, raisedTotal, receiptLine,
  shortfall, toggleAsset, type LiquidationAsset,
} from './takeoverMath';

const OLD_KENT = requireDefined(BOARD_SPACES.find((s) => s.name === 'Old Kent Road'));      // £600K / mort £300K
const WHITECHAPEL = requireDefined(BOARD_SPACES.find((s) => s.name === 'Whitechapel Road')); // £600K / mort £300K
const MAYFAIR = requireDefined(BOARD_SPACES.find((s) => s.name === 'Mayfair'));              // £4.0M / mort £2.0M / house £20M

/** house/hotel refunds are FULL price under this game's rules. */
const OLD_KENT_HOUSE = requireDefined(OLD_KENT.houseCost);

function mkAssets(): LiquidationAsset[] {
  return [
    { id: 'hotel-1', kind: 'hotel', spaceIndex: 1, name: 'Old Kent Road', tag: 'HOTEL', verb: 'hotel', color: '#8d5a3c', value: OLD_KENT_HOUSE },
    { id: 'house-1-2', kind: 'house', spaceIndex: 1, name: 'Old Kent Road', tag: 'H2', verb: 'house 2', color: '#8d5a3c', value: OLD_KENT_HOUSE, storey: 2 },
    { id: 'house-1-1', kind: 'house', spaceIndex: 1, name: 'Old Kent Road', tag: 'H1', verb: 'house 1', color: '#8d5a3c', value: OLD_KENT_HOUSE, storey: 1 },
    { id: 'mortgage-1', kind: 'mortgage', spaceIndex: 1, name: 'Old Kent Road', tag: '', verb: 'mortgage', color: '#8d5a3c', value: 300_000 },
    { id: 'transfer-1', kind: 'transfer', spaceIndex: 1, name: 'Old Kent Road', tag: '', verb: 'given', color: '#8d5a3c', value: 600_000 },
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// THE SHORTFALL CALCULATION
// ────────────────────────────────────────────────────────────────────────────
describe('shortfall (pure)', () => {
  it('is debt minus everything you can put against it', () => {
    expect(shortfall(6_000_000, 4_200_000, 0)).toBe(1_800_000);
    expect(shortfall(6_000_000, 4_200_000, 1_000_000)).toBe(800_000);
    expect(shortfall(6_000_000, 4_200_000, 1_800_000)).toBe(0);
  });

  it('goes NEGATIVE once you overshoot — that is the SOLVENT · SPARE reading', () => {
    // Not clamped: a clamped shortfall could only ever say "£0" and the head
    // would have nothing to put beside "SOLVENT · SPARE".
    expect(shortfall(6_000_000, 4_200_000, 2_200_000)).toBe(-400_000);
  });

  it('counts a transfer and a sale identically — both close the same gap', () => {
    const assets = mkAssets();
    const sold = new Set(['hotel-1']);
    const given = new Set(['transfer-1']);
    expect(raisedTotal(assets, sold)).toBe(OLD_KENT_HOUSE);
    expect(raisedTotal(assets, given)).toBe(600_000);
    expect(raisedTotal(assets, new Set([...sold, ...given]))).toBe(OLD_KENT_HOUSE + 600_000);
    expect(raisedTotal(assets, new Set<string>())).toBe(0);
  });

  it('the meter tracks money raised against money NEEDED, not against the debt', () => {
    // £6.0M owed with £4.2M in hand needs £1.8M, so £0.9M is halfway.
    expect(raisedPct(6_000_000, 4_200_000, 0)).toBe(0);
    expect(raisedPct(6_000_000, 4_200_000, 900_000)).toBe(50);
    expect(raisedPct(6_000_000, 4_200_000, 1_800_000)).toBe(100);
    expect(raisedPct(6_000_000, 4_200_000, 9_000_000)).toBe(100); // clamped, unlike the number
    expect(raisedPct(1_000_000, 4_200_000, 0)).toBe(100);         // no shortfall at all
  });

  it('the receipt names two and COMPUTES the overflow — never a line clamp', () => {
    const assets = mkAssets();
    expect(receiptLine(assets, new Set<string>())).toBe('NOTHING SELECTED');
    expect(receiptLine(assets, new Set(['hotel-1']))).toBe('Old Kent Road hotel');
    expect(receiptLine(assets, new Set(['hotel-1', 'house-1-2', 'house-1-1', 'mortgage-1'])))
      .toBe('Old Kent Road hotel, Old Kent Road house 2  +2 more');
  });
});

describe('liquidation dependencies (pure)', () => {
  it('a house cannot be sold while its hotel stands', () => {
    const assets = mkAssets();
    expect(blockedReason(requireDefined(assets.find((a) => a.id === 'house-1-2')), assets, new Set<string>())).toBe('SELL HOTEL');
    expect(blockedReason(requireDefined(assets.find((a) => a.id === 'house-1-2')), assets, new Set(['hotel-1']))).toBeNull();
  });

  it('houses come off top-down', () => {
    const assets = mkAssets();
    const sel = new Set(['hotel-1']);
    expect(blockedReason(requireDefined(assets.find((a) => a.id === 'house-1-1')), assets, sel)).toBe('TOP FIRST');
    sel.add('house-1-2');
    expect(blockedReason(requireDefined(assets.find((a) => a.id === 'house-1-1')), assets, sel)).toBeNull();
  });

  it('a property with a building on it can be neither mortgaged nor given away', () => {
    const assets = mkAssets();
    const none = new Set<string>();
    expect(blockedReason(requireDefined(assets.find((a) => a.id === 'mortgage-1')), assets, none)).toBe('SELL HOUSES');
    expect(blockedReason(requireDefined(assets.find((a) => a.id === 'transfer-1')), assets, none)).toBe('SELL HOUSES');

    const cleared = new Set(['hotel-1', 'house-1-2', 'house-1-1']);
    expect(buildingsRemaining(assets, cleared, 1)).toBe(0);
    expect(blockedReason(requireDefined(assets.find((a) => a.id === 'mortgage-1')), assets, cleared)).toBeNull();
  });

  it('mortgage and give are mutually exclusive on one property', () => {
    const assets = mkAssets();
    const cleared = new Set(['hotel-1', 'house-1-2', 'house-1-1', 'mortgage-1']);
    expect(blockedReason(requireDefined(assets.find((a) => a.id === 'transfer-1')), assets, cleared)).toBe('MORTGAGED');
  });

  it('un-selling a building cascades off whatever that sale unlocked', () => {
    const assets = mkAssets();
    let sel: ReadonlySet<string> = new Set(['hotel-1', 'house-1-2', 'house-1-1', 'mortgage-1']);
    expect(raisedTotal(assets, sel)).toBe(OLD_KENT_HOUSE * 3 + 300_000);

    // Put the top house back: the mortgage it unlocked must come off too, or the
    // tally would be counting a move the server will refuse.
    sel = toggleAsset(assets, sel, 'house-1-1');
    expect(sel.has('mortgage-1')).toBe(false);
    expect(raisedTotal(assets, sel)).toBe(OLD_KENT_HOUSE * 2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// THE PANEL
// ────────────────────────────────────────────────────────────────────────────
function setState(over: {
  money?: number;
  turn?: Partial<TurnState>;
  properties?: PropertyState[];
  myProps?: number[];
  bankrupt?: boolean;
} = {}) {
  const myProps = over.myProps ?? [OLD_KENT.index, WHITECHAPEL.index, MAYFAIR.index];
  useGameStore.getState().update({
    roomCode: 'ABCD',
    status: 'in-progress',
    players: [
      { id: 'p1', name: 'Maya', token: 'blue', money: over.money ?? 4_200_000, properties: myProps, isBankrupt: over.bankrupt ?? false },
      { id: 'p2', name: 'Priya', token: 'red', money: 8_600_000, properties: [], isBankrupt: false },
      { id: 'p3', name: 'Deniz', token: 'green', money: 1_100_000, properties: [], isBankrupt: false },
    ],
    properties: over.properties ?? myProps.map((i) => ({ spaceIndex: i, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false })),
    turn: {
      currentPlayerId: 'p1', phase: 'action', mustPayRent: true,
      rentAmount: 6_000_000, rentOwnerId: 'p2', auctionState: null,
      ...over.turn,
    },
    config: { maxPlayers: 4 },
    partnerships: [],
    log: [],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('BankruptcyPanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('stays mounted but closed until it is opened', () => {
    setState();
    const { container } = render(<BankruptcyPanel open={false} />);
    expect(requireDefined(container.querySelector('.kit-takeover')).className).not.toContain('is-on');
  });

  it('leads with the shortfall, in the head, ABOVE every scroll region', () => {
    setState();
    const { container } = render(<BankruptcyPanel open />);
    const head = requireDefined(container.querySelector('.kit-takeover__head'));
    const body = requireDefined(container.querySelector('.kit-takeover__body'));

    expect(head.textContent).toContain('Still short');
    expect(head.textContent).toContain('1.800');   // £6.0M owed - £4.2M held
    expect(head.textContent).toContain('Raise');
    // The number is NOT inside the body, so no growing list can push it down
    // and no scroll can take it away.
    expect(body.textContent).not.toContain('Still short');
    expect(body.textContent).not.toContain('Raise £');
  });

  it('recomputes the shortfall live as assets are picked, and flips to SOLVENT', () => {
    // Old Kent Road mortgages for £300K; Mayfair for £2.0M, which alone covers
    // the £1.8M gap.
    setState();
    const { container } = render(<BankruptcyPanel open />);
    const head = () => requireDefined(container.querySelector('.kit-takeover__head')).textContent;

    fireEvent.click(screen.getByRole('button', { name: /Old Kent Road — mortgage/i }));
    expect(head()).toContain('Still short');
    expect(head()).toContain('1.500');

    fireEvent.click(screen.getByRole('button', { name: /Mayfair — mortgage/i }));
    expect(head()).toContain('Solvent');
    expect(head()).toContain('500');    // £0.5M spare
  });

  it('the PAY primary is dead until the shortfall is covered', () => {
    setState();
    render(<BankruptcyPanel open />);
    const pay = () => screen.getByRole('button', { name: /Pay Priya/i }) as HTMLButtonElement;
    expect(pay().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Mayfair — mortgage/i }));
    expect(pay().disabled).toBe(false);
  });

  it('has NO close ✕ — a debt cannot be dismissed', () => {
    setState();
    render(<BankruptcyPanel open />);
    expect(screen.queryByLabelText('Close')).toBeNull();
  });

  it('states the full-price house rule, and a building chip is worth its full cost', () => {
    setState({
      properties: [
        { spaceIndex: OLD_KENT.index, ownerId: 'p1', houses: 2, hasHotel: false, isMortgaged: false },
        { spaceIndex: WHITECHAPEL.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
        { spaceIndex: MAYFAIR.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
      ],
    });
    render(<BankruptcyPanel open />);
    expect(screen.getByText('Full price')).toBeTruthy();
    expect(screen.getByText(/A building sells back for exactly what it cost/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Old Kent Road — sell house 2/i })).toBeTruthy();
  });

  it('blocks a mortgage behind its buildings, and unlocks it when they are sold', () => {
    setState({
      properties: [
        { spaceIndex: OLD_KENT.index, ownerId: 'p1', houses: 1, hasHotel: false, isMortgaged: false },
        { spaceIndex: WHITECHAPEL.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
        { spaceIndex: MAYFAIR.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
      ],
    });
    render(<BankruptcyPanel open />);
    const mortgage = () => screen.getByRole('button', { name: /Old Kent Road — mortgage/i }) as HTMLButtonElement;
    expect(mortgage().disabled).toBe(true);
    expect(mortgage().textContent).toContain('SELL HOUSES');

    fireEvent.click(screen.getByRole('button', { name: /Old Kent Road — sell house 1/i }));
    expect(mortgage().disabled).toBe(false);
  });

  it('commits in the server\'s own order and settles with BANKRUPTCY_TRANSFER_ASSETS', () => {
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    setState({
      // Selling 1 house (£500K, full-price refund) + giving away Whitechapel
      // (£600K face value) raises £1.1M — bump money so that's enough to
      // clear the £6.0M rent debt (default £4.2M would need £1.8M raised).
      money: 4_950_000,
      properties: [
        { spaceIndex: OLD_KENT.index, ownerId: 'p1', houses: 1, hasHotel: false, isMortgaged: false },
        { spaceIndex: WHITECHAPEL.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
        { spaceIndex: MAYFAIR.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
      ],
    });
    render(<BankruptcyPanel open />);
    fireEvent.click(screen.getByRole('button', { name: /Old Kent Road — sell house 1/i }));
    fireEvent.click(screen.getByRole('button', { name: /Whitechapel Road — give away/i }));
    fireEvent.click(screen.getByRole('button', { name: /Pay Priya/i }));

    // An explicit confirm, and it is NOT a nested modal — there is a way back.
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Back$/i })).toBeTruthy();
    expect(emit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/i }));
    const events = emit.mock.calls.map((c) => c[0]);
    expect(events).toEqual([EVENTS.BUILD_SELL_HOUSE, EVENTS.BANKRUPTCY_TRANSFER_ASSETS]);
    expect(emit.mock.calls[0][1]).toEqual({ spaceIndex: OLD_KENT.index });
    expect(emit.mock.calls[1][1]).toEqual({
      toPlayerId: 'p2',
      properties: [WHITECHAPEL.index],
      // The gift cancels its own face value, so only the remainder is cash.
      money: 6_000_000 - (WHITECHAPEL.price ?? 0),
    });
  });

  it('BACK leaves the confirm without firing anything', () => {
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    setState();
    render(<BankruptcyPanel open />);
    fireEvent.click(screen.getByRole('button', { name: /Mayfair — mortgage/i }));
    fireEvent.click(screen.getByRole('button', { name: /Pay Priya/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Back$/i }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it('I CAN\'T PAY is armed and ~a column away from the primary', () => {
    setState();
    render(<BankruptcyPanel open />);
    const fold = screen.getByRole('button', { name: /I can't pay/i });
    fireEvent.click(fold);
    expect(fold.className).toContain('is-armed');
    // Still the workbench until the second tap.
    expect(screen.queryByText('Settling up')).toBeNull();
    fireEvent.click(fold);
    expect(screen.getByText('Settling up')).toBeTruthy();
  });

  it('the forced state has dignity: it credits what you built and offers a way back', () => {
    setState();
    render(<BankruptcyPanel open />);
    fireEvent.click(screen.getByRole('button', { name: /I can't pay/i }));
    fireEvent.click(screen.getByRole('button', { name: /I can't pay/i }));

    expect(screen.getByText('Settling up')).toBeTruthy();
    expect(screen.getByText('Final position')).toBeTruthy();
    // Old Kent + Whitechapel IS the brown set, so the screen says so — the
    // credit is derived from real state, never a stock consolation string.
    expect(screen.getByText(/You built the brown monopoly/i)).toBeTruthy();
    expect(screen.getByText('Spectating')).toBeTruthy();
    // A mis-tap must be recoverable.
    fireEvent.click(screen.getByRole('button', { name: /Back — let me try again/i }));
    expect(screen.queryByText('Settling up')).toBeNull();
  });

  it('SETTLE UP confirms, then declares — and the confirm can be escaped', () => {
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    setState();
    render(<BankruptcyPanel open />);
    fireEvent.click(screen.getByRole('button', { name: /I can't pay/i }));
    fireEvent.click(screen.getByRole('button', { name: /I can't pay/i }));
    fireEvent.click(screen.getByRole('button', { name: /Settle up/i }));
    expect(screen.getByText(/Everything to Priya/i)).toBeTruthy();
    expect(emit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.BANKRUPTCY_DECLARE);
  });

  it('credits the holdings instead when there was no monopoly to credit', () => {
    setState({ myProps: [OLD_KENT.index, MAYFAIR.index] });
    render(<BankruptcyPanel open />);
    fireEvent.click(screen.getByRole('button', { name: /I can't pay/i }));
    fireEvent.click(screen.getByRole('button', { name: /I can't pay/i }));
    expect(screen.getByText(/You held 2 properties/i)).toBeTruthy();
  });

  it('with nothing to liquidate there is no workbench, only the settlement', () => {
    setState({ myProps: [], properties: [] });
    render(<BankruptcyPanel open />);
    expect(screen.getByText('Settling up')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /I can't pay/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Back — let me try again/i })).toBeNull();
  });
});
