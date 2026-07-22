import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PartnershipPanel } from './PartnershipPanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function base(over: Partial<GameState> = {}) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red' }, { id: 'p2', name: 'Jonas', token: 'blue' }],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 }, properties: [],
    partnerships: [], activePartnershipProposal: null, activePartnershipDissolution: null, ...over,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('PartnershipPanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('is null when closed with nothing pending', () => {
    base();
    const { container } = render(<PartnershipPanel />);
    expect(container.firstChild).toBe(null);
  });

  it('accepts an incoming proposal', () => {
    base({ activePartnershipProposal: { proposalId: 'pr1', initiatorId: 'p2', colorGroup: 'orange', proposedEquity: [{ playerId: 'p2', percentage: 50 }, { playerId: 'p1', percentage: 50 }], acceptedPlayerIds: ['p2'], status: 'pending' } } as any);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<PartnershipPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.PARTNERSHIP_ACCEPT_PROPOSAL, { proposalId: 'pr1' });
  });

  it('dissolves an active partnership I am in', () => {
    base({ partnerships: [{ partnershipId: 'pt1', colorGroup: 'orange', status: 'active', partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }] }] } as any);
    useGameStore.getState().togglePartnershipPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<PartnershipPanel />);
    fireEvent.click(screen.getByRole('button', { name: /dissolve/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.PARTNERSHIP_DISSOLVE_REQUEST, { partnershipId: 'pt1' });
  });
});
