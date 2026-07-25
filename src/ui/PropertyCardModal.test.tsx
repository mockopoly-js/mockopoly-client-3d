import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PropertyCardModal } from './PropertyCardModal';
import { useGameStore } from '../state/gameStore';
import { BOARD_SPACES } from '../constants/board';
import type { GameState } from '../types/GameState';
import { requireDefined } from '../test-utils';

// A regular property with a cardFrame (Old Kent Road, index 1)
const prop = requireDefined(BOARD_SPACES.find((s) => s.type === 'property' && s.cardFrame != null));
// A railroad (Kings Cross, index 5)
const railroad = requireDefined(BOARD_SPACES.find((s) => s.type === 'railroad'));

function setDeedCard(
  spaceIndex: number,
  opts: {
    ownerId?: string | null;
    houses?: number;
    hasHotel?: boolean;
    isMortgaged?: boolean;
  } = {},
) {
  useGameStore.getState().update({
    roomCode: 'TEST',
    status: 'in-progress',
    players: [
      { id: 'p1', name: 'Alice', token: 'red', money: 10_000_000 },
      { id: 'p2', name: 'Boris', token: 'blue', money: 10_000_000 },
    ],
    turn: { currentPlayerId: 'p1', phase: 'rolling' },
    config: { maxPlayers: 4 },
    properties: [
      {
        spaceIndex,
        ownerId: opts.ownerId !== undefined ? opts.ownerId : null,
        houses: opts.houses ?? 0,
        hasHotel: opts.hasHotel ?? false,
        isMortgaged: opts.isMortgaged ?? false,
      },
    ],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
  useGameStore.getState().openDeedCard(spaceIndex);
}

describe('PropertyCardModal', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('renders nothing when deedCardIndex is null', () => {
    const { container } = render(<PropertyCardModal />);
    expect(container.firstChild).toBe(null);
  });

  it('shows the deed sprite for a property', () => {
    setDeedCard(prop.index);
    render(<PropertyCardModal />);
    const deed = screen.getByTestId('deed-card');
    expect(deed.getAttribute('data-card-frame')).toBe(String(prop.cardFrame));
    expect(deed.getAttribute('data-face')).toBe('front');
  });

  it('shows the property name and price', () => {
    setDeedCard(prop.index);
    render(<PropertyCardModal />);
    expect(screen.getByText(prop.name)).toBeTruthy();
    // Price formatted via formatMoney — just verify it appears somewhere
    expect(screen.getByText(/price/i, { exact: false })).toBeTruthy();
  });

  it('shows "Unowned" when ownerId is null', () => {
    setDeedCard(prop.index, { ownerId: null });
    render(<PropertyCardModal />);
    expect(screen.getByText(/unowned/i)).toBeTruthy();
  });

  it('shows owner name when ownerId is set', () => {
    setDeedCard(prop.index, { ownerId: 'p2' });
    render(<PropertyCardModal />);
    expect(screen.getByText(/boris/i)).toBeTruthy();
    expect(screen.getByText(/owned by/i)).toBeTruthy();
  });

  it('shows owner name for p1 as owner', () => {
    setDeedCard(prop.index, { ownerId: 'p1' });
    render(<PropertyCardModal />);
    expect(screen.getByText(/alice/i)).toBeTruthy();
  });

  it('shows mortgage face (back) when mortgaged', () => {
    setDeedCard(prop.index, { isMortgaged: true });
    render(<PropertyCardModal />);
    const deed = screen.getByTestId('deed-card');
    expect(deed.getAttribute('data-face')).toBe('back');
  });

  it('shows "Mortgaged" state label when isMortgaged', () => {
    setDeedCard(prop.index, { isMortgaged: true });
    render(<PropertyCardModal />);
    expect(screen.getByText(/mortgaged/i)).toBeTruthy();
  });

  it('shows house count label when houses > 0', () => {
    setDeedCard(prop.index, { houses: 3 });
    render(<PropertyCardModal />);
    expect(screen.getByText(/houses: 3/i)).toBeTruthy();
  });

  it('shows "Hotel" label when hasHotel is true', () => {
    setDeedCard(prop.index, { hasHotel: true });
    render(<PropertyCardModal />);
    expect(screen.getByText(/hotel/i)).toBeTruthy();
  });

  it('Close button clears deedCardIndex', () => {
    setDeedCard(prop.index);
    render(<PropertyCardModal />);
    expect(useGameStore.getState().deedCardIndex).toBe(prop.index);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(useGameStore.getState().deedCardIndex).toBe(null);
  });

  it('clicking the overlay closes the modal', () => {
    setDeedCard(prop.index);
    const { container } = render(<PropertyCardModal />);
    // The outer overlay div is the direct child of the container
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay);
    expect(useGameStore.getState().deedCardIndex).toBe(null);
  });

  it('works for a railroad space', () => {
    setDeedCard(railroad.index);
    render(<PropertyCardModal />);
    expect(screen.getByText(railroad.name)).toBeTruthy();
  });

  it('has NO buy button (read-only)', () => {
    setDeedCard(prop.index);
    render(<PropertyCardModal />);
    expect(screen.queryByRole('button', { name: /buy/i })).toBe(null);
  });

  it('has NO mortgage button (read-only)', () => {
    setDeedCard(prop.index, { ownerId: 'p1' });
    render(<PropertyCardModal />);
    expect(screen.queryByRole('button', { name: /mortgage/i })).toBe(null);
  });

  it('does not affect selectedPropertyIndex or showPropertyCard (MortgagePanel isolation)', () => {
    setDeedCard(prop.index);
    render(<PropertyCardModal />);
    expect(useGameStore.getState().selectedPropertyIndex).toBe(null);
    expect(useGameStore.getState().showPropertyCard).toBe(false);
  });
});
