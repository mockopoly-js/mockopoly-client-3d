import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MortgagePanel } from './MortgagePanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import type { GameState } from '../types/GameState';

const prop = BOARD_SPACES.find((s) => s.type === 'property' && (s.houseCost ?? 0) > 0)!;

function setState(over: { houses?: number; hasHotel?: boolean; isMortgaged?: boolean; ownerId?: string | null; money?: number } = {}) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money: over.money ?? 15_000_000 }],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 },
    properties: [{ spaceIndex: prop.index, ownerId: over.ownerId ?? 'p1', houses: over.houses ?? 0, hasHotel: over.hasHotel ?? false, isMortgaged: over.isMortgaged ?? false }],
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
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<MortgagePanel />);
    expect(screen.getByText(prop.name)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^mortgage$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.MORTGAGE_APPLY, { spaceIndex: prop.index });
  });

  it('buys a house and emits BUILD_BUY_HOUSE', () => {
    setState({ houses: 1 });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
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
});
