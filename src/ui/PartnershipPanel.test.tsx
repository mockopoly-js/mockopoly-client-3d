import { describe, it, expect, beforeEach, vi } from 'vitest';
import { noop, requireDefined } from '../test-utils';
import { render, screen, fireEvent } from '@testing-library/react';
import { PartnershipPanel } from './PartnershipPanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function dialog(): HTMLElement {
  return requireDefined(document.querySelector<HTMLElement>('.kit-takeover'));
}
const isOpen = () => dialog().getAttribute('aria-hidden') === 'false';

/** The percentages ON THE STEPPERS — the allocator's own state, not the
 *  read-only mirror of it in the left column. */
function allocated(): number[] {
  return Array.from(document.querySelectorAll('.rn-step-num'))
    .map((n) => Number(n.textContent.replace('%', '')));
}

function base(over: Partial<GameState> = {}) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [
      { id: 'p1', name: 'Maya', token: 'red', money: 15_000_000 },
      { id: 'p2', name: 'Jonas', token: 'blue', money: 15_000_000 },
      { id: 'p3', name: 'Lena', token: 'green', money: 15_000_000 },
    ],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 }, properties: [], log: [],
    partnerships: [], activePartnershipProposal: null, activePartnershipDissolution: null, ...over,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

/** The orange set, split across three players — 3 partners, the hard case. */
const sharedOrange = [
  { spaceIndex: 16, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
  { spaceIndex: 18, ownerId: 'p2', houses: 0, hasHotel: false, isMortgaged: false },
  { spaceIndex: 19, ownerId: 'p3', houses: 0, hasHotel: false, isMortgaged: false },
];

describe('PartnershipPanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('stays mounted but closed with nothing pending', () => {
    base();
    render(<PartnershipPanel />);
    expect(dialog()).toBeTruthy();
    expect(isOpen()).toBe(false);
  });

  it('accepts an incoming proposal', () => {
    base({ activePartnershipProposal: {
      proposalId: 'pr1', initiatorId: 'p2', colorGroup: 'orange',
      proposedEquity: [{ playerId: 'p2', percentage: 50 }, { playerId: 'p1', percentage: 50 }],
      acceptedPlayerIds: ['p2'], status: 'pending',
    } } as unknown as Partial<GameState>);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<PartnershipPanel />);
    fireEvent.click(screen.getByRole('button', { name: /accept share/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.PARTNERSHIP_ACCEPT_PROPOSAL, { proposalId: 'pr1' });
  });

  it('a pending proposal I sent is waiting, not acceptable, and names who on', () => {
    base({ activePartnershipProposal: {
      proposalId: 'pr2', initiatorId: 'p1', colorGroup: 'orange',
      proposedEquity: [
        { playerId: 'p1', percentage: 50 }, { playerId: 'p2', percentage: 30 }, { playerId: 'p3', percentage: 20 },
      ],
      acceptedPlayerIds: ['p1', 'p3'], status: 'pending',
    } } as unknown as Partial<GameState>);
    render(<PartnershipPanel />);
    expect(screen.getByText(/awaiting partners/i)).toBeTruthy();
    // Deliberately redundant: the verdict callout AND the turn strip both name
    // him, because "who are we waiting for" is the only question this screen
    // exists to answer.
    expect(screen.getAllByText(/waiting on jonas/i).length).toBeGreaterThanOrEqual(2);
    const primary = requireDefined(document.querySelector('.kit-btn--primary'));
    expect(primary.className).toContain('is-waiting');
  });

  it('dissolves an active partnership through an Arm, which needs two taps', () => {
    base({ partnerships: [{
      partnershipId: 'pt1', colorGroup: 'orange', status: 'active',
      partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }],
    }] } as unknown as Partial<GameState>);
    useGameStore.getState().togglePartnershipPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<PartnershipPanel />);
    const arm = requireDefined(document.querySelector<HTMLElement>('.kit-arm'));
    fireEvent.click(arm);
    expect(emit).not.toHaveBeenCalled();
    fireEvent.click(arm);
    expect(emit).toHaveBeenCalledWith(EVENTS.PARTNERSHIP_DISSOLVE_REQUEST, { partnershipId: 'pt1' });
  });

  it('a dissolve request I have to answer is a Hold, because it settles money', () => {
    base({
      partnerships: [{
        partnershipId: 'pt1', colorGroup: 'orange', status: 'active',
        partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }],
      }],
      activePartnershipDissolution: {
        dissolutionId: 'd1', partnershipId: 'pt1', requesterId: 'p2',
        acceptedPlayerIds: ['p2'], status: 'pending',
      },
    } as unknown as Partial<GameState>);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<PartnershipPanel />);
    expect(screen.getByText(/dissolve orange\?/i)).toBeTruthy();
    const hold = requireDefined(document.querySelector<HTMLElement>('.kit-hold'));
    // Keyboard parity path: Enter fires it, so a keyboard user is not stranded.
    fireEvent.keyDown(hold, { key: 'Enter' });
    expect(emit).toHaveBeenCalledWith(EVENTS.PARTNERSHIP_ACCEPT_DISSOLVE, { dissolutionId: 'd1' });
  });

  // ── the equity allocator, through the UI ─────────────────────────────────

  it('proposes with an equity split that already sums to 100', () => {
    base({ properties: sharedOrange } as unknown as Partial<GameState>);
    useGameStore.getState().togglePartnershipPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<PartnershipPanel />);

    fireEvent.click(screen.getByRole('radio', { name: /orange/i }));
    fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));

    const call = requireDefined(emit.mock.calls.find((c) => c[0] === EVENTS.PARTNERSHIP_PROPOSE));
    const payload = call[1] as { colorGroup: string; proposedEquity: { playerId: string; percentage: number }[] };
    expect(payload.colorGroup).toBe('orange');
    expect(payload.proposedEquity).toHaveLength(3);
    expect(payload.proposedEquity.reduce((t, e) => t + e.percentage, 0)).toBe(100);
    // The server also rejects anything outside 1..99 per partner.
    for (const e of payload.proposedEquity) {
      expect(e.percentage).toBeGreaterThanOrEqual(1);
      expect(e.percentage).toBeLessThanOrEqual(99);
    }
  });

  it('the allocator never nags: no error text, and Propose is never gated on the total', () => {
    base({ properties: sharedOrange } as unknown as Partial<GameState>);
    useGameStore.getState().togglePartnershipPanel(true);
    render(<PartnershipPanel />);
    fireEvent.click(screen.getByRole('radio', { name: /orange/i }));

    const propose = screen.getByRole('button', { name: /^propose$/i }) as HTMLButtonElement;
    const plus = screen.getAllByRole('button', { name: 'More' });

    // Drive one partner all the way to its ceiling. The total is 100 at every
    // single intermediate state, so nothing ever has to be validated.
    for (let i = 0; i < 25; i++) {
      fireEvent.click(plus[0]);
      expect(screen.getByText(/total 100%/i)).toBeTruthy();
      expect(screen.queryByText(/must be 100/i)).toBeNull();
      expect(propose.disabled).toBe(false);
    }
    // …and the percentages on the controls themselves still add up.
    expect(allocated().reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('every partner keeps a floor, so nobody can be zeroed out of their own set', () => {
    base({ properties: sharedOrange } as unknown as Partial<GameState>);
    useGameStore.getState().togglePartnershipPanel(true);
    render(<PartnershipPanel />);
    fireEvent.click(screen.getByRole('radio', { name: /orange/i }));

    const plus = screen.getAllByRole('button', { name: 'More' });
    for (let i = 0; i < 30; i++) fireEvent.click(plus[0]);
    const shown = allocated();
    expect(Math.max(...shown)).toBe(90);   // 20 - 1 - 1 units
    expect(Math.min(...shown)).toBe(5);    // the one-unit floor
    expect(shown.reduce((a, b) => a + b, 0)).toBe(100);
  });
});
