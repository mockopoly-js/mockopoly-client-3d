# Mockopoly 3D — Phase 0 (Scaffold) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the new `mockopoly-client-3d` repo as a React + Vite + TypeScript + react-three-fiber app that connects to the existing (untouched) Mockopoly server and mirrors its authoritative state into a zustand store — with Phaser fully removed from the state layer.

**Architecture:** Copy the renderer-agnostic stack from the 2D client (socket layer, wire contract, money formatter) verbatim. Replace the two Phaser-EventEmitter singletons (`LocalGameState`, `UIState`) with a single zustand store (`gameStore`) for durable state, plus a tiny `eventemitter3` bus (`gameBus`) for the transient animation events that React components will subscribe to. Rewire `GameStateSync` to write to the store and the bus instead of Phaser emitters. Render an empty R3F `<Canvas>` with a connection-status overlay.

**Tech Stack:** React 18, Vite 5, TypeScript 5, react-three-fiber + three, @react-three/drei, zustand, eventemitter3, socket.io-client 4.7, Vitest + jsdom.

## Global Constraints

- **Server is untouched.** No edits to `mockopoly-server`. Same socket protocol, same URL (`VITE_SERVER_URL`, default `http://localhost:3001`).
- **The 2D `mockopoly-client` repo is untouched.** Files are *copied* out of it, never edited in place.
- **Git: `gh` + personal SSH key only.** Remote uses the alias form `git@personal:mockopoly-js/mockopoly-client-3d.git`. **No direct pushes/merges to `main`/`staging`/`dev`.** All integration via PRs; Arslan merges via web. (See `memory/git-workflow.md`.)
- **Vendored contract, server is source of truth.** `types/GameState.ts` and `types/SocketEvents.ts` are copied from `mockopoly-server/src/types/`. Preserve upstream quirks verbatim — including the `S_MortgageLifteed` typo. Do not "fix" them here.
- **localStorage keys preserved verbatim:** `mockopoly_reconnect` (reconnect token) and `mockopoly-dev-hacks` (dev hacks). Note the underscore-vs-hyphen mismatch is intentional-as-existing; keep both exactly.
- **Node 25 / npm 11** on the dev machine (no `engines` pin, matching the 2D client).
- Package manager: **npm** (matches the 2D client).

**Working directory for all tasks:** `/Users/arslan/Desktop/Monopoly/mockopoly-client-3d` (created in Task 1). The 2D client to copy from is at `/Users/arslan/Desktop/Monopoly/mockopoly-client`. The server contract to copy from is at `/Users/arslan/Desktop/Monopoly/mockopoly-server/src/types`.

---

### Task 1: Project scaffold, tooling, and repo

**Files:**
- Create: `mockopoly-client-3d/package.json`
- Create: `mockopoly-client-3d/tsconfig.json`, `mockopoly-client-3d/tsconfig.node.json`
- Create: `mockopoly-client-3d/vite.config.ts`
- Create: `mockopoly-client-3d/vitest.config.ts`
- Create: `mockopoly-client-3d/index.html`
- Create: `mockopoly-client-3d/.gitignore`
- Create: `mockopoly-client-3d/src/utils/format.ts` (copied verbatim from 2D client)
- Test: `mockopoly-client-3d/src/utils/format.test.ts`

**Interfaces:**
- Produces: `formatMoney(amount: number): string` — used across the HUD in later phases.

- [ ] **Step 1: Create the project directory and initialize npm**

```bash
cd /Users/arslan/Desktop/Monopoly
mkdir mockopoly-client-3d
cd mockopoly-client-3d
git init -b main
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install react@^18.3.1 react-dom@^18.3.1 three@^0.169.0 @react-three/fiber@^8.17.10 @react-three/drei@^9.114.0 zustand@^5.0.1 eventemitter3@^5.0.1 socket.io-client@^4.7.4
npm install -D typescript@^5.6.3 vite@^5.4.10 @vitejs/plugin-react@^4.3.3 vitest@^2.1.4 jsdom@^25.0.1 @types/react@^18.3.12 @types/react-dom@^18.3.1 @types/three@^0.169.0
```

- [ ] **Step 3: Write `package.json` scripts**

Replace the `"scripts"` block in `package.json` with:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "sync-contract": "node scripts/sync-contract.mjs"
  }
}
```

Also add `"type": "module"` and `"private": true` at the top level of `package.json`.

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 5: Write `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 6: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
```

(Port 5174 so it can run alongside the 2D client on 5173.)

- [ ] **Step 7: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 8: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Mockopoly 3D</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: Write `.gitignore`**

```
node_modules
dist
dist-ssr
*.local
.DS_Store
.env
.env.*
!.env.example
```

- [ ] **Step 10: Write the failing test for `formatMoney`**

Create `src/utils/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatMoney } from './format';

describe('formatMoney', () => {
  it('formats millions with three decimals', () => {
    expect(formatMoney(15_000_000)).toBe('£15.000M');
  });
  it('formats whole thousands without decimals', () => {
    expect(formatMoney(2_000)).toBe('£2K');
  });
  it('formats fractional thousands with one decimal', () => {
    expect(formatMoney(1_500)).toBe('£1.5K');
  });
  it('formats sub-thousands raw', () => {
    expect(formatMoney(500)).toBe('£500');
  });
  it('formats negatives with a leading minus', () => {
    expect(formatMoney(-1_200_000)).toBe('-£1.200M');
  });
});
```

- [ ] **Step 11: Run the test to verify it fails**

Run: `npm test -- format`
Expected: FAIL — `Cannot find module './format'`.

- [ ] **Step 12: Copy `format.ts` verbatim from the 2D client**

Create `src/utils/format.ts` with exactly this content (copied from `mockopoly-client/src/utils/format.ts`):

```ts
/** Format money with K/M suffixes: 1500 → £1.5K, 15000000 → £15.000M */
export function formatMoney(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}£${m.toFixed(3)}M`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    // Show decimal only if not whole
    const formatted = k % 1 === 0 ? k.toFixed(0) : k.toFixed(1);
    return `${sign}£${formatted}K`;
  }
  return `${sign}£${abs}`;
}
```

