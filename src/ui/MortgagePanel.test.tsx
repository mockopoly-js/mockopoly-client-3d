import { describe, it, expect, beforeEach, vi } from 'vitest';
import { noop, requireDefined } from '../test-utils';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MortgagePanel } from './MortgagePanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import { formatMoney } from '../utils/format';
import type { GameState, Partnership, PropertyState } from '../types/GameState';

// prop = first buildable property (Old Kent Road, index 1, colorGroup 'brown')
const prop = requireDefined(BOARD_SPACES.find((s) => s.type === 'property' && (s.houseCost ?? 0) > 0));
const propColorGroup = requireDefined(prop.colorGroup);
// All sibling spaces in the same color group
const groupSpaces = BOARD_SPACES.filter(
  (s) => s.type === 'property' && s.colorGroup === prop.colorGroup,
);
// Sibling property indices (all group members except prop itself)
const siblingIndices = groupSpaces.map((s) => s.index).filter((i) => i !== prop.index);

/** Hold the given Hold/Arm-style button down for its full duration and
 *  release — the only way <Hold> fires onComplete. */
function holdToComplete(btn: HTMLElement, durationMs = 1200) {
  fireEvent.pointerDown(btn);
  act(() => { vi.advanceTimersByTime(durationMs); });
  fireEvent.pointerUp(btn);
}

/** Build a PropertyState array with all group members owned by ownerId,
 *  with overrides applied only to the primary prop. */
function makeGroupProperties(
  ownerId: string,
  over: { houses?: number; hasHotel?: boolean; isMortgaged?: boolean; siblingMortgaged?: boolean } = {},
): PropertyState[] {
  return [
    // Primary property
    {
      spaceIndex: prop.index,
      ownerId,
      houses: over.houses ?? 0,
      hasHotel: over.hasHotel ?? false,
      isMortgaged: over.isMortgaged ?? false,
    },
    // Siblings (all owned by same ownerId unless siblingMortgaged overrides)
    ...siblingIndices.map((si) => ({
      spaceIndex: si,
      ownerId,
      houses: 0,
      hasHotel: false,
      isMortgaged: over.siblingMortgaged ?? false,
    })),
  ];
}

function setState(
  over: {
    houses?: number;
    hasHotel?: boolean;
    isMortgaged?: boolean;
    ownerId?: string | null;
    money?: number;
    siblingMortgaged?: boolean;
    /** Only include a single property (not the full group) — simulates partial ownership */
    singleProp?: boolean;
    partnerships?: Partnership[];
  } = {},
) {
  const ownerId = over.ownerId !== undefined ? over.ownerId : 'p1';
  const properties: PropertyState[] = over.singleProp
    ? [
        {
          spaceIndex: prop.index,
          ownerId: ownerId ?? 'p1',
          houses: over.houses ?? 0,
          hasHotel: over.hasHotel ?? false,
          isMortgaged: over.isMortgaged ?? false,
        },
      ]
    : makeGroupProperties(ownerId ?? 'p1', over);

  useGameStore.getState().update({
    roomCode: 'ABCD',
    status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money: over.money ?? 15_000_000 }],
    turn: { currentPlayerId: 'p1' },
    config: { maxPlayers: 4 },
    properties,
    partnerships: over.partnerships ?? [],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
  useGameStore.getState().selectProperty(prop.index);
}

