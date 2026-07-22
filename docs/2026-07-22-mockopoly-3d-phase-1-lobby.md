# Mockopoly 3D — Phase 1 (Lobby Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Two players can create/join a room, ready up, and start a game entirely in the new React client, with a static procedural 3D board rendering once the game begins.

**Architecture:** React screens (MainMenu, Lobby, GameScene) rendered by a `screen` enum in the zustand `gameStore`. UI sits on the Phase 0 infra (SocketManager, GameStateSync, gameStore, gameBus) unchanged — components emit room events via `socketManager` and react to relayed `gameBus` events + `GAME_STATE_UPDATE` store snapshots. The 3D board is an R3F component built from ported normalized tile-ring math + vendored `BOARD_SPACES`.

**Tech Stack:** React 18, react-three-fiber + three, zustand, socket.io-client, Vitest + @testing-library/react.

## Global Constraints

- **Server + 2D client untouched.** Same socket protocol/URL.
- **Build on Phase 0 infra as-is.** Do NOT modify `src/network/SocketManager.ts` or `src/network/GameStateSync.ts`. `gameStore` may be extended (add `screen`). `GameStateSync.register()` relays `room-created`/`room-joined`/`room-rejected`/`countdown` to `gameBus` and writes ONLY `GAME_STATE_UPDATE` to the store — so create/join durable writes are UI-owned (MainMenu does them).
- **Derive the current screen from `GameState.status`, never from event ordering.** `GameStatus`: `lobby → starting → in-progress → game-over`.
- **Vendored contract stays byte-verbatim** with the server; `noUnusedLocals:false` remains.
- **Exact event constants + payloads (verbatim from `src/types/SocketEvents.ts`):**
  - Emit: `ROOM_CREATE` `{playerName, token}` · `ROOM_JOIN` `{roomCode, playerName, token, reconnectToken?}` · `ROOM_READY` `{isReady}` · `ROOM_START` (no arg) · `ROOM_LEAVE` (no arg).
  - Relayed on gameBus: `'room-created'` `{roomCode, state}` · `'room-joined'` `{state}` · `'room-rejected'` `{reason}` · `'countdown'` `{seconds}`.
  - `myPlayerId` is read from `socketManager.playerId` (set internally from `connect-ack`).
- **Player fields used:** `id, name, token, isHost, isReady, isConnected`. `TokenType = 'red'|'blue'|'green'|'yellow'|'purple'|'orange'|'cyan'|'pink'`.
- **Decisions on open questions (baked in):** START soft-disabled when `players.length < 2` (server is final authority); lobby slots driven by `gameStore.state.players`; no new gameBus relays; no auto-rejoin on boot (manual JOIN passes stored `reconnectToken`); disconnected slot = dimmed badge (no per-slot countdown); no client token-collision UI; `BOARD_WORLD_SIZE = 10`.
- **Git:** branch `feat/lobby` OFF `feat/scaffold`; `gh` + `git@personal:` remote; no direct pushes/merges to `main`/`staging`/`dev`; PR only; clean tree after each commit; no `.superpowers/` committed.

**Working directory:** `/Users/arslan/Desktop/Monopoly/mockopoly-client-3d`. Board data source: `/Users/arslan/Desktop/Monopoly/mockopoly-server/src/constants/board.ts`.

---

### Task 1: Branch + screen routing state in the store

**Files:**
- Modify: `src/state/gameStore.ts` (add `Screen`, `screen`, `setScreen`; `reset()` → `'menu'`)
- Test: `src/state/gameStore.test.ts` (append screen tests)

**Interfaces:**
- Produces: `Screen = 'menu' | 'lobby' | 'game' | 'game-over'`; store field `screen: Screen` (initial `'menu'`); action `setScreen(s: Screen): void`. Consumed by App routing (Task 6) and MainMenu/Lobby (Tasks 3–4).

- [ ] **Step 1: Create the branch**

```bash
cd /Users/arslan/Desktop/Monopoly/mockopoly-client-3d
git checkout feat/scaffold
git checkout -b feat/lobby
```

- [ ] **Step 2: Append the failing test**

Add to `src/state/gameStore.test.ts` inside the existing `describe('gameStore', ...)`:

```ts
  it('starts on the menu screen and can navigate', () => {
    expect(useGameStore.getState().screen).toBe('menu');
    useGameStore.getState().setScreen('lobby');
    expect(useGameStore.getState().screen).toBe('lobby');
  });

  it('reset returns to the menu screen', () => {
    useGameStore.getState().setScreen('game');
    useGameStore.getState().reset();
    expect(useGameStore.getState().screen).toBe('menu');
  });
```

