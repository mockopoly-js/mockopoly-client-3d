import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import App from './App';
import { useGameStore } from './state/gameStore';
import { SCREEN_TO_PATH } from './state/useScreenRouting';
import { gameBus } from './state/gameBus';
import { socketManager } from './network/SocketManager';
import { EVENTS } from './types/SocketEvents';

// Lazy-import of GameScene: mock at the module level so React.lazy resolves
// synchronously in jsdom without spinning up a real WebGL canvas.
// Distinct testid (not "canvas") so the assertion genuinely proves the lazy
// GameScene chunk resolved — the R3F Canvas mock below also renders
// data-testid="canvas", which would otherwise pass even if lazy never resolved.
vi.mock('./screens/GameScene', () => ({
  GameScene: () => <div data-testid="game-scene" />,
}));

// stub the R3F Canvas so jsdom doesn't try to init WebGL
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: unknown }) => <div data-testid="canvas">{children as never}</div>,
  useFrame: () => {},
}));
vi.mock('./board/BoardTiles', () => ({ BoardTiles: () => null }));
vi.mock('./board/PlayerTokens', () => ({ PlayerTokens: () => null }));
// Dice3D (now mounted in GameScene) drives three via useFrame; stub it out so
// jsdom never exercises the R3F frame loop — the tumble is browser-only.
vi.mock('./board/Dice3D', () => ({ Dice3D: () => null }));
// CameraRig uses drei OrbitControls which needs a real WebGL renderer; stub it
// out so jsdom never exercises OrbitControls internals.
vi.mock('./board/CameraRig', () => ({ CameraRig: () => null }));
// SoftShadows (directly in GameScene) calls useThree internally, which throws
// outside a real Canvas. Stub it out so jsdom routing tests pass.
vi.mock('@react-three/drei', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/drei')>();
  return { ...actual, SoftShadows: () => null };
});
// ModelMesh calls drei useGLTF, which tries to fetch a .glb over jsdom's
// (broken) FileLoader — stub it out; the .glb load is exercised in the browser.
// Buildings + CityDressing (now mounted in GameScene) call `ModelMesh.preload`
// at module-eval time, so the stub must also expose a no-op `preload`, not just
// the component.
vi.mock('./board/ModelMesh', () => {
  const ModelMesh = () => null;
  ModelMesh.preload = () => {};
  return { ModelMesh };
});
vi.mock('@react-three/postprocessing', () => ({ EffectComposer: () => null, Bloom: () => null, ToneMapping: () => null }));

// The existing 6 cases drive the UI via `setScreen`/`setGameOver` then render.
// Now that App carries the router-sync hook it must render inside a Router; we
// seed MemoryRouter's initial entry to the path matching the current store
// screen so the sync hook starts consistent (these cases test the SCREENS, not
// routing — the dedicated routing cases below exercise the sync itself).
function renderApp() {
  const path = SCREEN_TO_PATH[useGameStore.getState().screen];
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App routing', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('shows the MainMenu on the menu screen', () => {
    useGameStore.getState().setScreen('menu');
    renderApp();
    expect(screen.getByPlaceholderText(/your name/i)).toBeTruthy();
  });

  it('shows the GameScene canvas on the game screen', async () => {
    seedRoomState(); // a game screen is only reachable with live room state
    useGameStore.getState().setScreen('game');
    renderApp();
    // React.lazy resolves on the next microtask even with vi.mock; waitFor
    // lets Suspense flush and the lazily-loaded GameScene appear. Asserting on
    // the distinct "game-scene" testid proves the lazy chunk actually resolved
    // (the R3F Canvas mock only renders "canvas", so it can't false-pass here).
    await waitFor(() => expect(screen.getByTestId('game-scene')).toBeTruthy());
  });

  it('renders the turn HUD on the game screen', async () => {
    seedRoomState(); // a game screen is only reachable with live room state
    useGameStore.getState().setScreen('game');
    renderApp();
    // TurnHud returns null without a turn; set a minimal in-progress state
    // (see below — this assertion is completed once App renders TurnHud)
    await waitFor(() => expect(screen.getByTestId('game-scene')).toBeTruthy());
  });

  it('opens DevHacksPanel via the keyboard chord on the game screen', () => {
    useGameStore.getState().setScreen('game');
    renderApp();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', metaKey: true, shiftKey: true, altKey: true }));
    });
    expect(useGameStore.getState().showDevHacks).toBe(true);
  });

  it('auto-opens the deal panel when I must pay rent', () => {
    useGameStore.getState().setMyPlayerId('p1');
    useGameStore.getState().update({ roomCode: 'A', status: 'in-progress', players: [{ id: 'p1', name: 'M', token: 'red' }], turn: { currentPlayerId: 'p1', mustPayRent: true }, config: { maxPlayers: 4 }, properties: [] } as any);
    useGameStore.getState().setScreen('game');
    renderApp();
    expect(useGameStore.getState().showDealPanel).toBe(true);
  });

  it('renders GameOverScreen on the game-over screen', () => {
    seedRoomState(); // game-over is only reachable with live room state
    useGameStore.getState().setGameOver({ winnerId: 'p1', finalStandings: [{ id: 'p1', name: 'Maya', token: 'red', money: 1, isBankrupt: false } as any] });
    useGameStore.getState().setMyPlayerId('p1');
    useGameStore.getState().setScreen('game-over');
    renderApp();
    expect(screen.getByText(/you win|maya wins/i)).toBeTruthy();
    expect(screen.queryByTestId('canvas')).toBe(null); // NOT the game canvas anymore
  });

  it('shows a big-moment banner on the game screen', () => {
    useGameStore.getState().update({ roomCode: 'A', status: 'in-progress', players: [{ id: 'p1', name: 'Maya', token: 'red' }, { id: 'p2', name: 'Jonas', token: 'blue' }], turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 }, properties: [] } as any);
    useGameStore.getState().setScreen('game');
    renderApp();
    act(() => { gameBus.emit('jail-sent', { playerId: 'p2' }); });
    expect(screen.getByText(/jonas.*jail/i)).toBeTruthy();
  });
});

