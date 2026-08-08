import { describe, it, expect, beforeEach, vi } from 'vitest';
import { noop, requireDefined } from '../test-utils';
import { render, screen, fireEvent } from '@testing-library/react';
import { BuyPrompt } from './BuyPrompt';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import type { GameState } from '../types/GameState';

// pick a real unowned buyable space (property with a price)
const prop = requireDefined(BOARD_SPACES.find((s) => s.type === 'property' && (s.price ?? 0) > 0));

function land(phase: string, money: number, ownerId: string | null = null) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money, position: prop.index, isBankrupt: false, isConnected: true }],
    turn: { currentPlayerId: 'p1', phase, hasRolled: true },
    config: { maxPlayers: 4 },
    properties: [{ spaceIndex: prop.index, ownerId, houses: 0, hasHotel: false, isMortgaged: false }],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('BuyPrompt', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('shows nothing outside the action phase', () => {
    land('moving', 15_000_000);
    const { container } = render(<BuyPrompt />);
    expect(container.textContent).not.toContain(prop.name);
  });

  it('shows the deed (kit <Deed>, not the sprite) and emits TURN_BUY_PROPERTY when affordable', () => {
    land('action', 15_000_000);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    const { container } = render(<BuyPrompt />);
    expect(screen.getByText(prop.name)).toBeTruthy();
    // Migrated off the DeedCard sprite entirely — the property now renders as
    // a flat kit <Deed> (colour band + rent ladder), never a card image.
    expect(container.querySelector('[data-testid="deed-card"]')).toBeNull();
    expect(container.querySelector('.kit-deed')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /buy/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_BUY_PROPERTY);
  });

  it('shows the rent ladder with the base tier highlighted as a buy-decision aid', () => {
    land('action', 15_000_000);
    render(<BuyPrompt />);
    // RENT_TIER_LABELS starts with 'Rent' — always present when the space has
    // a rents[] ladder (every plain property does).
    expect(screen.getByText('Rent')).toBeTruthy();
    const currentRow = document.querySelector('.kit-deed__row.is-current');
    expect(currentRow?.textContent).toContain('Rent');
  });

  it('GAP 5 — states that declining sends the property to auction', () => {
    land('action', 15_000_000);
    render(<BuyPrompt />);
    expect(screen.getByText(/goes to auction/i)).toBeTruthy();
  });

  it('decline is an arm-then-fire control: one tap arms, a second tap emits TURN_PASS_BUY (starts the auction) — never TURN_END, which the server advances itself once the auction settles', () => {
    land('action', 15_000_000);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<BuyPrompt />);
    const decline = screen.getByRole('button', { name: /decline/i });

    fireEvent.click(decline);
    expect(emit).not.toHaveBeenCalledWith(EVENTS.TURN_PASS_BUY);
    expect(decline.className).toContain('is-armed');

    fireEvent.click(decline);
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_PASS_BUY);
    expect(emit).not.toHaveBeenCalledWith(EVENTS.TURN_END);
  });

  it('disables Buy when unaffordable but still allows Decline', () => {
    land('action', 0);
    render(<BuyPrompt />);
    expect((screen.getByRole('button', { name: /buy/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /decline/i })).toBeTruthy();
    expect(screen.getByText(/not enough cash/i)).toBeTruthy();
  });

  it('shows nothing when the space is already owned', () => {
    land('action', 15_000_000, 'p2');
    const { container } = render(<BuyPrompt />);
    expect(container.textContent).not.toContain(prop.name);
  });

  it('shows the prompt when properties array has no entry for the space (sparse/no-entry path)', () => {
    useGameStore.getState().update({
      roomCode: 'ABCD', status: 'in-progress',
      players: [{ id: 'p1', name: 'Maya', token: 'red', money: 15_000_000, position: prop.index, isBankrupt: false, isConnected: true }],
      turn: { currentPlayerId: 'p1', phase: 'action', hasRolled: true },
      config: { maxPlayers: 4 },
      properties: [],
    } as unknown as GameState);
    useGameStore.getState().setMyPlayerId('p1');
    render(<BuyPrompt />);
    expect(screen.getByText(prop.name)).toBeTruthy();
    expect(screen.getByRole('button', { name: /buy/i })).toBeTruthy();
  });
});