- [ ] **Step 3: Run it, expect fail**

Run: `npm test -- gameStore`
Expected: FAIL — `screen`/`setScreen` undefined.

- [ ] **Step 4: Implement in `src/state/gameStore.ts`**

Add the type above the `GameStore` interface:

```ts
export type Screen = 'menu' | 'lobby' | 'game' | 'game-over';
```

Add to the `GameStore` interface (state + action):

```ts
  screen: Screen;
  setScreen: (screen: Screen) => void;
```

Add to the store's initial state (near `state: null`):

```ts
  screen: 'menu',
```

Add the action (near `setRoomCode`):

```ts
  setScreen: (screen) => set({ screen }),
```

In `reset()`, add `screen: 'menu'` to the `set({...})` patch object.

- [ ] **Step 5: Run tests, expect pass**

Run: `npm test -- gameStore`
Expected: PASS (8 tests now).

- [ ] **Step 6: Commit**

```bash
git add src/state/gameStore.ts src/state/gameStore.test.ts
git commit -m "feat(lobby): add screen routing enum to gameStore"
```

---

### Task 2: Board data + tile-ring geometry + UI color constants

**Files:**
- Create: `src/constants/board.ts` (vendored `BOARD_SPACES`)
- Create: `src/constants/theme.ts` (`TOKEN_HEX`, `COLOR_GROUP_HEX`)
- Create: `src/board/positions.ts` (`SPACE_POSITIONS`, `BOARD_WORLD_SIZE`, `tileToWorld`)
- Test: `src/board/positions.test.ts`

**Interfaces:**
- Produces: `BOARD_SPACES: BoardSpace[]` (40); `TOKEN_HEX: Record<TokenType, string>`; `COLOR_GROUP_HEX: Record<ColorGroup, string>`; `SPACE_POSITIONS: {x:number;y:number}[]` (40 normalized); `BOARD_WORLD_SIZE = 10`; `tileToWorld(index:number): [number,number,number]`.

- [ ] **Step 1: Vendor the board data**

```bash
cp /Users/arslan/Desktop/Monopoly/mockopoly-server/src/constants/board.ts src/constants/board.ts
```

Then open `src/constants/board.ts` and confirm it exports `BOARD_SPACES` and imports its `BoardSpace`/`ColorGroup`/`SpaceType` types from `../types/GameState` (fix the import path to `../types/GameState` if the server used a different relative path). Do NOT alter the space data. If the server file imports anything that doesn't exist in the client (e.g. `RULES`), remove only unused imports needed to compile — but keep all `BOARD_SPACES` data byte-identical.

- [ ] **Step 2: Write UI color constants**

Create `src/constants/theme.ts`:

```ts
import type { TokenType, ColorGroup } from '../types/GameState';

/** Player token colors (hex), matching the 2D client's TOKEN_HEX. */
export const TOKEN_HEX: Record<TokenType, string> = {
  red: '#e74c3c',
  blue: '#3498db',
  green: '#2ecc71',
  yellow: '#f1c40f',
  purple: '#9b59b6',
  orange: '#e67e22',
  cyan: '#1abc9c',
  pink: '#e91e8c',
};

/** Property color-group strip colors (fixed data palette — property identity only). */
export const COLOR_GROUP_HEX: Record<ColorGroup, string> = {
  brown: '#8d5a3c',
  'light-blue': '#8fd3ef',
  pink: '#e05aa6',
  orange: '#ef8a3c',
  red: '#e5473b',
  yellow: '#f4cf3a',
  green: '#3f9b57',
  'dark-blue': '#2f5fd0',
  railroad: '#2b2b2b',
  utility: '#b9ad93',
};
```

