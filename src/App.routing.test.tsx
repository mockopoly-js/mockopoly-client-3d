import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import { useGameStore } from './state/gameStore';

// stub the R3F Canvas so jsdom doesn't try to init WebGL
vi.mock('@react-three/fiber', () => ({ Canvas: ({ children }: { children?: unknown }) => <div data-testid="canvas">{children as never}</div> }));
vi.mock('./board/BoardTiles', () => ({ BoardTiles: () => null }));

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
});
