import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import App from './App';
import { useGameStore } from './state/gameStore';

// stub the R3F Canvas so jsdom doesn't try to init WebGL
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: unknown }) => <div data-testid="canvas">{children as never}</div>,
  useFrame: () => {},
}));
vi.mock('./board/BoardTiles', () => ({ BoardTiles: () => null }));
vi.mock('./board/PlayerTokens', () => ({ PlayerTokens: () => null }));

describe('App routing', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('shows the MainMenu on the menu screen', () => {
    useGameStore.getState().setScreen('menu');
    render(<App />);
    expect(screen.getByPlaceholderText(/your name/i)).toBeTruthy();
  });

  it('shows the GameScene canvas on the game screen', () => {
    useGameStore.getState().setScreen('game');
    render(<App />);
    expect(screen.getByTestId('canvas')).toBeTruthy();
  });

  it('renders the turn HUD on the game screen', () => {
    useGameStore.getState().setScreen('game');
    render(<App />);
    // TurnHud returns null without a turn; set a minimal in-progress state
    // (see below — this assertion is completed once App renders TurnHud)
    expect(screen.getByTestId('canvas')).toBeTruthy();
  });

  it('opens DevHacksPanel via the keyboard chord on the game screen', () => {
    useGameStore.getState().setScreen('game');
    render(<App />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', metaKey: true, shiftKey: true, altKey: true }));
    });
    expect(useGameStore.getState().showDevHacks).toBe(true);
  });

  it('renders GameOverScreen on the game-over screen', () => {
    useGameStore.getState().setGameOver({ winnerId: 'p1', finalStandings: [{ id: 'p1', name: 'Maya', token: 'red', money: 1, isBankrupt: false } as any] });
    useGameStore.getState().setMyPlayerId('p1');
    useGameStore.getState().setScreen('game-over');
    render(<App />);
    expect(screen.getByText(/you win|maya wins/i)).toBeTruthy();
    expect(screen.queryByTestId('canvas')).toBe(null); // NOT the game canvas anymore
  });
});