- [ ] **Step 13: Run the test to verify it passes**

Run: `npm test -- format`
Expected: PASS (5 tests).

- [ ] **Step 14: Create the GitHub repo and wire the personal SSH remote**

```bash
gh repo create mockopoly-js/mockopoly-client-3d --public --disable-wiki
git remote add origin git@personal:mockopoly-js/mockopoly-client-3d.git
git checkout -b feat/scaffold
```

Expected: `gh` reports the repo created under the `mockopoly-js` org. `git remote -v` shows the `git@personal:` alias.

- [ ] **Step 15: Commit**

```bash
git add .
git commit -m "chore: scaffold vite + react + ts + vitest, add formatMoney"
```

---

### Task 2: Vendor the wire contract + sync script

**Files:**
- Create: `mockopoly-client-3d/src/types/GameState.ts` (copied from server)
- Create: `mockopoly-client-3d/src/types/SocketEvents.ts` (copied from server)
- Create: `mockopoly-client-3d/scripts/sync-contract.mjs`
- Test: `mockopoly-client-3d/src/types/contract.test.ts`

**Interfaces:**
- Produces: all shared types (`GameState`, `Player`, `DevHacks`, the `S_*` payload interfaces) and `EVENTS` — consumed by SocketManager, gameStore, GameStateSync, and every later phase.

- [ ] **Step 1: Copy the two contract files verbatim from the server**

```bash
cp /Users/arslan/Desktop/Monopoly/mockopoly-server/src/types/GameState.ts src/types/GameState.ts
cp /Users/arslan/Desktop/Monopoly/mockopoly-server/src/types/SocketEvents.ts src/types/SocketEvents.ts
```

Do not edit them. Preserve the `S_MortgageLifteed` typo and everything else exactly.

- [ ] **Step 2: Write the `sync-contract.mjs` script**

Create `scripts/sync-contract.mjs`:

```js
// Re-copies the wire contract from a sibling mockopoly-server checkout.
// Server is the source of truth. Run: npm run sync-contract
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverTypes = resolve(here, '../../mockopoly-server/src/types');
const clientTypes = resolve(here, '../src/types');
const files = ['GameState.ts', 'SocketEvents.ts'];

if (!existsSync(serverTypes)) {
  console.error(`[sync-contract] server types not found at ${serverTypes}`);
  console.error('[sync-contract] check out mockopoly-server as a sibling directory.');
  process.exit(1);
}

for (const f of files) {
  copyFileSync(resolve(serverTypes, f), resolve(clientTypes, f));
  console.log(`[sync-contract] copied ${f}`);
}
console.log('[sync-contract] done. Server is the source of truth.');
```

- [ ] **Step 3: Write a test that the contract exposes the events the sync layer needs**

Create `src/types/contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EVENTS } from './SocketEvents';

describe('wire contract', () => {
  it('exposes the core state-sync event', () => {
    expect(EVENTS.GAME_STATE_UPDATE).toBeTruthy();
  });
  it('exposes the connection ack event', () => {
    expect(EVENTS.CONNECT_ACK).toBeTruthy();
  });
  it('exposes turn animation events consumed by the client', () => {
    expect(EVENTS.TURN_DICE_ROLLED).toBeTruthy();
    expect(EVENTS.TURN_PLAYER_MOVED).toBeTruthy();
    expect(EVENTS.TURN_LANDED).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- contract`
Expected: PASS (3 tests). If any `EVENTS.*` key is undefined, the copied `SocketEvents.ts` is stale — re-copy in Step 1.

- [ ] **Step 5: Commit**

```bash
git add src/types scripts/sync-contract.mjs
git commit -m "feat: vendor wire contract from server + add sync-contract script"
```

---

### Task 3: Copy SocketManager + env typing

**Files:**
- Create: `mockopoly-client-3d/src/network/SocketManager.ts` (copied verbatim)
- Create: `mockopoly-client-3d/src/vite-env.d.ts`
- Create: `mockopoly-client-3d/.env.example`
- Test: `mockopoly-client-3d/src/network/SocketManager.test.ts`

**Interfaces:**
- Produces: `socketManager` singleton with `connect()`, `getSocket()`, `emit(event, data)`, `on(event, cb)`, `off(event, cb?)`, `once(event, cb)`, `disconnect()`, and getters `connected`, `playerId`, `id`. Consumed by GameStateSync and App.

- [ ] **Step 1: Copy `SocketManager.ts` verbatim from the 2D client**

```bash
cp /Users/arslan/Desktop/Monopoly/mockopoly-client/src/network/SocketManager.ts src/network/SocketManager.ts
```

This file has no Phaser dependency; it needs no edits. It reads `import.meta.env.VITE_SERVER_URL`.

- [ ] **Step 2: Add `vite-env.d.ts` for typed env**

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 3: Add `.env.example`**

Create `.env.example`:

```
VITE_SERVER_URL=http://localhost:3001
```

- [ ] **Step 4: Write the failing test**

Create `src/network/SocketManager.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { socketManager } from './SocketManager';

describe('socketManager', () => {
  it('is a singleton with a socket API', () => {
    expect(typeof socketManager.connect).toBe('function');
    expect(typeof socketManager.on).toBe('function');
    expect(typeof socketManager.emit).toBe('function');
  });
  it('reports disconnected before connect()', () => {
    expect(socketManager.connected).toBe(false);
    expect(socketManager.playerId).toBe(null);
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- SocketManager`
Expected: PASS (2 tests). (No real connection is opened; `connected` reads the null socket.)

- [ ] **Step 6: Commit**

```bash
git add src/network/SocketManager.ts src/vite-env.d.ts .env.example
git commit -m "feat: copy SocketManager, add typed env"
```

---

### Task 4: The zustand game store (de-Phaser'd LocalGameState + UIState)

