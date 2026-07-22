import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GameOverScreen } from './GameOverScreen';
import { useGameStore } from '../state/gameStore';

function seat(id: string, name: string, money: number, isBankrupt = false) {
  return { id, name, token: 'red', money, isBankrupt } as any;
}
function setOver(winnerId: string) {
  useGameStore.getState().setGameOver({
    winnerId,
    finalStandings: [seat('p1', 'Maya', 20_000_000), seat('p2', 'Jonas', 0, true), seat('p3', 'Aria', 5_000_000)],
  });
  useGameStore.getState().setMyPlayerId('p1');
}

describe('GameOverScreen', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('announces my win and lists standings, bankrupt last', () => {
    setOver('p1');
    render(<GameOverScreen />);
    expect(screen.getByText(/you win/i)).toBeTruthy();
    const rows = screen.getAllByTestId('standing');
    expect(rows[0].textContent).toContain('Maya');   // richest
    expect(rows[rows.length - 1].textContent).toContain('Jonas'); // bankrupt last
  });

  it('Back to Menu resets to the menu screen', () => {
    setOver('p2');
    render(<GameOverScreen />);
    expect(screen.getByText(/jonas wins/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /back to menu/i }));
    expect(useGameStore.getState().screen).toBe('menu');
  });

  it('renders nothing without a gameOver payload', () => {
    const { container } = render(<GameOverScreen />);
    expect(container.firstChild).toBe(null);
  });
});