(If `ColorGroup`'s members differ from these keys, match the union in `types/GameState.ts` exactly — add/rename keys to satisfy the `Record<ColorGroup, string>` type. Keep the hex values above.)

- [ ] **Step 2b: Write the failing positions test**

Create `src/board/positions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SPACE_POSITIONS, tileToWorld, BOARD_WORLD_SIZE } from './positions';

describe('SPACE_POSITIONS', () => {
  it('has 40 tiles', () => {
    expect(SPACE_POSITIONS).toHaveLength(40);
  });
  it('places the four corners correctly', () => {
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    // GO bottom-right, Jail bottom-left, Free Parking top-left, GoToJail top-right
    expect(near(SPACE_POSITIONS[0].x, SPACE_POSITIONS[0].y)).toBe(true); // (CE,CE)
    expect(SPACE_POSITIONS[0].x).toBeGreaterThan(0.9);
    expect(SPACE_POSITIONS[10].x).toBeLessThan(0.1);   // (CC,CE)
    expect(SPACE_POSITIONS[10].y).toBeGreaterThan(0.9);
    expect(SPACE_POSITIONS[20].x).toBeLessThan(0.1);   // (CC,CC)
    expect(SPACE_POSITIONS[20].y).toBeLessThan(0.1);
    expect(SPACE_POSITIONS[30].x).toBeGreaterThan(0.9); // (CE,CC)
    expect(SPACE_POSITIONS[30].y).toBeLessThan(0.1);
  });
  it('all tiles are within the unit square', () => {
    for (const p of SPACE_POSITIONS) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
  it('tileToWorld centers the board at the origin plane', () => {
    const [x, y, z] = tileToWorld(20); // top-left corner → negative x, negative z
    expect(y).toBe(0);
    expect(x).toBeCloseTo((SPACE_POSITIONS[20].x - 0.5) * BOARD_WORLD_SIZE, 6);
    expect(z).toBeCloseTo((SPACE_POSITIONS[20].y - 0.5) * BOARD_WORLD_SIZE, 6);
  });
});
```

- [ ] **Step 3: Run it, expect fail**

Run: `npm test -- positions`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `src/board/positions.ts`** (ported normalized ring math)

```ts
/**
 * Normalized (0–1) center of each of the 40 board tiles, ported verbatim from
 * the 2D client's Board.ts ring math. Renderer-invariant.
 * Ring is clockwise from GO at bottom-right (index 0).
 */
const CORNER = 0.134;
const CC = CORNER / 2;            // near-corner center  ≈0.067
const CE = 1 - CORNER / 2;        // far-corner center   ≈0.933
const SW = (1 - 2 * CORNER) / 9;  // regular tile width
const S: number[] = [];
for (let i = 0; i < 9; i++) S.push(CORNER + SW / 2 + i * SW);

export interface TilePos { x: number; y: number }

function buildPositions(): TilePos[] {
  const p: TilePos[] = new Array(40);
  p[0] = { x: CE, y: CE };                                 // GO
  for (let i = 1; i <= 9; i++) p[i] = { x: S[9 - i], y: CE };   // bottom row
  p[10] = { x: CC, y: CE };                                // Jail
  for (let i = 11; i <= 19; i++) p[i] = { x: CC, y: S[19 - i] }; // left column
  p[20] = { x: CC, y: CC };                                // Free Parking
  for (let i = 21; i <= 29; i++) p[i] = { x: S[i - 21], y: CC }; // top row
  p[30] = { x: CE, y: CC };                                // Go To Jail
  for (let i = 31; i <= 39; i++) p[i] = { x: CE, y: S[i - 31] }; // right column
  return p;
}

export const SPACE_POSITIONS: TilePos[] = buildPositions();

/** World-plane size of the board (three.js units). */
export const BOARD_WORLD_SIZE = 10;

/** Map a tile index to a world-space [x, y=0, z] on the board plane, centered at origin. */
export function tileToWorld(index: number): [number, number, number] {
  const pos = SPACE_POSITIONS[index];
  return [(pos.x - 0.5) * BOARD_WORLD_SIZE, 0, (pos.y - 0.5) * BOARD_WORLD_SIZE];
}
```

- [ ] **Step 5: Add a BOARD_SPACES length test**

Append to `src/board/positions.test.ts`:

```ts
import { BOARD_SPACES } from '../constants/board';
describe('BOARD_SPACES', () => {
  it('has 40 spaces indexed 0..39', () => {
    expect(BOARD_SPACES).toHaveLength(40);
    BOARD_SPACES.forEach((s, i) => expect(s.index).toBe(i));
  });
});
```

- [ ] **Step 6: Run tests + build, expect pass**

Run: `npm test -- positions` then `npm run build`
Expected: positions tests PASS (5), build green. If `BOARD_SPACES[i].index` isn't a field, adjust the assertion to the actual index field name from `BoardSpace` (check `types/GameState.ts`) — do not change the data.

- [ ] **Step 7: Commit**

```bash
git add src/constants/board.ts src/constants/theme.ts src/board/positions.ts src/board/positions.test.ts
git commit -m "feat(lobby): vendor board data, add tile-ring geometry + color constants"
```

---

### Task 3: MainMenu component (create/join)

**Files:**
- Create: `src/screens/MainMenu.tsx`
- Test: `src/screens/MainMenu.test.tsx`

**Interfaces:**
- Consumes: `socketManager`, `gameBus`, `useGameStore` (`update`, `setRoomCode`, `setMyPlayerId`, `setReconnectToken`, `setScreen`, `selectMyPlayer`, `getStoredReconnectToken`), `EVENTS`, `TOKEN_HEX`, types `TokenType`, `S_RoomCreated`, `S_RoomJoined`, `S_RoomRejected`.
- Produces: `<MainMenu />`.

- [ ] **Step 1: Write the failing test**

Create `src/screens/MainMenu.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MainMenu } from './MainMenu';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function fakeState(status = 'lobby'): GameState {
  return {
    roomCode: 'ABCD',
    status,
    players: [{ id: 'p1', name: 'Maya', token: 'red', isHost: true, isReady: false, isConnected: true, reconnectToken: 'tok-1' }],
    config: { maxPlayers: 4 },
  } as unknown as GameState;
}

describe('MainMenu', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    vi.restoreAllMocks();
    vi.spyOn(socketManager, 'playerId', 'get').mockReturnValue('p1');
  });

  it('disables CREATE until a name is entered', () => {
    render(<MainMenu />);
    const create = screen.getByRole('button', { name: /create room/i });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/your name/i), { target: { value: 'Maya' } });
    expect(create).not.toBeDisabled();
  });

  it('emits ROOM_CREATE with name + token on create', () => {
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<MainMenu />);
    fireEvent.change(screen.getByPlaceholderText(/your name/i), { target: { value: 'Maya' } });
    fireEvent.click(screen.getByRole('button', { name: /create room/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.ROOM_CREATE, { playerName: 'Maya', token: 'red' });
  });

  it('on room-created: writes store, sets my id, navigates to lobby', () => {
    render(<MainMenu />);
    gameBus.emit('room-created', { roomCode: 'ABCD', state: fakeState() });
    const s = useGameStore.getState();
    expect(s.roomCode).toBe('ABCD');
    expect(s.state?.roomCode).toBe('ABCD');
    expect(s.myPlayerId).toBe('p1');
    expect(s.screen).toBe('lobby');
  });

  it('on room-rejected: shows the reason and stays', () => {
    render(<MainMenu />);
    gameBus.emit('room-rejected', { reason: 'Room is full' });
    expect(screen.getByText(/room is full/i)).toBeTruthy();
    expect(useGameStore.getState().screen).toBe('menu');
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `npm test -- MainMenu`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/screens/MainMenu.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore, getStoredReconnectToken, selectMyPlayer } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import { TOKEN_HEX } from '../constants/theme';
import type { TokenType } from '../types/GameState';
import type { S_RoomCreated, S_RoomJoined, S_RoomRejected } from '../types/SocketEvents';

const TOKENS = Object.keys(TOKEN_HEX) as TokenType[];

export function MainMenu() {
  const [name, setName] = useState('');
  const [token, setToken] = useState<TokenType>('red');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const applyJoined = (state: S_RoomJoined['state']) => {
      const store = useGameStore.getState();
      store.setRoomCode(state.roomCode);
      store.update(state);
      store.setMyPlayerId(socketManager.playerId ?? '');
      const me = selectMyPlayer(useGameStore.getState());
      if (me?.reconnectToken) store.setReconnectToken(me.reconnectToken);
    };
    const onCreated = (d: S_RoomCreated) => { applyJoined(d.state); useGameStore.getState().setScreen('lobby'); };
    const onJoined = (d: S_RoomJoined) => {
      applyJoined(d.state);
      useGameStore.getState().setScreen(d.state.status === 'in-progress' ? 'game' : 'lobby');
    };
    const onRejected = (d: S_RoomRejected) => setError(d.reason);
    gameBus.on('room-created', onCreated);
    gameBus.on('room-joined', onJoined);
    gameBus.on('room-rejected', onRejected);
    return () => {
      gameBus.off('room-created', onCreated);
      gameBus.off('room-joined', onJoined);
      gameBus.off('room-rejected', onRejected);
    };
  }, []);

  const trimmedName = name.trim();
  const canCreate = trimmedName.length > 0;
  const normalizedCode = code.trim().toUpperCase();
  const canJoin = canCreate && normalizedCode.length >= 4;

  const create = () => {
    if (!canCreate) return;
    setError(null);
    socketManager.emit(EVENTS.ROOM_CREATE, { playerName: trimmedName, token });
  };
  const join = () => {
    if (!canJoin) return;
    setError(null);
    socketManager.emit(EVENTS.ROOM_JOIN, {
      roomCode: normalizedCode,
      playerName: trimmedName,
      token,
      reconnectToken: getStoredReconnectToken() ?? undefined,
    });
  };

  return (
    <div style={wrap}>
      <h1 style={{ fontFamily: FONT, color: '#3b3224', margin: 0 }}>Mockopoly</h1>
      <input
        placeholder="Enter your name..."
        maxLength={16}
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={input}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {TOKENS.map((t) => (
          <button
            key={t}
            aria-label={t}
            onClick={() => setToken(t)}
            style={{
              width: 34, height: 34, borderRadius: '50%', cursor: 'pointer',
              background: TOKEN_HEX[t],
              border: token === t ? '3px solid #3b3224' : '3px solid transparent',
              transform: token === t ? 'scale(1.15)' : 'scale(1)',
            }}
          />
        ))}
      </div>
      <button onClick={create} disabled={!canCreate} style={primaryBtn}>Create Room</button>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          placeholder="ABCDEF"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          style={{ ...input, textTransform: 'uppercase', letterSpacing: '0.2em' }}
        />
        <button onClick={join} disabled={!canJoin} style={primaryBtn}>Join</button>
      </div>
      {error && <div role="alert" style={{ color: '#c53a26', fontFamily: FONT }}>{error}</div>}
    </div>
  );
}

const FONT = "ui-rounded, system-ui, sans-serif";
const wrap: React.CSSProperties = {
  position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', gap: 16,
  alignItems: 'center', justifyContent: 'center', background: '#eaf7fc', fontFamily: FONT,
};
const input: React.CSSProperties = {
  fontFamily: FONT, fontSize: 16, padding: '10px 14px', borderRadius: 12, border: '2px solid #e7dcbf', outline: 'none',
};
const primaryBtn: React.CSSProperties = {
  fontFamily: FONT, fontWeight: 800, fontSize: 15, color: '#fff', background: '#e07d0a',
  border: 'none', borderRadius: 14, padding: '12px 22px', cursor: 'pointer',
};
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test -- MainMenu`
Expected: PASS (4). If the `socketManager.playerId` getter spy fails (it's a class getter on a singleton), fall back to `vi.spyOn(socketManager, 'setPlayerId')` is not needed — instead the test may set it via `socketManager.setPlayerId('p1')`; adjust the test's `beforeEach` accordingly and keep the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/screens/MainMenu.tsx src/screens/MainMenu.test.tsx
git commit -m "feat(lobby): MainMenu screen (create/join over room protocol)"
```

---

### Task 4: Lobby component

**Files:**
- Create: `src/screens/Lobby.tsx`
- Test: `src/screens/Lobby.test.tsx`

**Interfaces:**
- Consumes: `socketManager`, `gameBus`, `useGameStore` (+ `selectMyPlayer`), `EVENTS`, `TOKEN_HEX`, `Player`.
- Produces: `<Lobby />`.

- [ ] **Step 1: Write the failing test**

Create `src/screens/Lobby.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Lobby } from './Lobby';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function seat(id: string, name: string, extra: Partial<Record<string, unknown>> = {}) {
  return { id, name, token: 'red', isHost: false, isReady: false, isConnected: true, reconnectToken: '', ...extra };
}
function setState(players: unknown[], status = 'lobby') {
  useGameStore.getState().update({ roomCode: 'ABCD', status, players, config: { maxPlayers: 4 } } as unknown as GameState);
  useGameStore.getState().setRoomCode('ABCD');
}

describe('Lobby', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    vi.restoreAllMocks();
    vi.spyOn(socketManager, 'playerId', 'get').mockReturnValue('p1');
  });

  it('renders a slot per player and marks host + you', () => {
    setState([seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas')]);
    render(<Lobby />);
    expect(screen.getByText('Maya')).toBeTruthy();
    expect(screen.getByText('Jonas')).toBeTruthy();
    expect(screen.getByText(/host/i)).toBeTruthy();
    expect(screen.getByText(/you/i)).toBeTruthy();
  });

  it('emits ROOM_READY when the ready button is clicked', () => {
    setState([seat('p1', 'Maya', { isHost: true })]);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<Lobby />);
    fireEvent.click(screen.getByRole('button', { name: /ready/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.ROOM_READY, { isReady: true });
  });

  it('shows START only for the host and soft-disables below 2 players', () => {
    setState([seat('p1', 'Maya', { isHost: true })]);
    render(<Lobby />);
    expect(screen.getByRole('button', { name: /start game/i })).toBeDisabled();
  });

  it('routes to game when status becomes in-progress', () => {
    setState([seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas')]);
    render(<Lobby />);
    setState([seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas')], 'in-progress');
    // the routing effect runs on status change:
    expect(useGameStore.getState().screen).toBe('game');
  });

  it('shows the countdown from the gameBus', () => {
    setState([seat('p1', 'Maya', { isHost: true })]);
    render(<Lobby />);
    gameBus.emit('countdown', { seconds: 3 });
    expect(screen.getByText(/starting in 3/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `npm test -- Lobby`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/screens/Lobby.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { socketManager } from '../network/SocketManager';
import { gameBus } from '../state/gameBus';
import { useGameStore, selectMyPlayer } from '../state/gameStore';
import { EVENTS } from '../types/SocketEvents';
import { TOKEN_HEX } from '../constants/theme';
import type { Player, TokenType } from '../types/GameState';

export function Lobby() {
  const state = useGameStore((s) => s.state);
  const roomCode = useGameStore((s) => s.roomCode);
  const setScreen = useGameStore((s) => s.setScreen);
  const [countdown, setCountdown] = useState<number | null>(null);

  const players: Player[] = state?.players ?? [];
  const myId = socketManager.playerId;
  const me = selectMyPlayer(useGameStore.getState());
  const isHost = !!me?.isHost;
  const status = state?.status;

  // route into the game once the server flips to in-progress
  useEffect(() => {
    if (status === 'in-progress') setScreen('game');
  }, [status, setScreen]);

  // ephemeral countdown ticks
  useEffect(() => {
    const onTick = (d: { seconds: number }) => setCountdown(d.seconds);
    gameBus.on('countdown', onTick);
    return () => gameBus.off('countdown', onTick);
  }, []);

  const toggleReady = () => socketManager.emit(EVENTS.ROOM_READY, { isReady: !me?.isReady });
  const start = () => socketManager.emit(EVENTS.ROOM_START);
  const leave = () => { socketManager.emit(EVENTS.ROOM_LEAVE); useGameStore.getState().reset(); };
  const copyCode = () => { if (roomCode) navigator.clipboard?.writeText(roomCode); };

  const locked = status === 'starting';
  const maxPlayers = state?.config?.maxPlayers ?? 4;

  return (
    <div style={wrap}>
      <button onClick={copyCode} style={codeChip}>Room {roomCode ?? '----'}</button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 320 }}>
        {Array.from({ length: maxPlayers }).map((_, i) => {
          const p = players[i];
          if (!p) return <div key={i} style={emptySlot}>Empty</div>;
          const tags = [p.isHost ? 'HOST' : null, p.id === myId ? 'YOU' : null].filter(Boolean).join(' • ');
          return (
            <div key={i} style={{ ...slot, opacity: p.isConnected ? 1 : 0.5 }}>
              <span style={{ ...dot, background: TOKEN_HEX[p.token as TokenType] }} />
              <span style={{ fontWeight: 800, flex: 1 }}>{p.name}{tags && <small style={{ color: '#6d6151', fontWeight: 700 }}> {tags}</small>}</span>
              {!p.isConnected && <span style={{ color: '#c53a26', fontWeight: 800, fontSize: 11 }}>DISCONNECTED</span>}
              <span style={{ color: p.isReady ? '#2f9153' : '#9a8f7c', fontWeight: 800, fontSize: 12 }}>
                {p.isReady ? 'READY' : 'NOT READY'}
              </span>
            </div>
          );
        })}
      </div>

      {countdown !== null && status === 'starting'
        ? <div style={{ fontWeight: 800, fontSize: 20, color: '#e07d0a' }}>Starting in {countdown}...</div>
        : (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={toggleReady} disabled={locked} style={{ ...btn, background: me?.isReady ? '#2a8855' : '#2a2a42', color: '#fff' }}>
              {me?.isReady ? 'Ready ✓' : 'Ready'}
            </button>
            {isHost && (
              <button onClick={start} disabled={locked || players.length < 2} style={{ ...btn, background: '#e07d0a', color: '#fff' }}>
                Start Game
              </button>
            )}
            <button onClick={leave} disabled={locked} style={{ ...btn, background: '#e7dcbf', color: '#3b3224' }}>Back</button>
          </div>
        )}
    </div>
  );
}

const FONT = "ui-rounded, system-ui, sans-serif";
const wrap: React.CSSProperties = {
  position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', gap: 18,
  alignItems: 'center', justifyContent: 'center', background: '#eaf7fc', fontFamily: FONT, color: '#3b3224',
};
const codeChip: React.CSSProperties = { fontFamily: FONT, fontWeight: 800, border: 'none', background: '#fbf6ec', borderRadius: 999, padding: '8px 16px', cursor: 'pointer' };
const slot: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: '#fbf6ec', borderRadius: 14, padding: '10px 14px' };
const emptySlot: React.CSSProperties = { ...slot, justifyContent: 'center', color: '#9a8f7c', fontWeight: 700 };
const dot: React.CSSProperties = { width: 22, height: 22, borderRadius: '50%' };
const btn: React.CSSProperties = { fontFamily: FONT, fontWeight: 800, border: 'none', borderRadius: 14, padding: '12px 20px', cursor: 'pointer' };
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test -- Lobby`
Expected: PASS (5). Same `socketManager.playerId` getter-spy caveat as Task 3 — if the getter can't be spied, use `socketManager.setPlayerId('p1')` in `beforeEach`.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Lobby.tsx src/screens/Lobby.test.tsx
git commit -m "feat(lobby): Lobby screen (slots, ready, host start, countdown)"
```

---

### Task 5: Static 3D board (R3F)

**Files:**
- Create: `src/board/BoardTiles.tsx`
- Create: `src/screens/GameScene.tsx`
- Test: `src/board/tileColor.test.ts`
- Create: `src/board/tileColor.ts`

**Interfaces:**
- Produces: `tileColor(space: BoardSpace): string` (pure helper — color-group strip color, or a neutral for non-color spaces); `<BoardTiles />` (R3F group of 40 tile meshes); `<GameScene />` (R3F `<Canvas>` scaffolding rendering the board — the Phase 1 "game" screen placeholder).

- [ ] **Step 1: Write the failing pure-helper test**

Create `src/board/tileColor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tileColor } from './tileColor';
import { BOARD_SPACES } from '../constants/board';

describe('tileColor', () => {
  it('returns a hex string for every board space', () => {
    for (const s of BOARD_SPACES) {
      expect(tileColor(s)).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
  it('colors a known property by its group', () => {
    const prop = BOARD_SPACES.find((s) => s.type === 'property' && s.colorGroup);
    expect(prop).toBeTruthy();
    expect(tileColor(prop!)).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `npm test -- tileColor`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/board/tileColor.ts`**

```ts
import type { BoardSpace } from '../types/GameState';
import { COLOR_GROUP_HEX } from '../constants/theme';

const NEUTRAL = '#f6eed9'; // cream board fill for non-color spaces

/** The strip/fill color for a tile: its color-group color if it has one, else neutral. */
export function tileColor(space: BoardSpace): string {
  if (space.colorGroup && space.colorGroup in COLOR_GROUP_HEX) {
    return COLOR_GROUP_HEX[space.colorGroup as keyof typeof COLOR_GROUP_HEX];
  }
  return NEUTRAL;
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `npm test -- tileColor`
Expected: PASS (2). If `BoardSpace` has no `colorGroup` field name match, use the actual field from `types/GameState.ts`.

- [ ] **Step 5: Implement `src/board/BoardTiles.tsx`** (no unit test — WebGL; build-verified)

```tsx
import { BOARD_SPACES } from '../constants/board';
import { SPACE_POSITIONS, BOARD_WORLD_SIZE, tileToWorld } from './positions';
import { tileColor } from './tileColor';

const TILE = (1 - 2 * 0.134) / 9 * BOARD_WORLD_SIZE * 0.9; // approx regular tile footprint

export function BoardTiles() {
  return (
    <group>
      {/* board base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.05, 0]}>
        <boxGeometry args={[BOARD_WORLD_SIZE, BOARD_WORLD_SIZE, 0.1]} />
        <meshStandardMaterial color="#dff0d6" />
      </mesh>
      {BOARD_SPACES.map((space, i) => {
        const [x, , z] = tileToWorld(i);
        return (
          <mesh key={i} position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[TILE, TILE]} />
            <meshStandardMaterial color={tileColor(space)} />
          </mesh>
        );
      })}
    </group>
  );
}

// re-export so consumers importing positions via BoardTiles keep working
export { SPACE_POSITIONS };
```

- [ ] **Step 6: Implement `src/screens/GameScene.tsx`**

```tsx
import { Canvas } from '@react-three/fiber';
import { BoardTiles } from '../board/BoardTiles';

/** Phase 1 placeholder game screen: renders the static 3D board in a daylight scene. */
export function GameScene() {
  return (
    <Canvas style={{ position: 'fixed', inset: 0 }} camera={{ position: [0, 9, 11], fov: 50 }} shadows>
      <color attach="background" args={['#cbe8f5']} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[6, 10, 6]} intensity={1.1} castShadow />
      <BoardTiles />
    </Canvas>
  );
}
```

- [ ] **Step 7: Build check + full suite**

Run: `npm run build` then `npm test`
Expected: build green (tsc + vite), all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/board/tileColor.ts src/board/tileColor.test.ts src/board/BoardTiles.tsx src/screens/GameScene.tsx
git commit -m "feat(lobby): static 3D board tiles + GameScene placeholder"
```

---

### Task 6: App screen routing

**Files:**
- Modify: `src/App.tsx` (render by `screen`; keep connect/register + ConnectionStatus)
- Test: `src/App.routing.test.tsx`

**Interfaces:**
- Consumes: `useGameStore` (`screen`), the three screen components, `ConnectionStatus`, `socketManager`, `gameStateSync`.
- Produces: updated `<App />` that renders `MainMenu`/`Lobby`/`GameScene` by `screen`.

- [ ] **Step 1: Write the failing routing test**

Create `src/App.routing.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run it, expect fail**

Run: `npm test -- App.routing`
Expected: FAIL (App still renders the old single Canvas, no MainMenu).

- [ ] **Step 3: Rewrite `src/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { socketManager } from './network/SocketManager';
import { gameStateSync } from './network/GameStateSync';
import { useGameStore } from './state/gameStore';
import { EVENTS } from './types/SocketEvents';
import { ConnectionStatus } from './ui/ConnectionStatus';
import { MainMenu } from './screens/MainMenu';
import { Lobby } from './screens/Lobby';
import { GameScene } from './screens/GameScene';

export default function App() {
  const screen = useGameStore((s) => s.screen);
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);

  useEffect(() => {
    const socket = socketManager.connect();
    gameStateSync.register();
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onAck = (data: { playerId: string }) => setPlayerId(data.playerId);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(EVENTS.CONNECT_ACK, onAck);
    if (socket.connected) setConnected(true);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(EVENTS.CONNECT_ACK, onAck);
    };
  }, []);

  return (
    <>
      <ConnectionStatus connected={connected} playerId={playerId} />
      {screen === 'menu' && <MainMenu />}
      {screen === 'lobby' && <Lobby />}
      {(screen === 'game' || screen === 'game-over') && <GameScene />}
    </>
  );
}
```

- [ ] **Step 4: Run routing test + full suite**

Run: `npm test -- App.routing` then `npm test` then `npm run build`
Expected: routing PASS (2); full suite green; build green.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.routing.test.tsx
git commit -m "feat(lobby): route App by screen enum (menu/lobby/game)"
```

---

### Task 7: Push + PR

**Files:** none (git only).

- [ ] **Step 1: Confirm clean tree + green**

Run: `git status --porcelain` (empty), `npm test` (all green), `npm run build` (green).

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/lobby
```

- [ ] **Step 3: Open the PR (base = `feat/scaffold` while PR #1 is open; retarget to `main` after #1 merges)**

```bash
gh pr create --repo mockopoly-js/mockopoly-client-3d --base feat/scaffold --head feat/lobby \
  --title "Phase 1: lobby loop (MainMenu, Lobby, static 3D board, screen routing)" \
  --body "Builds on Phase 0 (#1). Adds: screen-routing enum in gameStore; vendored BOARD_SPACES + tile-ring geometry + color constants; MainMenu (create/join over the room protocol); Lobby (slots from state, ready toggle, host start, countdown, leave); static 3D board (R3F) + GameScene placeholder; App routes by screen. Server + 2D client untouched; contract still byte-verbatim. If #1 has merged, retarget this PR base to main. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Do NOT merge.** Report the PR URL for Arslan to review + merge via web.

---

## Self-Review

**1. Spec coverage (Phase 1 row of the design spec §10):** MainMenu + Lobby over sockets → Tasks 3–4; room create/join/ready/start → Tasks 3–4 (exact `EVENTS.*` + payloads in Global Constraints); static procedural 3D board → Tasks 2, 5; acceptance "two clients can create/join a room and start a game" → the full menu→lobby→game routing (Tasks 1, 3, 4, 6) + status-driven transition. Screen routing → Task 1 + Task 6.

**2. Placeholder scan:** every code step has complete code. The two conditional caveats (getter-spy fallback in Tasks 3–4; `BoardSpace` field-name checks in Tasks 2, 5) are explicit verification instructions with a concrete fallback, not placeholders.

**3. Type consistency:** store additions (`screen`, `setScreen`, `Screen`) are defined in Task 1 and consumed identically in Tasks 3, 4, 6. `tileToWorld`/`SPACE_POSITIONS`/`BOARD_WORLD_SIZE` defined in Task 2, used in Task 5. `TOKEN_HEX`/`COLOR_GROUP_HEX` defined Task 2, used Tasks 3, 4, 5. Event constants + payloads match the vendored contract.

**Executor notes:** Tasks are strictly ordered (1→7). The `socketManager.playerId` getter-spy is the one fragile test point — the fallback (`socketManager.setPlayerId('p1')`, which exists on the singleton) is documented in Tasks 3 and 4.

---

## Execution Handoff

Phase 1 plan complete. Execute via superpowers:subagent-driven-development — fresh implementer per task, task review after each, broad review at the end. Phase 2 (Turn core) gets its own plan after this merges.