// ─── Router ↔ screen sync ────────────────────────────────────────────────────
// Minimal in-room state so the refresh/deep-link guard treats us as "in a room".
function seedRoomState() {
  const store = useGameStore.getState();
  store.setRoomCode('ABCD');
  store.update({ roomCode: 'ABCD', status: 'lobby', players: [{ id: 'p1', name: 'M', token: 'red' }], turn: {}, config: { maxPlayers: 4 }, properties: [] } as any);
  store.setMyPlayerId('p1');
}

// Probe components live inside the Router so they can read/drive it.
let currentPath = '';
function PathProbe() {
  currentPath = useLocation().pathname;
  return null;
}
let goBack: () => void = () => {};
function BackProbe() {
  const nav = useNavigate();
  goBack = () => nav(-1);
  return null;
}

describe('router ↔ screen sync', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    vi.restoreAllMocks();
    currentPath = '';
    goBack = () => {};
  });

  it('mirrors a screen change into the URL (setScreen("lobby") → /lobby)', async () => {
    seedRoomState();
    useGameStore.getState().setScreen('menu');
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
        <PathProbe />
      </MemoryRouter>,
    );
    act(() => { useGameStore.getState().setScreen('lobby'); });
    await waitFor(() => expect(currentPath).toBe('/lobby'));
  });

  it('leaves the room when browser Back goes from /lobby to / (popstate)', async () => {
    const emitSpy = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    seedRoomState();
    useGameStore.getState().setScreen('lobby');
    // History stack ['/', '/lobby'] at index 1 with the room live and screen
    // 'lobby': going Back to '/' must leave the room (ROOM_LEAVE) + reset.
    render(
      <MemoryRouter initialEntries={['/', '/lobby']} initialIndex={1}>
        <App />
        <BackProbe />
      </MemoryRouter>,
    );

    act(() => { goBack(); });

    await waitFor(() => {
      expect(useGameStore.getState().screen).toBe('menu');
      expect(useGameStore.getState().state).toBe(null);
    });
    const leaveCalls = (emitSpy.mock.calls as any[]).filter((c: any[]) => c[0] === EVENTS.ROOM_LEAVE);
    expect(leaveCalls.length).toBe(1);
  });

  it('redirects a stateless deep-link/refresh to /game back to / (menu)', async () => {
    // No room state (fresh reset) — landing on /game must bounce to menu.
    render(
      <MemoryRouter initialEntries={['/game']}>
        <App />
        <PathProbe />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(useGameStore.getState().screen).toBe('menu');
      expect(currentPath).toBe('/');
    });
  });
});