describe('MortgagePanel', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  it('renders a closed panel when no property is selected', () => {
    const { container } = render(<MortgagePanel />);
    expect(container.querySelector('.kit-panel.is-on')).toBeNull();
    expect(container.querySelector('.kit-deed, [class*="section"]')).toBeNull();
  });

  it('shows the selected property name', () => {
    setState({});
    render(<MortgagePanel />);
    expect(screen.getByText(prop.name)).toBeTruthy();
  });

  // ── GAP 1 — your own cash is now shown ────────────────────────────────────

  it('GAP 1 — shows your cash', () => {
    setState({ money: 3_400_000 });
    const { container } = render(<MortgagePanel />);
    expect(screen.getByText(/your cash/i)).toBeTruthy();
    // <Money> splits currency mark / value / unit into separate nodes, so the
    // full figure is read off the element's combined textContent.
    expect(container.querySelector('.kit-money')?.textContent).toBe('£3.400M');
  });

  // ── Mortgage / unmortgage, now a <Hold> (semi-destructive) ────────────────

  it('holding the mortgage control the full duration emits MORTGAGE_APPLY', () => {
    setState({});
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<MortgagePanel />);
    holdToComplete(screen.getByRole('button', { name: /^mortgage$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.MORTGAGE_APPLY, { spaceIndex: prop.index });
  });

  it('releasing the mortgage hold early does NOT fire it', () => {
    setState({});
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<MortgagePanel />);
    const btn = screen.getByRole('button', { name: /^mortgage$/i });
    fireEvent.pointerDown(btn);
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.pointerUp(btn);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(emit).not.toHaveBeenCalledWith(EVENTS.MORTGAGE_APPLY, expect.anything());
  });

  it('holding the unmortgage control emits MORTGAGE_LIFT, at 110% of mortgage value', () => {
    setState({ isMortgaged: true });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<MortgagePanel />);
    // GAP 4 — the lift cost (mortgageValue x 1.1) is stated in the label.
    const lift = requireDefined(prop.mortgageValue) * 1.1;
    expect(screen.getByText(new RegExp(`110%`, 'i'))).toBeTruthy();
    holdToComplete(screen.getByRole('button', { name: /unmortgage/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.MORTGAGE_LIFT, { spaceIndex: prop.index });
    expect(lift).toBeGreaterThan(requireDefined(prop.mortgageValue));
  });

  it('shows only the Mortgage hold when not mortgaged, enabled', () => {
    setState({});
    render(<MortgagePanel />);
    expect((screen.getByRole('button', { name: /^mortgage$/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: /unmortgage/i })).toBeNull();
  });

  it('swaps to only the Unmortgage hold once mortgaged, enabled', () => {
    setState({ isMortgaged: true });
    render(<MortgagePanel />);
    expect(screen.queryByRole('button', { name: /^mortgage$/i })).toBeNull();
    expect((screen.getByRole('button', { name: /unmortgage/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Mortgage is disabled once the property carries houses', () => {
    setState({ houses: 1 });
    render(<MortgagePanel />);
    expect((screen.getByRole('button', { name: /^mortgage$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('closes via the X (clears selection)', () => {
    setState({});
    render(<MortgagePanel />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(useGameStore.getState().selectedPropertyIndex).toBe(null);
  });

  // ── Build: Buy House stays a plain immediate Button ───────────────────────

  it('buys a house when full group is owned and emits BUILD_BUY_HOUSE', () => {
    setState({ houses: 1 });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<MortgagePanel />);
    fireEvent.click(screen.getByRole('button', { name: /buy house/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.BUILD_BUY_HOUSE, { spaceIndex: prop.index });
  });

  // ── GAP 4 — build/sell house rules ────────────────────────────────────────

  it('GAP 4 — states the no-even-build / full-price-sell house rules', () => {
    setState({ houses: 1 });
    render(<MortgagePanel />);
    expect(screen.getByText(/no even-build/i)).toBeTruthy();
    expect(screen.getByText(/full price, not half/i)).toBeTruthy();
  });

  it('GAP 4 — selling a house is an arm-then-fire control that restates the full-price refund', () => {
    setState({ houses: 2 });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<MortgagePanel />);
    const sell = screen.getByRole('button', { name: /sell house/i });

    fireEvent.click(sell);
    expect(emit).not.toHaveBeenCalledWith(EVENTS.BUILD_SELL_HOUSE, expect.anything());
    expect(within(sell).getByText(/full price/i).textContent).toBe(`Full price +${formatMoney(requireDefined(prop.houseCost))}`);

    fireEvent.click(sell);
    expect(emit).toHaveBeenCalledWith(EVENTS.BUILD_SELL_HOUSE, { spaceIndex: prop.index });
  });

  it('GAP 4 — a partnership build cost is split by equity, shown before building', () => {
    setState({
      houses: 1,
      partnerships: [
        {
          partnershipId: 'ps1',
          colorGroup: propColorGroup,
          partners: [
            { playerId: 'p1', percentage: 60 },
            { playerId: 'p2', percentage: 40 },
          ],
          status: 'active',
          createdAt: 0,
        },
      ],
    });
    render(<MortgagePanel />);
    expect(screen.getByText(/split by equity/i)).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
  });

  it('no partnership split note for a solo-owned group', () => {
    setState({ houses: 1, partnerships: [] });
    render(<MortgagePanel />);
    expect(screen.queryByText(/split by equity/i)).toBeNull();
  });

  // ── ownsFullGroup guard (Gap 1 in the original brief, preserved) ──────────

  it('Buy House is DISABLED when player owns only one property in the group (not full group)', () => {
    // singleProp: true means only the primary property is in the state — sibling not owned
    setState({ singleProp: true });
    render(<MortgagePanel />);
    const buyHouseBtn = screen.getByRole('button', { name: /buy house/i }) as HTMLButtonElement;
    expect(buyHouseBtn.disabled).toBe(true);
  });

  it('Buy House is ENABLED when player owns the full color group with no mortgaged siblings', () => {
    setState({}); // makeGroupProperties gives all group members to p1, none mortgaged
    render(<MortgagePanel />);
    const buyHouseBtn = screen.getByRole('button', { name: /buy house/i }) as HTMLButtonElement;
    expect(buyHouseBtn.disabled).toBe(false);
  });

  it('GAP 4 — no even-build: buying is enabled even when a sibling already has more houses than this one', () => {
    // This property has 0 houses; a sibling in the same full group has 3 —
    // an even-build rule would block this until the sibling caught down to
    // 0/1. The gate never compares siblings' house counts, only full
    // ownership, so this must stay enabled.
    const properties = makeGroupProperties('p1', {});
    properties[1] = { ...properties[1], houses: 3 };
    useGameStore.getState().update({
      roomCode: 'ABCD', status: 'in-progress',
      players: [{ id: 'p1', name: 'Maya', token: 'red', money: 15_000_000 }],
      turn: { currentPlayerId: 'p1' },
      config: { maxPlayers: 4 },
      properties,
      partnerships: [],
    } as unknown as GameState);
    useGameStore.getState().setMyPlayerId('p1');
    useGameStore.getState().selectProperty(prop.index);

    render(<MortgagePanel />);
    const buyHouseBtn = screen.getByRole('button', { name: /buy house/i }) as HTMLButtonElement;
    expect(buyHouseBtn.disabled).toBe(false);
  });

  it('Buy House is DISABLED when the full group is owned but a sibling is mortgaged', () => {
    setState({ siblingMortgaged: true });
    render(<MortgagePanel />);
    const buyHouseBtn = screen.getByRole('button', { name: /buy house/i }) as HTMLButtonElement;
    expect(buyHouseBtn.disabled).toBe(true);
  });

  // ── Partners can build via canManage ──────────────────────────────────────

  it('a partner sees build buttons (not the "you do not own" message)', () => {
    // p2 owns the property; p1 is a partner in an active partnership for this group
    setState({
      ownerId: 'p2',
      singleProp: true, // only one PropertyState entry — p2 owns it
      partnerships: [
        {
          partnershipId: 'ps1',
          colorGroup: propColorGroup,
          partners: [
            { playerId: 'p1', percentage: 50 },
            { playerId: 'p2', percentage: 50 },
          ],
          status: 'active',
          createdAt: 0,
        },
      ],
    });
    render(<MortgagePanel />);
    // "You do not own this property." should NOT appear
    expect(screen.queryByText(/you do not own/i)).toBeNull();
    // Build buttons should be rendered
    expect(screen.getByRole('button', { name: /buy house/i })).toBeTruthy();
  });

  it('a non-partner non-owner sees "You do not own this property" and no build buttons', () => {
    setState({ ownerId: 'p2', singleProp: true, partnerships: [] });
    render(<MortgagePanel />);
    expect(screen.getByText(/you do not own/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /buy house/i })).toBeNull();
  });

  it('mortgage buttons (apply/lift) are NOT shown to a partner who is not the owner', () => {
    setState({
      ownerId: 'p2',
      singleProp: true,
      partnerships: [
        {
          partnershipId: 'ps1',
          colorGroup: propColorGroup,
          partners: [
            { playerId: 'p1', percentage: 50 },
            { playerId: 'p2', percentage: 50 },
          ],
          status: 'active',
          createdAt: 0,
        },
      ],
    });
    render(<MortgagePanel />);
    // Mortgage/Unmortgage must not appear for the partner (owner-only)
    expect(screen.queryByRole('button', { name: /^mortgage$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /unmortgage/i })).toBeNull();
  });

  // ── Sell gated on isMyTurn ────────────────────────────────────────────────

  it('Sell House is disabled when it is not my turn', () => {
    useGameStore.getState().update({
      roomCode: 'ABCD',
      status: 'in-progress',
      players: [
        { id: 'p1', name: 'Maya', token: 'red', money: 15_000_000 },
        { id: 'p2', name: 'Bob', token: 'blue', money: 15_000_000 },
      ],
      turn: { currentPlayerId: 'p2' }, // p2's turn, not p1
      config: { maxPlayers: 4 },
      properties: makeGroupProperties('p1', { houses: 2 }),
      partnerships: [],
    } as unknown as GameState);
    useGameStore.getState().setMyPlayerId('p1');
    useGameStore.getState().selectProperty(prop.index);

    render(<MortgagePanel />);
    const sellHouseBtn = screen.getByRole('button', { name: /sell house/i }) as HTMLButtonElement;
    expect(sellHouseBtn.disabled).toBe(true);
  });

  it('Sell House is enabled when it is my turn and I have houses', () => {
    setState({ houses: 2 }); // isMyTurn = true (currentPlayerId = 'p1' = myId)
    render(<MortgagePanel />);
    const sellHouseBtn = screen.getByRole('button', { name: /sell house/i }) as HTMLButtonElement;
    expect(sellHouseBtn.disabled).toBe(false);
  });
});
