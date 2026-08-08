import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { noop, requireDefined } from '../test-utils';
import { AuctionPanel, AUCTION_WINDOW_S } from './AuctionPanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import type { AuctionState, GameState } from '../types/GameState';
import {
  AUCTION_INCREMENTS, AUCTION_MIN_RAISE, composeBid, cushionTone,
  incrementOverflows, isLegalBid, minLegalBid, openingBid,
} from './takeoverMath';

// Pall Mall (index 11, pink, £1.4M) — the mockup's lot.
const LOT = requireDefined(BOARD_SPACES.find((s) => s.name === 'Pall Mall'));

/** Captures the socket listeners the panel registers so a test can drive them. */
function captureSocket() {
  const handlers = new Map<string, ((d: unknown) => void)[]>();
  vi.spyOn(socketManager, 'on').mockImplementation((event: string, cb: (d: never) => void) => {
    const list = handlers.get(event) ?? [];
    list.push(cb as (d: unknown) => void);
    handlers.set(event, list);
  });
  vi.spyOn(socketManager, 'off').mockImplementation(noop);
  const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
  const fire = (event: string, payload: unknown) => {
    act(() => { (handlers.get(event) ?? []).forEach((h) => { h(payload); }); });
  };
  return { emit, fire };
}

function setState(auction: AuctionState | null, money = 4_200_000) {
  useGameStore.getState().update({
    roomCode: 'ABCD',
    status: 'in-progress',
    players: [
      { id: 'p1', name: 'Maya', token: 'blue', money, properties: [], isBankrupt: false },
      { id: 'p2', name: 'Priya', token: 'red', money: 8_600_000, properties: [13], isBankrupt: false },
      { id: 'p3', name: 'Deniz', token: 'green', money: 1_100_000, properties: [], isBankrupt: false },
    ],
    properties: [{ spaceIndex: 13, ownerId: 'p2', houses: 0, hasHotel: false, isMortgaged: false }],
    turn: { currentPlayerId: 'p2', phase: 'action', auctionState: auction },
    config: { maxPlayers: 4 },
    partnerships: [],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

const liveAuction = (over: Partial<AuctionState> = {}): AuctionState => ({
  spaceIndex: LOT.index,
  currentHighBid: 1_600_000,
  currentHighBidderId: 'p2',
  activeBidderIds: ['p1', 'p2', 'p3'],
  status: 'active',
  ...over,
});

// ────────────────────────────────────────────────────────────────────────────
// THE BID-LEGALITY INVARIANT
//
// `GameEngine.canBid` rejects `amount <= currentHighBid` and `amount > money`.
// The pad must be incapable of COMPOSING either one — a rejected bid under a
// running clock is a wasted turn, not just a wasted tap.
// ────────────────────────────────────────────────────────────────────────────
describe('bid legality (pure)', () => {
  it('mirrors GameEngine.canBid exactly', () => {
    expect(isLegalBid(1_700_000, 1_600_000, 4_200_000)).toBe(true);
    expect(isLegalBid(1_600_000, 1_600_000, 4_200_000)).toBe(false); // equal is not a raise
    expect(isLegalBid(1_500_000, 1_600_000, 4_200_000)).toBe(false); // under the high
    expect(isLegalBid(4_300_000, 1_600_000, 4_200_000)).toBe(false); // over your cash
    expect(isLegalBid(4_200_000, 1_600_000, 4_200_000)).toBe(true);  // exactly your cash
    expect(isLegalBid(Number.NaN, 0, 4_200_000)).toBe(false);
  });

  it('opens on the lowest legal raise, so one tap of the primary is always legal', () => {
    const open = requireDefined(openingBid(1_600_000, 4_200_000));
    expect(open).toBe(1_600_000 + AUCTION_MIN_RAISE);
    expect(isLegalBid(open, 1_600_000, 4_200_000)).toBe(true);
  });

  it('falls back to all-in when the min raise is unaffordable but a raise is not', () => {
    // £1.05M against a £1.0M high: the £1.1M min raise is out of reach, £1.05M is not.
    const open = requireDefined(openingBid(1_000_000, 1_050_000));
    expect(open).toBe(1_050_000);
    expect(isLegalBid(open, 1_000_000, 1_050_000)).toBe(true);
  });

  it('reports no legal bid at all when even all-in cannot beat the high', () => {
    expect(openingBid(4_200_000, 4_200_000)).toBeNull();
    expect(openingBid(5_000_000, 4_200_000)).toBeNull();
  });

  it('INVARIANT: no sequence of increments can compose an illegal bid', () => {
    const cases = [
      { high: 0, cash: 15_000_000 },
      { high: 1_600_000, cash: 4_200_000 },
      { high: 1_600_000, cash: 1_650_000 },   // barely able to raise
      { high: 3_900_000, cash: 4_000_000 },
      { high: 100, cash: 400 },               // sub-K amounts
    ];
    for (const { high, cash } of cases) {
      let bid = openingBid(high, cash);
      expect(bid).not.toBeNull();
      // 40 taps, cycling every increment — far past the cash ceiling on purpose.
      for (let i = 0; i < 40; i++) {
        const inc = AUCTION_INCREMENTS[i % AUCTION_INCREMENTS.length];
        const next = composeBid(requireDefined(bid), inc, high, cash);
        bid = next;
        expect(bid).not.toBeNull();
        const v = requireDefined(bid);
        expect(v).toBeLessThanOrEqual(cash);
        expect(v).toBeGreaterThan(high);
        expect(isLegalBid(v, high, cash)).toBe(true);
      }
    }
  });

  it('INVARIANT: a stale increment from before an opponent raise still clamps legal', () => {
    // Composed £1.7M, then a rival jumps the high to £3.0M. The pad re-opens at
    // the new floor rather than sending a now-illegal £1.8M.
    expect(composeBid(1_700_000, AUCTION_MIN_RAISE, 3_000_000, 4_200_000)).toBe(3_100_000);
  });

  it('an increment reports overflow exactly at the cash ceiling', () => {
    expect(incrementOverflows(4_100_000, 100_000, 4_200_000)).toBe(false);
    expect(incrementOverflows(4_100_000, 500_000, 4_200_000)).toBe(true);
  });

  it('the cushion walks text -> warn -> danger as it disappears', () => {
    expect(cushionTone(3_000_000, 4_200_000)).toBe('gain');
    expect(cushionTone(500_000, 4_200_000)).toBe('low');
    expect(cushionTone(0, 4_200_000)).toBe('loss');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// THE PANEL
// ────────────────────────────────────────────────────────────────────────────
describe('AuctionPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useGameStore.getState().reset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stays mounted but closed when there is no auction', () => {
    captureSocket();
    setState(null);
    const { container } = render(<AuctionPanel />);
    const tk = requireDefined(container.querySelector('.kit-takeover'));
    expect(tk.className).not.toContain('is-on');
    expect(tk.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens on an active auction and shows every bidder at once', () => {
    captureSocket();
    setState(liveAuction());
    const { container } = render(<AuctionPanel />);
    expect(requireDefined(container.querySelector('.kit-takeover')).className).toContain('is-on');
    // "You" also labels the set-progress row, so scope to the bidders column.
    const floor = requireDefined(container.querySelectorAll('.kit-takeover__col')[1]);
    expect(floor.textContent).toContain('You');
    expect(floor.textContent).toContain('Priya');
    expect(floor.textContent).toContain('Deniz');
    // Priya holds the high bid; Deniz cannot afford to beat £1.6M with £1.1M.
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('Capped')).toBeTruthy();
  });

  it('marks a player who has left activeBidderIds as PASSED, and says NO RE-ENTRY', () => {
    captureSocket();
    setState(liveAuction({ activeBidderIds: ['p1', 'p2'] }));
    render(<AuctionPanel />);
    expect(screen.getByText('Passed')).toBeTruthy();
    expect(screen.getByText('No re-entry')).toBeTruthy();
  });

  it('has NO close button while live — dismissing would be an implicit pass', () => {
    captureSocket();
    setState(liveAuction());
    render(<AuctionPanel />);
    expect(screen.queryByLabelText('Close')).toBeNull();
  });

  it('opens the pad on the lowest legal raise and bids it in one tap', () => {
    const { emit } = captureSocket();
    setState(liveAuction());
    render(<AuctionPanel />);
    const bid = screen.getByRole('button', { name: /^Bid /i });
    expect(bid.textContent).toContain(formatish(1_700_000));
    fireEvent.click(bid);
    expect(emit).toHaveBeenCalledWith(EVENTS.AUCTION_BID, { amount: 1_700_000 });
  });

  it('disables an increment that would compose a bid over your cash', () => {
    const { emit } = captureSocket();
    // £1.85M cash against a £1.6M high. The pad opens at £1.7M, so +£0.1M fits
    // and the other two do not — an ILLEGAL BID CANNOT BE COMPOSED AT ALL.
    setState(liveAuction(), 1_850_000);
    render(<AuctionPanel />);
    expect((screen.getByRole('button', { name: '+£100K' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '+£500K' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '+£1.000M' }) as HTMLButtonElement).disabled).toBe(true);

    // One legal step to £1.8M, after which every increment is out of reach.
    fireEvent.click(screen.getByRole('button', { name: '+£100K' }));
    expect((screen.getByRole('button', { name: '+£100K' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Bid /i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.AUCTION_BID, { amount: 1_800_000 });
  });

  it('ALL IN can never exceed cash and MIN can never underbid the high', () => {
    const { emit } = captureSocket();
    setState(liveAuction());
    render(<AuctionPanel />);

    fireEvent.click(screen.getByRole('button', { name: /All in/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Bid /i }));
    expect(emit).toHaveBeenLastCalledWith(EVENTS.AUCTION_BID, { amount: 4_200_000 });

    fireEvent.click(screen.getByRole('button', { name: /^Min/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Bid /i }));
    expect(emit).toHaveBeenLastCalledWith(EVENTS.AUCTION_BID, { amount: minLegalBid(1_600_000) });
  });

  it('offers PASS only, and no composable bid, when even all-in cannot beat the high', () => {
    captureSocket();
    setState(liveAuction({ currentHighBid: 4_200_000, currentHighBidderId: 'p2' }), 4_200_000);
    render(<AuctionPanel />);
    expect((screen.getByRole('button', { name: /Cannot raise/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '+£100K' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Pass on this lot/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('PASS is armed — one tap restates the consequence, the second fires', () => {
    const { emit } = captureSocket();
    setState(liveAuction());
    render(<AuctionPanel />);
    const pass = screen.getByRole('button', { name: /Pass on this lot/i });
    fireEvent.click(pass);
    expect(emit).not.toHaveBeenCalledWith(EVENTS.AUCTION_PASS);
    expect(pass.className).toContain('is-armed');
    fireEvent.click(pass);
    expect(emit).toHaveBeenCalledWith(EVENTS.AUCTION_PASS);
  });

  it('cannot pass on your own high bid, and the primary waits instead of bidding', () => {
    captureSocket();
    setState(liveAuction({ currentHighBidderId: 'p1' }));
    render(<AuctionPanel />);
    expect((screen.getByRole('button', { name: /Pass on this lot/i }) as HTMLButtonElement).disabled).toBe(true);
    const primary = screen.getByRole('button', { name: /You are high/i });
    expect(primary.className).toContain('is-waiting');
    expect(primary.getAttribute('data-clock')).toBeTruthy();
  });

  it('the primary IS the clock: it counts down and goes urgent in the last 5s', () => {
    captureSocket();
    setState(liveAuction());
    render(<AuctionPanel />);
    expect(screen.getByRole('button', { name: /^Bid /i }).getAttribute('data-clock')).toBe('warn');
    act(() => { vi.advanceTimersByTime((AUCTION_WINDOW_S - 5) * 1000); });
    expect(screen.getByRole('button', { name: /^Bid /i }).getAttribute('data-clock')).toBe('urgent');
  });

  it('a rival bid resets the clock and re-opens the pad on the new legal floor', () => {
    const { emit, fire } = captureSocket();
    setState(liveAuction());
    const { rerender } = render(<AuctionPanel />);
    act(() => { vi.advanceTimersByTime(4000); });

    fire(EVENTS.PROPERTY_AUCTION_BID, { playerId: 'p2', amount: 3_000_000 });
    act(() => { setState(liveAuction({ currentHighBid: 3_000_000 })); });
    rerender(<AuctionPanel />);

    fireEvent.click(screen.getByRole('button', { name: /^Bid /i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.AUCTION_BID, { amount: 3_100_000 });
    // Clock restarted, not resumed from 4s in.
    expect(screen.getByRole('button', { name: /^Bid /i }).textContent).toContain(String(AUCTION_WINDOW_S));
  });

  it('an expired window passes for you — but never for the standing high bidder', () => {
    const { emit } = captureSocket();

    // Holding the high bid: the clock runs out and NOTHING happens. Auto-passing
    // your own winning bid would strand the lot.
    setState(liveAuction({ currentHighBidderId: 'p1' }));
    const held = render(<AuctionPanel />);
    act(() => { vi.advanceTimersByTime((AUCTION_WINDOW_S + 2) * 1000); });
    expect(emit).not.toHaveBeenCalledWith(EVENTS.AUCTION_PASS);
    held.unmount();

    // Not the high bidder: the window closing IS the pass, which is what lets
    // the standing high bid win instead of the table deadlocking on an AFK seat.
    setState(liveAuction({ currentHighBidderId: 'p2' }));
    render(<AuctionPanel />);
    act(() => { vi.advanceTimersByTime((AUCTION_WINDOW_S + 2) * 1000); });
    expect(emit).toHaveBeenCalledWith(EVENTS.AUCTION_PASS);
  });

  it('settles into the WON state off PROPERTY_AUCTION_WON, which state no longer carries', () => {
    const { fire } = captureSocket();
    setState(liveAuction());
    const { container, rerender } = render(<AuctionPanel />);

    // completeAuction() nulls turn.auctionState, so only the event survives.
    fire(EVENTS.PROPERTY_AUCTION_WON, { playerId: 'p2', spaceIndex: LOT.index, amount: 2_200_000 });
    act(() => { setState(null); });
    rerender(<AuctionPanel />);

    expect(requireDefined(container.querySelector('.kit-takeover')).className).toContain('is-on');
    expect(screen.getByText(/Priya takes Pall Mall/i)).toBeTruthy();
    // A settled auction is a receipt and CAN be dismissed.
    expect(screen.getByLabelText('Close')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back to board/i }));
    expect(requireDefined(container.querySelector('.kit-takeover')).className).not.toContain('is-on');
  });
});

/** formatMoney's shape for a whole-million amount, for label assertions. */
function formatish(n: number): string {
  return `£${(n / 1_000_000).toFixed(3)}M`;
}
