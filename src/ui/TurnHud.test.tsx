import { describe, it, expect, beforeEach, vi } from 'vitest';
import { noop } from '../test-utils';
import { render, screen, fireEvent } from '@testing-library/react';
import { TurnHud } from './TurnHud';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function setState(
  turn: Partial<Record<string, unknown>>,
  playerOverrides: Partial<Record<string, unknown>> = {},
  money = 15_000_000,
) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{
      id: 'p1', name: 'Maya', token: 'red', money, position: 0,
      isBankrupt: false, isConnected: true,
      isJailed: false, jailTurns: 0, jailCardCount: 0,
      ...playerOverrides,
    }],
    turn: { currentPlayerId: 'p1', phase: 'waiting', hasRolled: false, ...turn },
    config: { maxPlayers: 4 }, properties: [],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('TurnHud', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  // ── Non-jailed roll ──────────────────────────────────────────────────────────

  it('enables Roll on my waiting turn and emits TURN_ROLL_DICE (not jailed)', () => {
    setState({ phase: 'waiting', hasRolled: false });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TurnHud />);
    const roll = screen.getByRole('button', { name: /roll/i });
    expect((roll as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(roll);
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_ROLL_DICE);
    expect(emit).not.toHaveBeenCalledWith(EVENTS.JAIL_ROLL);
  });

  it('disables Roll during moving and shows my money', () => {
    setState({ phase: 'moving', hasRolled: true });
    render(<TurnHud />);
    expect((screen.getByRole('button', { name: /roll/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/£15\.000M/)).toBeTruthy();
  });

  it('enables End Turn in action phase and emits TURN_END', () => {
    setState({ phase: 'action', hasRolled: true });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TurnHud />);
    const endBtn = screen.getByRole('button', { name: /end turn/i });
    expect((endBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(endBtn);
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_END);
  });

  // ── Jailed roll branch ───────────────────────────────────────────────────────

  it('emits TURN_ROLL_DICE (not JAIL_ROLL) when jailed player clicks Roll', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 1, jailCardCount: 0 });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TurnHud />);
    const roll = screen.getByRole('button', { name: /roll/i });
    expect((roll as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(roll);
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_ROLL_DICE);
    expect(emit).not.toHaveBeenCalledWith(EVENTS.JAIL_ROLL);
  });

  // ── Jail action buttons ──────────────────────────────────────────────────────

  it('shows Pay Fine and Use Card buttons only when jailed and waiting', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 0, jailCardCount: 1 });
    render(<TurnHud />);
    expect(screen.getByRole('button', { name: /pay fine/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /use card/i })).toBeTruthy();
  });

  it('does NOT show jail buttons when not jailed', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: false });
    render(<TurnHud />);
    expect(screen.queryByRole('button', { name: /pay fine/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /use card/i })).toBeNull();
  });

  it('Pay Fine button emits JAIL_PAY_FINE', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 0, jailCardCount: 0 });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TurnHud />);
    fireEvent.click(screen.getByRole('button', { name: /pay fine/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.JAIL_PAY_FINE);
  });

  it('Use Card button emits JAIL_USE_CARD when player has cards', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 0, jailCardCount: 1 });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TurnHud />);
    const useCard = screen.getByRole('button', { name: /use card/i });
    expect((useCard as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(useCard);
    expect(emit).toHaveBeenCalledWith(EVENTS.JAIL_USE_CARD);
  });

  it('Use Card button is disabled when jailCardCount is 0', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 0, jailCardCount: 0 });
    render(<TurnHud />);
    const useCard = screen.getByRole('button', { name: /use card/i });
    expect((useCard as HTMLButtonElement).disabled).toBe(true);
  });

  it('jail action buttons hidden once past waiting phase (e.g. action)', () => {
    setState({ phase: 'action', hasRolled: true }, { isJailed: true, jailTurns: 0, jailCardCount: 1 });
    render(<TurnHud />);
    expect(screen.queryByRole('button', { name: /pay fine/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /use card/i })).toBeNull();
  });

  it('shows Free Parking pill when freeParkingPool > 0', () => {
    useGameStore.getState().update({
      roomCode: 'ABCD', status: 'in-progress',
      players: [{ id: 'p1', name: 'Maya', token: 'red', money: 15_000_000, position: 0, isBankrupt: false, isConnected: true, isJailed: false, jailTurns: 0, jailCardCount: 0 }],
      turn: { currentPlayerId: 'p1', phase: 'waiting', hasRolled: false },
      config: { maxPlayers: 4 }, properties: [],
      freeParkingPool: 5_000_000,
    } as unknown as import('../types/GameState').GameState);
    useGameStore.getState().setMyPlayerId('p1');
    render(<TurnHud />);
    // The pill renders "FP: " and "£5.000M" as adjacent text nodes in one span
    expect(screen.getByText(/FP:/)).toBeTruthy();
    // Use getAllByText since £5.000M also appears in the player money display
    const fiveM = screen.getAllByText(/5\.000M/);
    expect(fiveM.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT show Free Parking pill when freeParkingPool is 0', () => {
    setState({ phase: 'waiting', hasRolled: false });
    render(<TurnHud />);
    expect(screen.queryByText(/FP:/)).toBeNull();
  });
});
