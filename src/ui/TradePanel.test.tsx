import { describe, it, expect, beforeEach, vi } from 'vitest';
import { noop, requireDefined } from '../test-utils';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TradePanel } from './TradePanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import type { GameState } from '../types/GameState';

const mineProp = requireDefined(BOARD_SPACES.find((s) => s.type === 'property')).index;
const theirProp = BOARD_SPACES.filter((s) => s.type === 'property')[3].index;
/** Bow Street / Marlborough / Vine — a complete orange set, for the verdict. */
const ORANGE = [16, 18, 19];

/**
 * The takeover stays MOUNTED when it is closed (the kit forbids conditionally
 * rendering it — a surface that unmounts can never play its exit), so "closed"
 * is asserted on aria-hidden, not on a null container.
 */
function dialog(): HTMLElement {
  return requireDefined(document.querySelector<HTMLElement>('.kit-takeover'));
}
const isOpen = () => dialog().getAttribute('aria-hidden') === 'false';

function base(activeTrade: unknown = null, over: Partial<GameState> = {}) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [
      { id: 'p1', name: 'Maya', token: 'red', money: 15_000_000, isBankrupt: false, jailCardCount: 1 },
      { id: 'p2', name: 'Jonas', token: 'blue', money: 15_000_000, isBankrupt: false, jailCardCount: 0 },
    ],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 },
    properties: [
      { spaceIndex: mineProp, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
      { spaceIndex: theirProp, ownerId: 'p2', houses: 0, hasHotel: false, isMortgaged: false },
    ],
    activeTrade,
    ...over,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('TradePanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('stays mounted but closed when there is nothing to negotiate', () => {
    base();
    render(<TradePanel />);
    // Mounted (the kit forbids conditionally rendering a Takeover) but inert.
    expect(dialog()).toBeTruthy();
    expect(isOpen()).toBe(false);
    expect(dialog().className).not.toContain('is-on');
  });

  it('the takeover is wrapped in the layer that gives it a positioned ancestor', () => {
    // GOTCHA 1: kit surfaces are position:absolute and App.tsx mounts these
    // panels as bare fragment siblings, so an unwrapped .kit-takeover would
    // resolve against <body>. The layer's own geometry contract (fixed /
    // inset:0 / z / pointer-events:none) is asserted against the stylesheet in
    // rules/negotiation.test.ts, because jsdom does not load CSS.
    base();
    render(<TradePanel />);
    const layer = requireDefined(document.querySelector<HTMLElement>('.rn-layer'));
    expect(layer.contains(dialog())).toBe(true);
    expect(layer.parentElement?.tagName).toBe('DIV'); // the RTL container
  });

  it('proposal form emits TRADE_OFFER with selected items', () => {
    base();
    useGameStore.getState().toggleTradePanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TradePanel />);
    // The opponent picker is a <Segs>, a radiogroup — it caps at 4 and max
    // players is 4, so at most 3 opponents always fit.
    fireEvent.click(screen.getByRole('radio', { name: /jonas/i }));
    fireEvent.click(screen.getByTestId(`offer-${String(mineProp)}`));
    fireEvent.click(screen.getByTestId(`request-${String(theirProp)}`));
    fireEvent.click(screen.getByRole('button', { name: /send offer/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_OFFER, expect.objectContaining({
      toPlayerId: 'p2', offeredProperties: [mineProp], requestedProperties: [theirProp],
      offeredMoney: 0, requestedMoney: 0, offeredJailCards: 0, requestedJailCards: 0,
    }));
  });

  // ── GAP 2: jail cards were hard-coded to 0 and surfaced nowhere ──────────

  it('offers a Get Out of Jail Free card as a tradeable asset', () => {
    base();
    useGameStore.getState().toggleTradePanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TradePanel />);
    fireEvent.click(screen.getByRole('radio', { name: /jonas/i }));

    const chip = screen.getByTestId('offer-jail');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(screen.getByTestId('offer-jail').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /send offer/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_OFFER, expect.objectContaining({
      offeredJailCards: 1,
    }));
  });

  it('disables the jail-card chip for a player who holds none', () => {
    base();
    useGameStore.getState().toggleTradePanel(true);
    render(<TradePanel />);
    fireEvent.click(screen.getByRole('radio', { name: /jonas/i }));
    // Jonas holds 0, so asking for one is not an option the UI can express.
    expect((screen.getByTestId('request-jail') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('offer-jail') as HTMLButtonElement).disabled).toBe(false);
  });

  // ── GAP 1: colour groups ─────────────────────────────────────────────────

  it('shows each asset in its colour group, not as a bare name', () => {
    base();
    useGameStore.getState().toggleTradePanel(true);
    render(<TradePanel />);
    fireEvent.click(screen.getByRole('radio', { name: /jonas/i }));
    // Old Kent Road is brown; the chip carries the group as a CSS custom
    // property, which is what paints its 3px band.
    const chip = screen.getByTestId(`offer-${String(mineProp)}`);
    expect(chip.getAttribute('style')).toContain('--gc');
    expect(chip.getAttribute('style')).toContain('#8d5a3c');
  });

  // ── GAP 4: consequences ──────────────────────────────────────────────────

  it('says loudly when an offer breaks one of my monopolies', () => {
    base(null, {
      properties: ORANGE.map((i) => ({ spaceIndex: i, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false }))
        .concat([{ spaceIndex: theirProp, ownerId: 'p2', houses: 0, hasHotel: false, isMortgaged: false }]),
    } as unknown as Partial<GameState>);
    useGameStore.getState().toggleTradePanel(true);
    render(<TradePanel />);
    fireEvent.click(screen.getByRole('radio', { name: /jonas/i }));

    expect(screen.queryByText(/monopoly lost/i)).toBeNull();
    fireEvent.click(screen.getByTestId('offer-19')); // Vine Street leaves orange
    expect(screen.getByText(/your orange monopoly lost/i)).toBeTruthy();
    // …and the chip itself turns red, before the verdict column has to say it.
    expect(screen.getByTestId('offer-19').className).toContain('is-break');
  });

  // ── GAP 5: whose move ────────────────────────────────────────────────────

  it('an incoming offer names the last offerer and puts the move on me', () => {
    base({
      tradeId: 't1', fromPlayerId: 'p2', toPlayerId: 'p1',
      offeredProperties: [theirProp], requestedProperties: [], offeredMoney: 0, requestedMoney: 0,
      offeredJailCards: 0, requestedJailCards: 0, status: 'pending',
    });
    render(<TradePanel />);
    expect(isOpen()).toBe(true);
    // 1 eyebrow  2 title  3 turn strip  4 a live (not `waiting`) primary
    expect(screen.getByText(/last offer by jonas/i)).toBeTruthy();
    expect(screen.getByText(/review jonas's offer/i)).toBeTruthy();
    expect(screen.getByText(/^your move$/i)).toBeTruthy();
    const primary = requireDefined(document.querySelector('.kit-btn--primary'));
    expect(primary.className).not.toContain('is-waiting');
  });

  it('my own outgoing offer says it is waiting on them and cannot be accepted', () => {
    base({
      tradeId: 't2', fromPlayerId: 'p1', toPlayerId: 'p2',
      offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0,
      offeredJailCards: 0, requestedJailCards: 0, status: 'pending',
    });
    render(<TradePanel />);
    expect(screen.getByText(/awaiting jonas/i)).toBeTruthy();
    expect(screen.getByText(/jonas's move/i)).toBeTruthy();
    const primary = requireDefined(document.querySelector('.kit-btn--primary'));
    expect(primary.className).toContain('is-waiting');
    expect(primary.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
  });

  it('incoming trade accepts through an explicit confirm, never on one tap', () => {
    base({
      tradeId: 't1', fromPlayerId: 'p2', toPlayerId: 'p1',
      offeredProperties: [theirProp], requestedProperties: [], offeredMoney: 0, requestedMoney: 0,
      offeredJailCards: 0, requestedJailCards: 0, status: 'pending',
    });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TradePanel />);

    fireEvent.click(screen.getByRole('button', { name: /accept offer/i }));
    // An irreversible asset transfer earns a real confirmation step.
    expect(emit).not.toHaveBeenCalled();
    const plate = requireDefined(document.querySelector<HTMLElement>('.rn-confirm'));
    expect(plate.className).toContain('is-on');

    fireEvent.click(within(plate).getByRole('button', { name: /accept trade/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_ACCEPT, { tradeId: 't1' });
  });

  it('my outgoing trade cancels through an Arm, which needs two taps', () => {
    base({
      tradeId: 't2', fromPlayerId: 'p1', toPlayerId: 'p2',
      offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0,
      offeredJailCards: 0, requestedJailCards: 0, status: 'pending',
    });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TradePanel />);
    const arm = requireDefined(document.querySelector<HTMLElement>('.kit-arm'));
    fireEvent.click(arm);
    expect(emit).not.toHaveBeenCalled();
    fireEvent.click(arm);
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_CANCEL, { tradeId: 't2' });
  });

  // ── GAP 6: cheap expressive replies ──────────────────────────────────────

  it('the receiver can say "need more" without opening a counter', () => {
    base({
      tradeId: 't1', fromPlayerId: 'p2', toPlayerId: 'p1',
      offeredProperties: [theirProp], requestedProperties: [mineProp],
      offeredMoney: 0, requestedMoney: 0, offeredJailCards: 0, requestedJailCards: 0,
      status: 'pending',
    });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TradePanel />);
    fireEvent.click(screen.getByRole('button', { name: /need more/i }));
    // It hands the move back with the sides swapped: the loop stays open and
    // the other player can see it is on them again.
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_COUNTER, expect.objectContaining({
      tradeId: 't1', offeredProperties: [mineProp], requestedProperties: [theirProp],
    }));
  });

  it('the receiver rejects through an Arm', () => {
    base({
      tradeId: 't1', fromPlayerId: 'p2', toPlayerId: 'p1',
      offeredProperties: [theirProp], requestedProperties: [], offeredMoney: 0, requestedMoney: 0,
      offeredJailCards: 0, requestedJailCards: 0, status: 'pending',
    });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TradePanel />);
    const arm = requireDefined(document.querySelector<HTMLElement>('.kit-arm'));
    fireEvent.click(arm);
    fireEvent.click(arm);
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_REJECT, { tradeId: 't1' });
  });

  it('counter pre-fills from their offer with the sides swapped', () => {
    base({
      tradeId: 't5', fromPlayerId: 'p2', toPlayerId: 'p1',
      offeredProperties: [theirProp], requestedProperties: [mineProp],
      offeredMoney: 0, requestedMoney: 0, offeredJailCards: 0, requestedJailCards: 0,
      status: 'pending',
    });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TradePanel />);
    fireEvent.click(screen.getByRole('button', { name: /^counter$/i }));
    // Nobody should have to retype a proposal to change one line of it.
    expect(screen.getByTestId(`offer-${String(mineProp)}`).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId(`request-${String(theirProp)}`).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /send counter/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_COUNTER, expect.objectContaining({
      tradeId: 't5', offeredProperties: [mineProp], requestedProperties: [theirProp],
    }));
  });

  it('spectator (neither from nor to) does NOT auto-open when a trade is active', () => {
    useGameStore.getState().update({
      roomCode: 'ABCD', status: 'in-progress',
      players: [{ id: 'p1', name: 'Maya', token: 'red', money: 15_000_000, isBankrupt: false, jailCardCount: 0 },
                { id: 'p2', name: 'Jonas', token: 'blue', money: 15_000_000, isBankrupt: false, jailCardCount: 0 },
                { id: 'p3', name: 'Lena', token: 'green', money: 15_000_000, isBankrupt: false, jailCardCount: 0 }],
      turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 },
      properties: [],
      activeTrade: { tradeId: 't3', fromPlayerId: 'p1', toPlayerId: 'p2', offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0, offeredJailCards: 0, requestedJailCards: 0, status: 'pending' },
    } as unknown as GameState);
    useGameStore.getState().setMyPlayerId('p3');
    render(<TradePanel />);
    expect(isOpen()).toBe(false);
  });
});
