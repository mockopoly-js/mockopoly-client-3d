import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerPods } from './PlayerPods';
import { useGameStore } from '../state/gameStore';
import { TOKEN_HEX } from '../constants/theme';
import type { GameState } from '../types/GameState';

function setPlayers(players: unknown[], currentPlayerId = 'p1') {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players, turn: { currentPlayerId }, config: { maxPlayers: 4 }, properties: [],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}
const seat = (id: string, name: string, extra = {}) => ({
  id, name, token: 'red', money: 15_000_000, position: 0,
  isJailed: false, isBankrupt: false, isConnected: true, isHost: false, ...extra,
});

describe('PlayerPods', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('renders a pod per OPPONENT with money, and no duplicate row for me', () => {
    // My own name, cash and jail state live in TurnHud's centre readout, so a
    // pod for myself would be a second competing copy of all three.
    setPlayers([seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas', { token: 'blue' })]);
    const { container } = render(<PlayerPods />);
    expect(screen.queryByText('Maya')).toBe(null);
    expect(screen.getByText('Jonas')).toBeTruthy();
    const money = [...container.querySelectorAll('.kit-money')].map((n) => n.textContent);
    expect(money).toEqual(['£15.000M']);
  });

  it('marks jailed and bankrupt players', () => {
    setPlayers([seat('p1', 'Maya'), seat('p2', 'Jonas', { isJailed: true }), seat('p3', 'Kwan', { isBankrupt: true })]);
    const { container } = render(<PlayerPods />);
    expect(screen.getByText(/jail/i)).toBeTruthy();
    expect(screen.getByText(/bankrupt/i)).toBeTruthy();
    expect(container.querySelector('.kit-pod.is-out')).not.toBe(null);
  });

  it('rings the active player — whose-turn cue 2 of 3', () => {
    setPlayers([seat('p1', 'Maya'), seat('p2', 'Jonas', { token: 'blue' })], 'p2');
    const { container } = render(<PlayerPods />);
    const pod = container.querySelector('.kit-pod');
    expect(pod?.className).toContain('is-turn');
    expect(pod?.getAttribute('style')).toContain(TOKEN_HEX.blue);
  });

  it('keeps my own row when I am bankrupt, so a spectator still sees the seat', () => {
    setPlayers([seat('p1', 'Maya', { isBankrupt: true }), seat('p2', 'Jonas', { token: 'blue' })]);
    render(<PlayerPods />);
    expect(screen.getByText('Maya')).toBeTruthy();
  });

  it('flags a disconnected opponent', () => {
    setPlayers([seat('p1', 'Maya'), seat('p2', 'Jonas', { isConnected: false })]);
    const { container } = render(<PlayerPods />);
    expect(screen.getByText(/offline/i)).toBeTruthy();
    expect(container.querySelector('.kit-pod.is-offline')).not.toBe(null);
  });
});