**Files:**
- Create: `mockopoly-client-3d/src/types/ui.ts`
- Create: `mockopoly-client-3d/src/state/gameStore.ts`
- Test: `mockopoly-client-3d/src/state/gameStore.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Player` from `../types/GameState`.
- Produces:
  - `useGameStore` (zustand hook + `.getState()`/`.setState()`).
  - Store shape actions: `update(state: GameState): void`, `setMyPlayerId(id: string): void`, `setRoomCode(code: string): void`, `setReconnectToken(token: string): void`, `clearReconnectToken(): void`, `addToast(message: string, type?: ToastType): void`, `selectProperty(index: number | null): void`, `toggleTradePanel(show?: boolean): void`, `togglePartnershipPanel(show?: boolean): void`, `toggleDealPanel(show?: boolean): void`, `reset(): void`.
  - Selector helpers: `selectMyPlayer(s): Player | undefined`, `selectIsMyTurn(s): boolean`, `selectCurrentPlayer(s): Player | undefined`.
  - `getStoredReconnectToken(): string | null`.
  - `ToastMessage`, `ToastType` from `../types/ui`.

- [ ] **Step 1: Write the toast types**

Create `src/types/ui.ts`:

```ts
export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  message: string;
  type: ToastType;
  timestamp: number;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/state/gameStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useGameStore,
  selectMyPlayer,
  selectIsMyTurn,
  selectCurrentPlayer,
  getStoredReconnectToken,
} from './gameStore';
import type { GameState } from '../types/GameState';

function fakeState(): GameState {
  // Minimal shape sufficient for the store's reads. Cast covers unused fields.
  return {
    players: [
      { id: 'p1', name: 'Maya' },
      { id: 'p2', name: 'Jonas' },
    ],
    turn: { currentPlayerId: 'p1' },
  } as unknown as GameState;
}

describe('gameStore', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    localStorage.clear();
  });

  it('stores a server state snapshot via update()', () => {
    const s = fakeState();
    useGameStore.getState().update(s);
    expect(useGameStore.getState().state).toBe(s);
  });

  it('resolves my player and whose turn it is via selectors', () => {
    useGameStore.getState().update(fakeState());
    useGameStore.getState().setMyPlayerId('p1');
    const st = useGameStore.getState();
    expect(selectMyPlayer(st)?.name).toBe('Maya');
    expect(selectIsMyTurn(st)).toBe(true);
    expect(selectCurrentPlayer(st)?.name).toBe('Maya');
  });

  it('is not my turn when I am not the current player', () => {
    useGameStore.getState().update(fakeState());
    useGameStore.getState().setMyPlayerId('p2');
    expect(selectIsMyTurn(useGameStore.getState())).toBe(false);
  });

  it('persists and clears the reconnect token in localStorage', () => {
    useGameStore.getState().setReconnectToken('tok-123');
    expect(getStoredReconnectToken()).toBe('tok-123');
    expect(useGameStore.getState().reconnectToken).toBe('tok-123');
    useGameStore.getState().clearReconnectToken();
    expect(getStoredReconnectToken()).toBe(null);
    expect(useGameStore.getState().reconnectToken).toBe(null);
  });

  it('appends toasts with a type', () => {
    useGameStore.getState().addToast('hi', 'success');
    const toasts = useGameStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ message: 'hi', type: 'success' });
  });

  it('opens the property card when a property is selected', () => {
    useGameStore.getState().selectProperty(5);
    expect(useGameStore.getState().selectedPropertyIndex).toBe(5);
    expect(useGameStore.getState().showPropertyCard).toBe(true);
    useGameStore.getState().selectProperty(null);
    expect(useGameStore.getState().showPropertyCard).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- gameStore`
Expected: FAIL — `Cannot find module './gameStore'`.

- [ ] **Step 4: Write `gameStore.ts`**

Create `src/state/gameStore.ts`:

```ts
import { create } from 'zustand';
import type { GameState, Player } from '../types/GameState';
import type { ToastMessage, ToastType } from '../types/ui';

const RECONNECT_KEY = 'mockopoly_reconnect';

interface GameStore {
  // ── durable mirror of server state (was LocalGameState) ──
  state: GameState | null;
  myPlayerId: string | null;
  roomCode: string | null;
  reconnectToken: string | null;

  // ── client-only UI state (was UIState) ──
  toasts: ToastMessage[];
  selectedPropertyIndex: number | null;
  showPropertyCard: boolean;
  showTradePanel: boolean;
  showPartnershipPanel: boolean;
  showDealPanel: boolean;

  // ── actions ──
  update: (state: GameState) => void;
  setMyPlayerId: (id: string) => void;
  setRoomCode: (code: string) => void;
  setReconnectToken: (token: string) => void;
  clearReconnectToken: () => void;
  addToast: (message: string, type?: ToastType) => void;
  selectProperty: (index: number | null) => void;
  toggleTradePanel: (show?: boolean) => void;
  togglePartnershipPanel: (show?: boolean) => void;
  toggleDealPanel: (show?: boolean) => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  myPlayerId: null,
  roomCode: null,
  reconnectToken: null,
  toasts: [],
  selectedPropertyIndex: null,
  showPropertyCard: false,
  showTradePanel: false,
  showPartnershipPanel: false,
  showDealPanel: false,

  update: (state) => set({ state }),
  setMyPlayerId: (id) => set({ myPlayerId: id }),
  setRoomCode: (code) => set({ roomCode: code }),

  setReconnectToken: (token) => {
    set({ reconnectToken: token });
    try { localStorage.setItem(RECONNECT_KEY, token); } catch { /* ignore */ }
  },
  clearReconnectToken: () => {
    set({ reconnectToken: null });
    try { localStorage.removeItem(RECONNECT_KEY); } catch { /* ignore */ }
  },

  addToast: (message, type = 'info') =>
    set((s) => ({ toasts: [...s.toasts, { message, type, timestamp: Date.now() }] })),

  selectProperty: (index) =>
    set({ selectedPropertyIndex: index, showPropertyCard: index !== null }),
  toggleTradePanel: (show) =>
    set((s) => ({ showTradePanel: show ?? !s.showTradePanel })),
  togglePartnershipPanel: (show) =>
    set((s) => ({ showPartnershipPanel: show ?? !s.showPartnershipPanel })),
  toggleDealPanel: (show) =>
    set((s) => ({ showDealPanel: show ?? !s.showDealPanel })),

  reset: () => {
    get().clearReconnectToken();
    set({
      state: null,
      myPlayerId: null,
      roomCode: null,
      toasts: [],
      selectedPropertyIndex: null,
      showPropertyCard: false,
      showTradePanel: false,
      showPartnershipPanel: false,
      showDealPanel: false,
    });
  },
}));

// ── selector helpers (derived reads; use with useGameStore(selectX)) ──
export function selectMyPlayer(s: GameStore): Player | undefined {
  if (!s.state || !s.myPlayerId) return undefined;
  return s.state.players.find((p) => p.id === s.myPlayerId);
}
export function selectCurrentPlayer(s: GameStore): Player | undefined {
  if (!s.state) return undefined;
  return s.state.players.find((p) => p.id === s.state!.turn.currentPlayerId);
}
export function selectIsMyTurn(s: GameStore): boolean {
  if (!s.state || !s.myPlayerId) return false;
  return s.state.turn.currentPlayerId === s.myPlayerId;
}

export function getStoredReconnectToken(): string | null {
  try { return localStorage.getItem(RECONNECT_KEY); } catch { return null; }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- gameStore`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types/ui.ts src/state/gameStore.ts src/state/gameStore.test.ts
