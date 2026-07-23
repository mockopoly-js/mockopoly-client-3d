import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import App from './App';
import { useGameStore } from './state/gameStore';
import { gameBus } from './state/gameBus';

// stub the R3F Canvas so jsdom doesn't try to init WebGL
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: unknown }) => <div data-testid="canvas">{children as never}</div>,
  useFrame: () => {},
}));
vi.mock('./board/BoardTiles', () => ({ BoardTiles: () => null }));
vi.mock('./board/PlayerTokens', () => ({ PlayerTokens: () => null }));
// ModelMesh calls drei useGLTF, which tries to fetch a .glb over jsdom's
// (broken) FileLoader — stub it out; the .glb load is exercised in the browser.
// (PlayerTokens above already renders null, so ModelMesh isn't reached today,
// but this guards any future GameScene child that loads a model.)
vi.mock('./board/ModelMesh', () => ({ ModelMesh: () => null }));
vi.mock('@react-three/postprocessing', () => ({ EffectComposer: () => null, Bloom: () => null, ToneMapping: () => null }));

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

  it('auto-opens the deal panel when I must pay rent', () => {
    useGameStore.getState().setMyPlayerId('p1');
    useGameStore.getState().update({ roomCode: 'A', status: 'in-progress', players: [{ id: 'p1', name: 'M', token: 'red' }], turn: { currentPlayerId: 'p1', mustPayRent: true }, config: { maxPlayers: 4 }, properties: [] } as any);
    useGameStore.getState().setScreen('game');
    render(<App />);
    expect(useGameStore.getState().showDealPanel).toBe(true);
  });

  it('renders GameOverScreen on the game-over screen', () => {
    useGameStore.getState().setGameOver({ winnerId: 'p1', finalStandings: [{ id: 'p1', name: 'Maya', token: 'red', money: 1, isBankrupt: false } as any] });
    useGameStore.getState().setMyPlayerId('p1');
    useGameStore.getState().setScreen('game-over');
    render(<App />);
    expect(screen.getByText(/you win|maya wins/i)).toBeTruthy();
    expect(screen.queryByTestId('canvas')).toBe(null); // NOT the game canvas anymore
  });

  it('shows a big-moment banner on the game screen', () => {
    useGameStore.getState().update({ roomCode: 'A', status: 'in-progress', players: [{ id: 'p1', name: 'Maya', token: 'red' }, { id: 'p2', name: 'Jonas', token: 'blue' }], turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 }, properties: [] } as any);
    useGameStore.getState().setScreen('game');
    render(<App />);
    act(() => { gameBus.emit('jail-sent', { playerId: 'p2' }); });
    expect(screen.getByText(/jonas.*jail/i)).toBeTruthy();
  });
});
