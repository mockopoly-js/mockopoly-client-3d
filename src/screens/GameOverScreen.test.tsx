import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GameOverScreen } from './GameOverScreen';
import { useGameStore } from '../state/gameStore';
import type { Player } from '../types/GameState';

function seat(id: string, name: string, money: number, isBankrupt = false, token = 'red'): Player {
  // Only the fields GameOverScreen reads are set; the rest of Player is
  // irrelevant to this view, so cast the partial fixture to the full type.
  return { id, name, token, money, isBankrupt } as unknown as Player;
}
function setOver(winnerId: string) {
  useGameStore.getState().setGameOver({
    winnerId,
    finalStandings: [
      seat('p1', 'Maya', 20_000_000, false, 'blue'),
      seat('p2', 'Jonas', 0, true, 'green'),
      seat('p3', 'Aria', 5_000_000, false, 'yellow'),
    ],
  });
  useGameStore.getState().setMyPlayerId('p1');
}

describe('GameOverScreen', () => {
  beforeEach(() => { useGameStore.getState().reset(); });

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

  // ── the takeover ───────────────────────────────────────────────────────────

  it('is a kit Takeover, open, and labelled for assistive tech', () => {
    setOver('p1');
    render(<GameOverScreen />);
    const dialog = screen.getByRole('dialog', { name: /final standings/i });
    expect(dialog.classList.contains('kit-takeover')).toBe(true);
    expect(dialog.classList.contains('is-on')).toBe(true);
    expect(dialog.getAttribute('aria-hidden')).toBe('false');
  });

  it('ranks every seat and marks which one is mine', () => {
    setOver('p1');
    render(<GameOverScreen />);
    const rows = screen.getAllByTestId('standing');
    expect(rows[0].textContent).toMatch(/1st/i);
    expect(rows[0].textContent).toMatch(/you/i);
    expect(rows[1].textContent).toMatch(/2nd/i);
    expect(rows[2].textContent).toMatch(/3rd/i);
  });

  it('the winner column carries the headline number, not just the table', () => {
    setOver('p1');
    render(<GameOverScreen />);
    expect(screen.getByText(/final net worth/i)).toBeTruthy();
    // <Money> splits the amount into mark / value / unit; 20M reads "20.000M".
    const heroes = document.querySelectorAll('.kit-money--hero-lg');
    expect(heroes).toHaveLength(1);
    expect(heroes[0].textContent).toBe('£20.000M');
  });

  it('a bankrupt seat is marked by a badge, never by fading its text (R3)', () => {
    setOver('p1');
    const { container } = render(<GameOverScreen />);
    const rows = screen.getAllByTestId('standing');
    const bankrupt = rows[rows.length - 1];
    expect(within(bankrupt).getByText(/bankrupt/i)).toBeTruthy();
    const pod = container.querySelector('.kit-pod.is-out');
    expect(pod).toBeTruthy();
    expect((pod as HTMLElement).style.opacity).toBe('');
  });

  it('falls back to a neutral surface when the winner is not in the standings', () => {
    useGameStore.getState().setGameOver({
      winnerId: 'ghost',
      finalStandings: [seat('p1', 'Maya', 1_000_000)],
    });
    render(<GameOverScreen />);
    // Eyebrow AND title both read "Game over" — the fallback has no name to use.
    expect(screen.getByRole('heading', { name: /^game over$/i })).toBeTruthy();
  });
});