git commit -m "feat: zustand gameStore replacing Phaser LocalGameState + UIState"
```

---

### Task 5: The transient event bus

**Files:**
- Create: `mockopoly-client-3d/src/state/gameBus.ts`
- Test: `mockopoly-client-3d/src/state/gameBus.test.ts`

**Interfaces:**
- Produces: `gameBus` (an `eventemitter3` instance) with `.emit(name, payload)`, `.on(name, cb)`, `.off(name, cb)`. Carries the transient animation/UI-trigger events (`'dice-rolled'`, `'player-moved'`, `'player-landed'`, `'turn-started'`, `'card-drawn'`, `'room-created'`, `'room-joined'`, `'room-rejected'`, `'countdown'`, `'open-negotiation'`, and the rest emitted by GameStateSync). Consumed by GameStateSync (producer) and by React scene/HUD components in later phases (consumers).

- [ ] **Step 1: Write the failing test**

Create `src/state/gameBus.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { gameBus } from './gameBus';

describe('gameBus', () => {
  it('delivers emitted payloads to listeners', () => {
    const spy = vi.fn();
    gameBus.on('player-moved', spy);
    const payload = { playerId: 'p1', to: 7 };
    gameBus.emit('player-moved', payload);
    expect(spy).toHaveBeenCalledWith(payload);
    gameBus.off('player-moved', spy);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- gameBus`
Expected: FAIL — `Cannot find module './gameBus'`.

- [ ] **Step 3: Write `gameBus.ts`**

Create `src/state/gameBus.ts`:

```ts
import EventEmitter from 'eventemitter3';

// Transient client-side event bus. Replaces the Phaser EventEmitter that
// LocalGameState used to broadcast one-shot animation/UI triggers.
// Durable state lives in gameStore; ephemeral "something just happened"
// signals live here so React components can subscribe imperatively.
export const gameBus = new EventEmitter();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- gameBus`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/state/gameBus.ts src/state/gameBus.test.ts
git commit -m "feat: add gameBus for transient animation events"
```

---

### Task 6: Rewire GameStateSync to the store + bus

**Files:**
- Create: `mockopoly-client-3d/src/network/GameStateSync.ts` (adapted from 2D client)
- Test: `mockopoly-client-3d/src/network/GameStateSync.test.ts`

**Interfaces:**
- Consumes: `socketManager` (Task 3), `useGameStore` (Task 4), `gameBus` (Task 5), `EVENTS` + `S_*` types (Task 2), `formatMoney` (Task 1).
- Produces: `gameStateSync` singleton with `register(): void`. On `GAME_STATE_UPDATE` it calls `useGameStore.getState().update(state)`; all former `localGameState.emit(x, d)` calls become `gameBus.emit(x, d)`; all `uiState.addToast(...)` become `useGameStore.getState().addToast(...)`; all `localGameState.state`/`localGameState.myPlayerId` reads become `useGameStore.getState().state`/`.myPlayerId`.

- [ ] **Step 1: Write the failing test (mock the socket layer)**

Create `src/network/GameStateSync.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// A fake socket registry so we can drive server events by hand.
const handlers = new Map<string, (data: unknown) => void>();
vi.mock('./SocketManager', () => ({
  socketManager: {
    on: (event: string, cb: (data: unknown) => void) => handlers.set(event, cb),
    emit: vi.fn(),
  },
}));

import { gameStateSync } from './GameStateSync';
import { useGameStore } from '../state/gameStore';
import { gameBus } from '../state/gameBus';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function fire(event: string, data: unknown) {
  const h = handlers.get(event);
  if (!h) throw new Error(`no handler registered for ${event}`);
  h(data);
}

describe('gameStateSync', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('writes GAME_STATE_UPDATE into the store', () => {
    gameStateSync.register();
    const state = { players: [], turn: { currentPlayerId: null } } as unknown as GameState;
    fire(EVENTS.GAME_STATE_UPDATE, { state });
    expect(useGameStore.getState().state).toBe(state);
  });

  it('relays a transient animation event onto the bus', () => {
    gameStateSync.register();
    const spy = vi.fn();
    gameBus.on('player-moved', spy);
    const payload = { playerId: 'p1' };
    fire(EVENTS.TURN_PLAYER_MOVED, payload);
    expect(spy).toHaveBeenCalledWith(payload);
    gameBus.off('player-moved', spy);
  });

  it('routes a server jail event to a toast', () => {
    gameStateSync.register();
    const state = {
      players: [{ id: 'p1', name: 'Maya' }],
      turn: { currentPlayerId: 'p1' },
    } as unknown as GameState;
    fire(EVENTS.GAME_STATE_UPDATE, { state });
    fire(EVENTS.JAIL_SENT, { playerId: 'p1' });
    const toasts = useGameStore.getState().toasts;
    expect(toasts.at(-1)?.message).toContain('Maya');
    expect(toasts.at(-1)?.type).toBe('warning');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- GameStateSync`
Expected: FAIL — `Cannot find module './GameStateSync'`.

- [ ] **Step 3: Write the rewired `GameStateSync.ts`**

Create `src/network/GameStateSync.ts`. This is the 2D file with three mechanical substitutions: `localGameState.update(x)` → `useGameStore.getState().update(x)`; `localGameState.emit(e, d)` → `gameBus.emit(e, d)`; `localGameState.state`/`localGameState.myPlayerId` → `useGameStore.getState().state`/`.myPlayerId`; `uiState.addToast(...)` → `useGameStore.getState().addToast(...)`. `restoreDevHacks()` is unchanged.

```ts
import { socketManager } from './SocketManager';
import { useGameStore } from '../state/gameStore';
import { gameBus } from '../state/gameBus';
import { EVENTS } from '../types/SocketEvents';
import { formatMoney } from '../utils/format';
import type { DevHacks } from '../types/GameState';
import type {
  S_StateUpdate, S_DiceRolled, S_PlayerMoved, S_Landed,
  S_TurnStarted, S_CardDrawn, S_JailSent, S_JailReleased,
  S_PropertyBought, S_RentCollected, S_AuctionStart,
  S_HouseAdded, S_HotelAdded, S_HouseSold, S_HotelSold,
  S_PlayerBankrupt, S_GameOver, S_PlayerDisconnected, S_PlayerReconnected,
  S_RoomCreated, S_RoomJoined, S_RoomRejected, S_Countdown,
  S_Error,
  S_FreeParkingCollected, S_GoDeducted,
  S_PartnershipProposed, S_PartnershipProposalAccepted,
  S_PartnershipProposalRejected, S_PartnershipProposalCancelled,
  S_PartnershipFormed, S_PartnershipDissolveRequested,
  S_PartnershipDissolveAccepted, S_PartnershipDissolveRejected,
  S_PartnershipDissolved, S_PartnershipRentSplit, S_PartnershipBuildCostSplit,
  S_DealOffered, S_DealCountered, S_DealAccepted,
  S_DealRejected, S_DealCompleted, S_DealCancelled,
} from '../types/SocketEvents';

// ─── Game State Sync ─────────────────────────────────────────────────────────
// Listens for server events, writes durable state into the zustand store, and
// relays transient animation/UI events onto gameBus. (Was Phaser-emitter based.)

class GameStateSync {
  private registered = false;

  register(): void {
    if (this.registered) return;
    this.registered = true;

    const store = () => useGameStore.getState();

    // ── Core state sync ───────────────────────────────────────────────────────
    socketManager.on(EVENTS.GAME_STATE_UPDATE, (data: S_StateUpdate) => {
      store().update(data.state);
    });

    // ── Room / Lobby events ─────────────────────────────────────────────────
    socketManager.on(EVENTS.ROOM_CREATED, (data: S_RoomCreated) => {
      gameBus.emit('room-created', data);
      this.restoreDevHacks();
    });
    socketManager.on(EVENTS.ROOM_JOINED, (data: S_RoomJoined) => {
      gameBus.emit('room-joined', data);
      this.restoreDevHacks();
    });
    socketManager.on(EVENTS.ROOM_REJECTED, (data: S_RoomRejected) => {
      gameBus.emit('room-rejected', data);
    });
    socketManager.on(EVENTS.ROOM_COUNTDOWN, (data: S_Countdown) => {
      gameBus.emit('countdown', data);
    });

    // ── Animation events ──────────────────────────────────────────────────────
    socketManager.on(EVENTS.TURN_DICE_ROLLED, (data: S_DiceRolled) => {
      gameBus.emit('dice-rolled', data);
    });
    socketManager.on(EVENTS.TURN_PLAYER_MOVED, (data: S_PlayerMoved) => {
      gameBus.emit('player-moved', data);
    });
    socketManager.on(EVENTS.TURN_LANDED, (data: S_Landed) => {
      gameBus.emit('player-landed', data);
    });
    socketManager.on(EVENTS.TURN_STARTED, (data: S_TurnStarted) => {
      gameBus.emit('turn-started', data);
    });
    socketManager.on(EVENTS.CARD_DRAWN, (data: S_CardDrawn) => {
      gameBus.emit('card-drawn', data);
    });

    // ── Jail ──────────────────────────────────────────────────────────────────
    socketManager.on(EVENTS.JAIL_SENT, (data: S_JailSent) => {
      gameBus.emit('jail-sent', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} was sent to Jail!`, 'warning');
    });
    socketManager.on(EVENTS.JAIL_RELEASED, (data: S_JailReleased) => {
      gameBus.emit('jail-released', data);
    });

    // ── Property ──────────────────────────────────────────────────────────────
    socketManager.on(EVENTS.PROPERTY_BOUGHT, (data: S_PropertyBought) => {
      gameBus.emit('property-bought', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} bought a property!`, 'success');
    });
    socketManager.on(EVENTS.PROPERTY_RENT_COLLECTED, (data: S_RentCollected) => {
      gameBus.emit('rent-collected', data);
    });
    socketManager.on(EVENTS.PROPERTY_AUCTION_START, (data: S_AuctionStart) => {
      gameBus.emit('auction-start', data);
      store().addToast('Auction started!', 'info');
    });

    // ── Building ────────────────────────────────────────────────────────
    socketManager.on(EVENTS.BUILD_HOUSE_ADDED, (data: S_HouseAdded) => {
      gameBus.emit('house-added', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} built a house!`, 'success');
    });
    socketManager.on(EVENTS.BUILD_HOTEL_ADDED, (data: S_HotelAdded) => {
      gameBus.emit('hotel-added', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} built a hotel!`, 'success');
    });
    socketManager.on(EVENTS.BUILD_HOUSE_SOLD, (data: S_HouseSold) => {
      gameBus.emit('house-sold', data);
    });
    socketManager.on(EVENTS.BUILD_HOTEL_SOLD, (data: S_HotelSold) => {
      gameBus.emit('hotel-sold', data);
    });

    // ── Bankruptcy / Game Over ────────────────────────────────────────────────
    socketManager.on(EVENTS.PLAYER_BANKRUPT, (data: S_PlayerBankrupt) => {
      gameBus.emit('player-bankrupt', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} went bankrupt!`, 'error');
    });
    socketManager.on(EVENTS.GAME_OVER, (data: S_GameOver) => {
      gameBus.emit('game-over', data);
    });

    // ── Connection ────────────────────────────────────────────────────────────
    socketManager.on(EVENTS.GAME_PLAYER_DISCONNECTED, (data: S_PlayerDisconnected) => {
      gameBus.emit('player-disconnected', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} disconnected`, 'warning');
    });
    socketManager.on(EVENTS.GAME_PLAYER_RECONNECTED, (data: S_PlayerReconnected) => {
      gameBus.emit('player-reconnected', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} reconnected!`, 'success');
    });

    // ── Free Parking ──────────────────────────────────────────────────────────
    socketManager.on(EVENTS.FREE_PARKING_COLLECTED, (data: S_FreeParkingCollected) => {
      gameBus.emit('free-parking-collected', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} collected ${formatMoney(data.amount)} from Free Parking!`, 'success');
    });

    // ── GO Deduction ────────────────────────────────────────────────────────
    socketManager.on(EVENTS.LOAN_GO_DEDUCTED, (data: S_GoDeducted) => {
      gameBus.emit('go-deducted', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} took a GO advance of ${formatMoney(data.amount)}`, 'warning');
    });

    // ── Partnerships ────────────────────────────────────────────────────────
    socketManager.on(EVENTS.PARTNERSHIP_PROPOSED, (data: S_PartnershipProposed) => {
      gameBus.emit('partnership-proposed', data);
      const initiator = store().state?.players.find(p => p.id === data.proposal.initiatorId);
      if (initiator) store().addToast(`${initiator.name} proposed a partnership on ${data.proposal.colorGroup}`, 'info');
    });
    socketManager.on(EVENTS.PARTNERSHIP_PROPOSAL_ACCEPTED, (data: S_PartnershipProposalAccepted) => {
      gameBus.emit('partnership-proposal-accepted', data);
    });
    socketManager.on(EVENTS.PARTNERSHIP_PROPOSAL_REJECTED, (data: S_PartnershipProposalRejected) => {
      gameBus.emit('partnership-proposal-rejected', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} rejected the partnership proposal`, 'warning');
    });
    socketManager.on(EVENTS.PARTNERSHIP_PROPOSAL_CANCELLED, (_data: S_PartnershipProposalCancelled) => {
      gameBus.emit('partnership-proposal-cancelled', _data);
      store().addToast('Partnership proposal cancelled', 'info');
    });
    socketManager.on(EVENTS.PARTNERSHIP_FORMED, (data: S_PartnershipFormed) => {
      gameBus.emit('partnership-formed', data);
      store().addToast(`Partnership formed on ${data.partnership.colorGroup}!`, 'success');
    });
    socketManager.on(EVENTS.PARTNERSHIP_DISSOLVE_REQUESTED, (data: S_PartnershipDissolveRequested) => {
      gameBus.emit('partnership-dissolve-requested', data);
      const requester = store().state?.players.find(p => p.id === data.requesterId);
      if (requester) store().addToast(`${requester.name} requested partnership dissolution`, 'warning');
    });
    socketManager.on(EVENTS.PARTNERSHIP_DISSOLVE_ACCEPTED, (data: S_PartnershipDissolveAccepted) => {
      gameBus.emit('partnership-dissolve-accepted', data);
    });
    socketManager.on(EVENTS.PARTNERSHIP_DISSOLVE_REJECTED, (data: S_PartnershipDissolveRejected) => {
      gameBus.emit('partnership-dissolve-rejected', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} rejected dissolution`, 'warning');
    });
    socketManager.on(EVENTS.PARTNERSHIP_DISSOLVED, (data: S_PartnershipDissolved) => {
      gameBus.emit('partnership-dissolved', data);
      store().addToast('Partnership dissolved!', 'info');
    });
    socketManager.on(EVENTS.PARTNERSHIP_RENT_SPLIT, (data: S_PartnershipRentSplit) => {
      gameBus.emit('partnership-rent-split', data);
    });
    socketManager.on(EVENTS.PARTNERSHIP_BUILD_COST_SPLIT, (data: S_PartnershipBuildCostSplit) => {
      gameBus.emit('partnership-build-cost-split', data);
    });

    // ── Rent Deals ──────────────────────────────────────────────────────────
    socketManager.on(EVENTS.DEAL_OFFERED, (data: S_DealOffered) => {
      gameBus.emit('deal-offered', data);
      const debtor = store().state?.players.find(p => p.id === data.deal.debtorId);
      if (debtor) store().addToast(`${debtor.name} proposed a rent deal`, 'info');
      const myId = store().myPlayerId;
      if (myId && data.deal.creditorIds.includes(myId)) {
        gameBus.emit('open-negotiation');
      }
    });
    socketManager.on(EVENTS.DEAL_COUNTERED, (data: S_DealCountered) => {
      gameBus.emit('deal-countered', data);
      store().addToast('Rent deal countered!', 'warning');
      const myId = store().myPlayerId;
      if (myId && data.deal.debtorId === myId) {
        gameBus.emit('open-negotiation');
      }
    });
    socketManager.on(EVENTS.DEAL_ACCEPTED, (data: S_DealAccepted) => {
      gameBus.emit('deal-accepted', data);
    });
    socketManager.on(EVENTS.DEAL_REJECTED, (data: S_DealRejected) => {
      gameBus.emit('deal-rejected', data);
      store().addToast('Rent deal rejected', 'warning');
    });
    socketManager.on(EVENTS.DEAL_COMPLETED, (data: S_DealCompleted) => {
      gameBus.emit('deal-completed', data);
      store().addToast(`Rent deal completed! ${formatMoney(data.exemptedAmount)} exempted`, 'success');
    });
    socketManager.on(EVENTS.DEAL_CANCELLED, (_data: S_DealCancelled) => {
      gameBus.emit('deal-cancelled', _data);
      store().addToast('Rent deal cancelled', 'info');
    });

    // ── Dev Hacks persistence ─────────────────────────────────────────────────
    socketManager.on(EVENTS.DEV_HACKS_UPDATED, (data: { devHacks: DevHacks }) => {
      try {
        localStorage.setItem('mockopoly-dev-hacks', JSON.stringify(data.devHacks));
      } catch { /* ignore */ }
    });

    // ── Error ─────────────────────────────────────────────────────────────────
    socketManager.on(EVENTS.ERROR, (data: S_Error) => {
      console.error('[server error]', data.code, data.message);
      store().addToast(data.message, 'error');
    });
  }

  private restoreDevHacks(): void {
    try {
      const saved = localStorage.getItem('mockopoly-dev-hacks');
      if (!saved) return;
      const hacks: DevHacks = JSON.parse(saved);
      for (const [key, enabled] of Object.entries(hacks)) {
        if (enabled) {
          socketManager.emit(EVENTS.DEV_SET_HACK, { hack: key, enabled: true });
        }
      }
    } catch { /* ignore corrupt data */ }
  }
}

