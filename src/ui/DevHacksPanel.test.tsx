import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DevHacksPanel } from './DevHacksPanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function setDevHacks(devHacks: Partial<Record<string, boolean>>) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress', players: [], turn: { currentPlayerId: null },
    config: { maxPlayers: 4 }, properties: [],
    devHacks: { unlimitedMoney: false, soloPlay: false, alwaysLandOnMayfair: false, alwaysLandOnCard: false, sameTurn: false, preAssignProperties: false, ...devHacks },
  } as unknown as GameState);
}

describe('DevHacksPanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('renders nothing when closed', () => {
    setDevHacks({});
    const { container } = render(<DevHacksPanel />);
    expect(container.firstChild).toBe(null);
  });

  it('shows six toggles when open and emits DEV_SET_HACK on toggle', () => {
    setDevHacks({});
    useGameStore.getState().toggleDevHacks(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<DevHacksPanel />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    fireEvent.click(screen.getByLabelText(/1-player game start/i)); // soloPlay
    expect(emit).toHaveBeenCalledWith(EVENTS.DEV_SET_HACK, { hack: 'soloPlay', enabled: true });
  });

  it('reflects current devHacks state', () => {
    setDevHacks({ unlimitedMoney: true });
    useGameStore.getState().toggleDevHacks(true);
    render(<DevHacksPanel />);
    expect((screen.getByLabelText(/999m/i) as HTMLInputElement).checked).toBe(true);
  });
});
