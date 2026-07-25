import { describe, it, expect, beforeEach, vi } from 'vitest';
import { noop, requireDefined } from '../test-utils';
import { render, screen, fireEvent } from '@testing-library/react';
import { MortgagePanel } from './MortgagePanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
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
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('renders nothing when no property is selected', () => {
    const { container } = render(<MortgagePanel />);
    expect(container.firstChild).toBe(null);
  });

  it('shows the selected property and mortgages it', () => {
    setState({});
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<MortgagePanel />);
    expect(screen.getByText(prop.name)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^mortgage$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.MORTGAGE_APPLY, { spaceIndex: prop.index });
  });

  it('buys a house when full group is owned and emits BUILD_BUY_HOUSE', () => {
    setState({ houses: 1 });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<MortgagePanel />);
    fireEvent.click(screen.getByRole('button', { name: /buy house/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.BUILD_BUY_HOUSE, { spaceIndex: prop.index });
  });

  it('lift is enabled only when mortgaged; mortgage disabled when mortgaged', () => {
    setState({ isMortgaged: true });
    render(<MortgagePanel />);
    expect((screen.getByRole('button', { name: /^mortgage$/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /unmortgage/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('closes via the X (clears selection)', () => {
    setState({});
    render(<MortgagePanel />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(useGameStore.getState().selectedPropertyIndex).toBe(null);
  });

  // ── ownsFullGroup guard (Gap 1) ───────────────────────────────────────────

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

  it('Buy House is DISABLED when the full group is owned but a sibling is mortgaged', () => {
    setState({ siblingMortgaged: true });
    render(<MortgagePanel />);
    const buyHouseBtn = screen.getByRole('button', { name: /buy house/i }) as HTMLButtonElement;
    expect(buyHouseBtn.disabled).toBe(true);
  });

  // ── Partners can build via canManage (Gap 2) ──────────────────────────────

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

  // ── Sell gated on isMyTurn (Gap 3) ───────────────────────────────────────

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