export const gameStateSync = new GameStateSync();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- GameStateSync`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/network/GameStateSync.ts src/network/GameStateSync.test.ts
git commit -m "feat: rewire GameStateSync to zustand store + gameBus (drop Phaser)"
```

---

### Task 7: App bootstrap — connect, register, empty Canvas, status overlay

**Files:**
- Create: `mockopoly-client-3d/src/ui/ConnectionStatus.tsx`
- Create: `mockopoly-client-3d/src/App.tsx`
- Create: `mockopoly-client-3d/src/main.tsx`
- Create: `mockopoly-client-3d/src/index.css`
- Test: `mockopoly-client-3d/src/ui/ConnectionStatus.test.tsx`

**Interfaces:**
- Consumes: `socketManager` (Task 3), `gameStateSync` (Task 6).
- Produces: `<App />` (mounts the R3F Canvas + overlay), `<ConnectionStatus connected={boolean} playerId={string | null} />` (pure presentational component).

- [ ] **Step 1: Write the failing test for `ConnectionStatus`**

Create `src/ui/ConnectionStatus.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from './ConnectionStatus';

describe('ConnectionStatus', () => {
  it('shows connecting when not connected', () => {
    render(<ConnectionStatus connected={false} playerId={null} />);
    expect(screen.getByText(/connecting/i)).toBeTruthy();
  });
  it('shows connected and the player id when connected', () => {
    render(<ConnectionStatus connected={true} playerId="abc123" />);
    expect(screen.getByText(/connected/i)).toBeTruthy();
    expect(screen.getByText(/abc123/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Install the React testing library dev deps**

```bash
npm install -D @testing-library/react@^16.0.1 @testing-library/dom@^10.4.0
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- ConnectionStatus`
Expected: FAIL — `Cannot find module './ConnectionStatus'`.

- [ ] **Step 4: Write `ConnectionStatus.tsx`**

Create `src/ui/ConnectionStatus.tsx`:

```tsx
interface Props {
  connected: boolean;
  playerId: string | null;
}

export function ConnectionStatus({ connected, playerId }: Props) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: 12,
        padding: '8px 14px',
        borderRadius: 999,
        fontFamily: 'ui-rounded, system-ui, sans-serif',
        fontWeight: 700,
        fontSize: 13,
        color: '#fffdf8',
        background: connected ? '#2f9153' : '#e07d0a',
        boxShadow: '0 8px 22px -10px rgba(80,60,20,.45)',
      }}
    >
      {connected ? `Connected · ${playerId ?? 'no id yet'}` : 'Connecting…'}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- ConnectionStatus`
Expected: PASS (2 tests).

- [ ] **Step 6: Write `App.tsx` (Canvas + live status)**

Create `src/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { socketManager } from './network/SocketManager';
import { gameStateSync } from './network/GameStateSync';
import { ConnectionStatus } from './ui/ConnectionStatus';

export default function App() {
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
    socket.on('connect_ack', onAck);
    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_ack', onAck);
    };
  }, []);

  return (
    <>
      <ConnectionStatus connected={connected} playerId={playerId} />
      <Canvas
        style={{ position: 'fixed', inset: 0 }}
        camera={{ position: [0, 6, 8], fov: 50 }}
        shadows
      >
        <color attach="background" args={['#cbe8f5']} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[10, 10]} />
          <meshStandardMaterial color="#f6eed9" />
        </mesh>
      </Canvas>
    </>
  );
}
```

Note: the ack event string is `'connect_ack'` only if that is the literal value of `EVENTS.CONNECT_ACK`. If the raw string differs, import `EVENTS` and use `EVENTS.CONNECT_ACK` here instead. Verify against `src/types/SocketEvents.ts` before finalizing.

- [ ] **Step 7: Write `main.tsx` and `index.css`**

Create `src/index.css`:

```css
html, body, #root { margin: 0; height: 100%; overflow: hidden; }
body { background: #cbe8f5; }
```

Create `src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 8: Verify the build and a manual smoke run**

Run: `npm run build`
Expected: `tsc` passes with no type errors, `vite build` emits `dist/`.

Then, with the server running (`cd ../mockopoly-server && npm run dev` in another terminal), run: `npm run dev` and open `http://localhost:5174`.
Expected: an empty daylight 3D scene with a cream floor plane, and a green "Connected · <id>" pill top-left. If the server is down, the pill reads "Connecting…" on an amber background.

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites (format, contract, SocketManager, gameStore, gameBus, GameStateSync, ConnectionStatus).

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx src/main.tsx src/index.css src/ui/ConnectionStatus.tsx src/ui/ConnectionStatus.test.tsx package.json package-lock.json
git commit -m "feat: app bootstrap — connect, register sync, empty R3F canvas + status"
```

---

### Task 8: Move design docs in, write README, open the PR

**Files:**
- Move: `PRODUCT.md`, `DESIGN.md` → `mockopoly-client-3d/`
- Move: `docs/superpowers/specs/2026-07-22-mockopoly-3d-conversion-design.md` and `docs/superpowers/plans/2026-07-22-mockopoly-3d-phase-0-scaffold.md` → `mockopoly-client-3d/docs/`
- Create: `mockopoly-client-3d/README.md`

**Interfaces:** none (documentation + repo hygiene).

- [ ] **Step 1: Move the design context into the new repo**

```bash
cd /Users/arslan/Desktop/Monopoly
git -C mockopoly-client-3d mv PRODUCT.md PRODUCT.md 2>/dev/null || true
mv PRODUCT.md DESIGN.md mockopoly-client-3d/
mkdir -p mockopoly-client-3d/docs
mv docs/superpowers/specs/2026-07-22-mockopoly-3d-conversion-design.md mockopoly-client-3d/docs/
mv docs/superpowers/plans/2026-07-22-mockopoly-3d-phase-0-scaffold.md mockopoly-client-3d/docs/
cd mockopoly-client-3d
```

(The workspace root is not a git repo, so these are plain `mv`s; the files become tracked in the new repo.)

- [ ] **Step 2: Write `README.md`**

Create `README.md`:

```markdown
# Mockopoly 3D

A 3D (react-three-fiber) client for the server-authoritative Mockopoly engine.
The bright low-poly "living toy city". See `docs/` for the design spec and the
architecture reference. Product/visual direction: `PRODUCT.md`, `DESIGN.md`.

## Run

Requires the Mockopoly server running (default `http://localhost:3001`).

    npm install
    cp .env.example .env      # optionally point VITE_SERVER_URL elsewhere
    npm run dev               # http://localhost:5174

## Test

    npm test

## Wire contract

`src/types/GameState.ts` and `src/types/SocketEvents.ts` are vendored copies of
the server's types. **The server is the source of truth.** After the server's
contract changes, re-sync (requires `mockopoly-server` checked out as a sibling
directory):

    npm run sync-contract

## Architecture

Server owns all game state. This client is a read-only mirror: `SocketManager`
receives events, `GameStateSync` writes durable state into the `gameStore`
(zustand) and relays transient animation events onto `gameBus` (eventemitter3).
React + R3F render the store; no game logic lives here.

## Git

Org `mockopoly-js`. Personal SSH remote (`git@personal:`). No direct pushes to
`main`/`staging`/`dev` — integrate via PRs only.
```

- [ ] **Step 3: Commit**

```bash
git add README.md PRODUCT.md DESIGN.md docs
git commit -m "docs: add README + move product/design/spec/plan into repo"
```

- [ ] **Step 4: Push the branch and open the PR**

```bash
git push -u origin feat/scaffold
gh pr create --repo mockopoly-js/mockopoly-client-3d --base main --head feat/scaffold \
  --title "Phase 0: scaffold 3D client (R3F + zustand, server-authoritative mirror)" \
  --body "Scaffolds mockopoly-client-3d: Vite + React + TS + react-three-fiber. Copies the renderer-agnostic stack (SocketManager, wire contract, formatMoney) from the 2D client and replaces the Phaser-EventEmitter state singletons with a zustand gameStore + eventemitter3 gameBus. Connects to the untouched server and renders an empty daylight Canvas with a live connection indicator. All logic unchanged; server untouched. Tests: format, contract, SocketManager, gameStore, gameBus, GameStateSync, ConnectionStatus."
```

Expected: PR opened against `main`. **Do not merge from the CLI** — Arslan merges via the web UI.

- [ ] **Step 5: Report the PR URL**

Print the PR URL from the `gh pr create` output for Arslan to review and merge.

---

## Self-Review

**1. Spec coverage (Phase 0 rows of §10 + relevant §3):**
- Repo create + personal SSH remote + org → Task 1 (Step 14), Task 8 (PR).
- Vite/React/TS/R3F scaffold → Task 1.
- Copy contract + network + state → Tasks 2, 3, 6.
- De-Phaser → zustand store → Task 4; transient events → Task 5; GameStateSync rewire → Task 6.
- Connect to server + store updates on a socket event (Phase 0 acceptance) → Task 6 test + Task 7 App.
- Empty Canvas + "connected" indicator → Task 7.
- Move PRODUCT.md/DESIGN.md/docs in → Task 8.
- Contract sync script + server-as-source-of-truth + preserve `S_MortgageLifteed` → Task 2, Global Constraints.
- PR-only, no direct pushes → Task 8, Global Constraints.

**2. Placeholder scan:** No TBD/TODO. Every code step shows complete code. The one conditional (Task 7 Step 6 ack event string) has an explicit verification instruction, not a placeholder.

**3. Type consistency:** `update`, `addToast`, `setReconnectToken`, `clearReconnectToken`, `selectProperty`, selector names (`selectMyPlayer`/`selectIsMyTurn`/`selectCurrentPlayer`), `getStoredReconnectToken`, `gameBus`, `gameStateSync.register`, `socketManager` API are used consistently across Tasks 4–7 and match the Interfaces blocks.

**Open dependency note for the executor:** Tasks are ordered by dependency (1→8) and should be executed in order. The exact package versions in Task 1 Step 2 are current-known-good; if npm resolves a newer compatible minor, that is fine as long as `npm run build` and `npm test` pass.

---

## Execution Handoff

Phase 0 plan complete. Later phases (1 Lobby, 2 Turn core, 3 Full HUD + modals, 4 Polish + physics, 5 Real assets, 6 Mobile/perf) each get their own plan, authored after Phase 0 merges.
