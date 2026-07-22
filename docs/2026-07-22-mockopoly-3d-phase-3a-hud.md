# Mockopoly 3D — Phase 3a (Always-on HUD + Toasts + GameOver) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The persistent in-game HUD (all-player pods, my owned-property list, game log, rendered toasts) plus a real GameOver screen — all reading the durable `gameStore` snapshot, layered as HTML over the R3F `<Canvas>`. First slice of Phase 3 (full HUD + modals); the six emit-heavy modals follow in 3b/3c.

**Architecture:** New HTML overlay components read `store.state.*` via `useGameStore`; identity via `store.myPlayerId`. Toasts (already appended to `store.toasts` by `GameStateSync`, currently never rendered or trimmed) get a renderer + expiry. GameOver is driven by a top-level `gameBus 'game-over'` listener that stashes the `S_GameOver` payload in the store and flips `screen` to `'game-over'`.

**Tech Stack:** React 18, zustand, Vitest + @testing-library/react. No new dependencies. No R3F changes.

## Global Constraints

- **Server + 2D client untouched.** Build on `main` (Phases 0–2 merged, tip `9050a8d`).
- **Do NOT edit** `src/network/*`, `src/types/*` (contract), `src/constants/*`, `src/board/*`, or the P2 turn UI beyond what's specified. Phase 3a is additive UI + minimal `gameStore` additions.
- **`gameStore` additions (this phase):** `gameOver: S_GameOver | null` + `setGameOver`; `removeToast(timestamp: number)`; `reset()` also clears `gameOver`. (UI-state additions, consistent with Phase 1 adding `screen`.) Do not change `addToast`/`toasts` shape.
- **Identity:** `store.myPlayerId` only, never `socketManager.playerId`.
- **All content derives from the durable snapshot** `store.state` (`players`, `properties`, `partnerships`, `log`, `turn`, `status`). gameBus is only for transient signals (here: the `'game-over'` trigger).
- **Style tokens (match P2 overlays):** panel `#12121e`, text `#e8e8f0`, muted `#8888a0`/`#555570`, gold `#d4af37`, border `#2a2a40`; token colors `TOKEN_HEX`, group colors `COLOR_GROUP_HEX`; money via `formatMoney`; font `"ui-rounded, system-ui, sans-serif"`. HUD `zIndex` 30, toasts 45, GameOver is a full screen.
- **Verified shapes:** `GameLogEntry { timestamp:number; playerId:string|null; message:string; type }`; `S_GameOver { winnerId:string; finalStandings:Player[] }`; `Player { id,name,token,money,position,properties,isJailed,isBankrupt,isConnected,isHost,... }`; `PropertyState { spaceIndex,ownerId:string|null,houses,hasHotel,isMortgaged }`; `Partnership { colorGroup, partners:{playerId,percentage}[], status:'pending'|'active' }`; `BOARD_SPACES[i] { index,type,name,colorGroup?,... }`. `EVENTS.GAME_OVER='game:over'` → gameBus `'game-over'`.
- **jest-dom NOT installed:** use `(el as HTMLButtonElement).disabled` / `screen.getByText`(throws) / `container` queries, not `toBeDisabled`/`toBeInTheDocument`. Wrap store mutations + `gameBus.emit` in `act()`.
- **Component (R3F) that can't be jsdom-tested:** none here — all Phase 3a components are plain HTML, unit-testable. App composition is build-verified + a routing test.
- **Git:** branch `feat/hud-panels` OFF `main`; `gh` + `git@personal:`; no direct pushes/merges to protected branches; PR only (base `main`); clean tree after each commit; no `.superpowers/` committed.

**Working directory:** `/Users/arslan/Desktop/Monopoly/mockopoly-client-3d`.

---

### Task 1: gameStore — gameOver payload + removeToast

**Files:**
- Modify: `src/state/gameStore.ts`
- Test: `src/state/gameStore.test.ts` (append)

**Interfaces:**
- Produces: store field `gameOver: S_GameOver | null` (initial `null`) + action `setGameOver(g: S_GameOver | null)`; action `removeToast(timestamp: number)`; `reset()` sets `gameOver: null`. Consumed by ToastLayer (Task 2), GameOverScreen + App (Task 6).

- [ ] **Step 1: Branch**

```bash
cd /Users/arslan/Desktop/Monopoly/mockopoly-client-3d
git checkout main && git pull origin main
git checkout -b feat/hud-panels
```

- [ ] **Step 2: Append failing tests to `src/state/gameStore.test.ts`**

```ts
  it('stores and clears the gameOver payload', () => {
    const go = { winnerId: 'p1', finalStandings: [] } as any;
    useGameStore.getState().setGameOver(go);
    expect(useGameStore.getState().gameOver).toBe(go);
    useGameStore.getState().reset();
    expect(useGameStore.getState().gameOver).toBe(null);
  });

  it('removes a toast by timestamp', () => {
    useGameStore.getState().addToast('a', 'info');
    const ts = useGameStore.getState().toasts[0].timestamp;
    useGameStore.getState().addToast('b', 'error');
    useGameStore.getState().removeToast(ts);
    const msgs = useGameStore.getState().toasts.map((t) => t.message);
    expect(msgs).not.toContain('a');
    expect(msgs).toContain('b');
  });
```

- [ ] **Step 3: Run, expect fail**

Run: `npm test -- gameStore` → FAIL (`setGameOver`/`gameOver`/`removeToast` undefined).

- [ ] **Step 4: Edit `src/state/gameStore.ts`**

Add the import at the top:

```ts
import type { S_GameOver } from '../types/SocketEvents';
```

Add to the `GameStore` interface (state + actions):

```ts
  gameOver: S_GameOver | null;
  setGameOver: (gameOver: S_GameOver | null) => void;
  removeToast: (timestamp: number) => void;
```

Add to the initial state object (near `toasts: []`):

```ts
  gameOver: null,
```

Add the actions (near `addToast`):

```ts
  setGameOver: (gameOver) => set({ gameOver }),
  removeToast: (timestamp) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.timestamp !== timestamp) })),
```

In `reset()`'s `set({...})` patch, add `gameOver: null`.

- [ ] **Step 5: Run, expect pass**

Run: `npm test -- gameStore` → PASS. Then full `npm test`.

- [ ] **Step 6: Commit**

```bash
git add src/state/gameStore.ts src/state/gameStore.test.ts
git commit -m "feat(hud): gameStore gameOver payload + removeToast"
```

---

### Task 2: ToastLayer

**Files:**
- Create: `src/ui/ToastLayer.tsx`
- Test: `src/ui/ToastLayer.test.tsx`

**Interfaces:**
- Consumes: `useGameStore` (`toasts`, `removeToast`). Produces: `<ToastLayer />` — renders `store.toasts` top-center, color by type, auto-removes each after 3s via `removeToast`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/ToastLayer.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastLayer } from './ToastLayer';
import { useGameStore } from '../state/gameStore';

describe('ToastLayer', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders current toasts', () => {
    render(<ToastLayer />);
    act(() => { useGameStore.getState().addToast('Maya bought a property!', 'success'); });
    expect(screen.getByText(/maya bought a property/i)).toBeTruthy();
  });

  it('auto-removes a toast after 3s', () => {
    render(<ToastLayer />);
    act(() => { useGameStore.getState().addToast('gone soon', 'info'); });
    expect(screen.getByText(/gone soon/i)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3100); });
    expect(useGameStore.getState().toasts).toHaveLength(0);
    expect(screen.queryByText(/gone soon/i)).toBe(null);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npm test -- ToastLayer` → FAIL (module missing).

- [ ] **Step 3: Implement `src/ui/ToastLayer.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import type { ToastType } from '../types/ui';

const COLOR: Record<ToastType, string> = {
  info: '#3fb6c9', success: '#46b16a', warning: '#e0a30a', error: '#e5533d',
};

export function ToastLayer() {
  const toasts = useGameStore((s) => s.toasts);
  const removeToast = useGameStore((s) => s.removeToast);
  const scheduled = useRef<Set<number>>(new Set());

  useEffect(() => {
    for (const t of toasts) {
      if (scheduled.current.has(t.timestamp)) continue;
      scheduled.current.add(t.timestamp);
      setTimeout(() => {
        removeToast(t.timestamp);
        scheduled.current.delete(t.timestamp);
      }, 3000);
    }
  }, [toasts, removeToast]);

  if (!toasts.length) return null;
  return (
    <div style={wrap}>
      {toasts.map((t, i) => (
        <div key={`${t.timestamp}-${i}`} style={{ ...toast, borderLeft: `4px solid ${COLOR[t.type]}` }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', flexDirection: 'column', gap: 8, zIndex: 45, pointerEvents: 'none',
  fontFamily: 'ui-rounded, system-ui, sans-serif', alignItems: 'center',
};
const toast: React.CSSProperties = {
  background: '#12121e', color: '#e8e8f0', padding: '8px 16px', borderRadius: 10,
  fontWeight: 700, fontSize: 13, boxShadow: '0 8px 22px -10px rgba(0,0,0,.6)', maxWidth: 360,
};
```

Note: `key` uses `timestamp-index` because `addToast` stamps `Date.now()` and two toasts can share a ms.

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- ToastLayer` → PASS (2). Then full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/ToastLayer.tsx src/ui/ToastLayer.test.tsx
git commit -m "feat(hud): ToastLayer renders + auto-expires store toasts"
```

---

### Task 3: PlayerPods

**Files:**
- Create: `src/ui/PlayerPods.tsx`
- Test: `src/ui/PlayerPods.test.tsx`

**Interfaces:**
- Consumes: `useGameStore` (`state.players`, `state.turn.currentPlayerId`, `myPlayerId`), `TOKEN_HEX`, `formatMoney`. Produces: `<PlayerPods />` — one pod per player: token dot, name (+YOU), money, badges (jailed/bankrupt/disconnected/host), turn highlight.

- [ ] **Step 1: Write the failing test**

Create `src/ui/PlayerPods.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerPods } from './PlayerPods';
import { useGameStore } from '../state/gameStore';
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

  it('renders a pod per player with money', () => {
    setPlayers([seat('p1', 'Maya', { isHost: true }), seat('p2', 'Jonas', { token: 'blue' })]);
    render(<PlayerPods />);
    expect(screen.getByText('Maya')).toBeTruthy();
    expect(screen.getByText('Jonas')).toBeTruthy();
    expect(screen.getAllByText(/£15\.000M/)).toHaveLength(2);
  });

  it('marks jailed and bankrupt players', () => {
    setPlayers([seat('p1', 'Maya'), seat('p2', 'Jonas', { isJailed: true }), seat('p3', 'Kwan', { isBankrupt: true })]);
    render(<PlayerPods />);
    expect(screen.getByText(/jail/i)).toBeTruthy();
    expect(screen.getByText(/bankrupt/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect fail** — `npm test -- PlayerPods`.

- [ ] **Step 3: Implement `src/ui/PlayerPods.tsx`**

```tsx
import { useGameStore } from '../state/gameStore';
import { TOKEN_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';
import type { Player, TokenType } from '../types/GameState';

export function PlayerPods() {
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const currentId = useGameStore((s) => s.state?.turn.currentPlayerId);
  const myId = useGameStore((s) => s.myPlayerId);
  if (!players.length) return null;

  return (
    <div style={wrap}>
      {players.map((p) => {
        const badges = [
          p.isHost ? 'HOST' : null,
          p.isJailed ? 'JAIL' : null,
          p.isBankrupt ? 'BANKRUPT' : null,
          !p.isConnected ? 'OFFLINE' : null,
        ].filter(Boolean).join(' · ');
        return (
          <div key={p.id} style={{ ...pod, outline: p.id === currentId ? '2px solid #d4af37' : 'none', opacity: p.isBankrupt ? 0.5 : 1 }}>
            <span style={{ ...dot, background: TOKEN_HEX[p.token as TokenType] }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>
                {p.name}{p.id === myId && <span style={{ color: '#8888a0' }}> (you)</span>}
              </div>
              {badges && <div style={{ fontSize: 10, color: '#8888a0', fontWeight: 700 }}>{badges}</div>}
            </div>
            <span style={{ fontWeight: 800, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: p.money < 0 ? '#e5533d' : '#46b16a' }}>
              {formatMoney(p.money)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed', top: 14, right: 14, display: 'flex', flexDirection: 'column', gap: 8,
  fontFamily: 'ui-rounded, system-ui, sans-serif', zIndex: 30, width: 200,
};
const pod: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, background: '#12121e', color: '#e8e8f0',
  borderRadius: 12, padding: '8px 11px', boxShadow: '0 8px 22px -12px rgba(0,0,0,.6)',
};
const dot: React.CSSProperties = { width: 20, height: 20, borderRadius: '50%', flex: 'none' };
```

- [ ] **Step 4: Run, expect pass** — `npm test -- PlayerPods` (2). Then full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/PlayerPods.tsx src/ui/PlayerPods.test.tsx
git commit -m "feat(hud): PlayerPods status panel"
```

---

### Task 4: PropertyListPanel

**Files:**
- Create: `src/ui/PropertyListPanel.tsx`
- Test: `src/ui/PropertyListPanel.test.tsx`

**Interfaces:**
- Consumes: `useGameStore` (`state.properties`, `state.partnerships`, `myPlayerId`), `BOARD_SPACES`, `COLOR_GROUP_HEX`. Produces: `<PropertyListPanel />` — lists properties owned directly by me or via an active partnership on the space's color group; each row: color strip, name, badges (`Nh`, `Hotel`, `[M]`).

- [ ] **Step 1: Write the failing test**

Create `src/ui/PropertyListPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PropertyListPanel } from './PropertyListPanel';
import { useGameStore } from '../state/gameStore';
import { BOARD_SPACES } from '../constants/board';
import type { GameState } from '../types/GameState';

const props = BOARD_SPACES.filter((s) => s.type === 'property' && s.colorGroup).slice(0, 2);

function setState(properties: unknown[], partnerships: unknown[] = []) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red' }],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 }, partnerships, properties,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('PropertyListPanel', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('lists my directly-owned properties with build badges', () => {
    setState([
      { spaceIndex: props[0].index, ownerId: 'p1', houses: 2, hasHotel: false, isMortgaged: false },
      { spaceIndex: props[1].index, ownerId: 'p2', houses: 0, hasHotel: false, isMortgaged: false },
    ]);
    render(<PropertyListPanel />);
    expect(screen.getByText(props[0].name)).toBeTruthy();     // mine
    expect(screen.queryByText(props[1].name)).toBe(null);      // not mine
    expect(screen.getByText(/2h/i)).toBeTruthy();
  });

  it('includes properties owned via an active partnership on the group', () => {
    const grp = props[0].colorGroup;
    setState(
      [{ spaceIndex: props[0].index, ownerId: 'p2', houses: 0, hasHotel: false, isMortgaged: false }],
      [{ colorGroup: grp, status: 'active', partners: [{ playerId: 'p1', percentage: 50 }, { playerId: 'p2', percentage: 50 }] }],
    );
    render(<PropertyListPanel />);
    expect(screen.getByText(props[0].name)).toBeTruthy(); // via partnership
  });
});
```

- [ ] **Step 2: Run, expect fail** — `npm test -- PropertyListPanel`.

- [ ] **Step 3: Implement `src/ui/PropertyListPanel.tsx`**

```tsx
import { useGameStore } from '../state/gameStore';
import { BOARD_SPACES } from '../constants/board';
import { COLOR_GROUP_HEX } from '../constants/theme';
import type { PropertyState, Partnership } from '../types/GameState';

export function PropertyListPanel() {
  const properties: PropertyState[] = useGameStore((s) => s.state?.properties) ?? [];
  const partnerships: Partnership[] = useGameStore((s) => s.state?.partnerships) ?? [];
  const myId = useGameStore((s) => s.myPlayerId);
  if (!myId) return null;

  const myPartnerGroups = new Set(
    partnerships
      .filter((pt) => pt.status === 'active' && pt.partners.some((e) => e.playerId === myId))
      .map((pt) => pt.colorGroup),
  );

  const rows = properties.filter((p) => {
    if (p.ownerId === myId) return true;
    if (p.ownerId == null) return false;
    const space = BOARD_SPACES[p.spaceIndex];
    return !!space?.colorGroup && myPartnerGroups.has(space.colorGroup);
  });

  if (!rows.length) return null;

  return (
    <div style={wrap}>
      <div style={hdr}>Your properties</div>
      {rows.map((p) => {
        const space = BOARD_SPACES[p.spaceIndex];
        const badges = [
          p.hasHotel ? 'Hotel' : p.houses > 0 ? `${p.houses}h` : null,
          p.isMortgaged ? '[M]' : null,
        ].filter(Boolean).join(' ');
        const accent = space?.colorGroup ? COLOR_GROUP_HEX[space.colorGroup] : '#555570';
        return (
          <div key={p.spaceIndex} style={{ ...row, opacity: p.isMortgaged ? 0.6 : 1 }}>
            <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: accent }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space?.name ?? `#${p.spaceIndex}`}</span>
            {badges && <span style={{ color: '#8888a0', fontWeight: 700, fontSize: 11 }}>{badges}</span>}
          </div>
        );
      })}
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed', top: 14, left: 14, width: 190, background: '#12121e', color: '#e8e8f0',
  borderRadius: 12, padding: 12, fontFamily: 'ui-rounded, system-ui, sans-serif', zIndex: 30,
  maxHeight: '55vh', overflowY: 'auto', boxShadow: '0 8px 22px -12px rgba(0,0,0,.6)',
};
const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8888a0', fontWeight: 800, marginBottom: 8 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, padding: '5px 0' };
```

- [ ] **Step 4: Run, expect pass** — `npm test -- PropertyListPanel` (2). Then full `npm test`. If `Partnership.partners`/`percentage` field names differ, match `types/GameState.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/PropertyListPanel.tsx src/ui/PropertyListPanel.test.tsx
git commit -m "feat(hud): owned-property list (direct + partnership)"
```

---

### Task 5: GameLog

**Files:**
- Create: `src/ui/GameLog.tsx`
- Test: `src/ui/GameLog.test.tsx`

**Interfaces:**
- Consumes: `useGameStore` (`state.log`). Produces: `<GameLog />` — last 6 `GameLogEntry` newest-first.

- [ ] **Step 1: Write the failing test**

Create `src/ui/GameLog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameLog } from './GameLog';
import { useGameStore } from '../state/gameStore';
import type { GameState } from '../types/GameState';

function setLog(messages: string[]) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress', players: [], turn: { currentPlayerId: null },
    config: { maxPlayers: 4 }, properties: [],
    log: messages.map((m, i) => ({ timestamp: i, playerId: null, message: m, type: 'system' })),
  } as unknown as GameState);
}

describe('GameLog', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('shows the most recent entries newest-first', () => {
    setLog(['first', 'second', 'third']);
    render(<GameLog />);
    const items = screen.getAllByTestId('log-entry');
    expect(items[0].textContent).toContain('third');
    expect(items[items.length - 1].textContent).toContain('first');
  });

  it('caps at 6 entries', () => {
    setLog(Array.from({ length: 10 }, (_, i) => `m${i}`));
    render(<GameLog />);
    expect(screen.getAllByTestId('log-entry')).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run, expect fail** — `npm test -- GameLog`.

- [ ] **Step 3: Implement `src/ui/GameLog.tsx`**

```tsx
import { useGameStore } from '../state/gameStore';
import type { GameLogEntry } from '../types/GameState';

export function GameLog() {
  const log: GameLogEntry[] = useGameStore((s) => s.state?.log) ?? [];
  if (!log.length) return null;
  const recent = log.slice(-6).reverse();
  return (
    <div style={wrap}>
      <div style={hdr}>Log</div>
      {recent.map((e, i) => (
        <div key={`${e.timestamp}-${i}`} data-testid="log-entry" style={entry}>{e.message}</div>
      ))}
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed', bottom: 14, right: 14, width: 240, background: '#12121e', color: '#8888a0',
  borderRadius: 12, padding: 12, fontFamily: 'ui-rounded, system-ui, sans-serif', zIndex: 30,
  boxShadow: '0 8px 22px -12px rgba(0,0,0,.6)',
};
const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#555570', fontWeight: 800, marginBottom: 6 };
const entry: React.CSSProperties = { fontSize: 12, fontWeight: 500, padding: '3px 0', lineHeight: 1.35 };
```

- [ ] **Step 4: Run, expect pass** — `npm test -- GameLog` (2). Then full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/GameLog.tsx src/ui/GameLog.test.tsx
git commit -m "feat(hud): game log feed"
```

---

### Task 6: GameOverScreen + App wiring (HUD + game-over routing)

**Files:**
- Create: `src/screens/GameOverScreen.tsx`
- Test: `src/screens/GameOverScreen.test.tsx`
- Modify: `src/App.tsx` (game-over listener; render HUD panels + ToastLayer on game screen; game-over branch → GameOverScreen)
- Modify: `src/App.routing.test.tsx` (game-over screen renders GameOverScreen)

**Interfaces:**
- Consumes: `useGameStore` (`gameOver`, `myPlayerId`, `reset`), `TOKEN_HEX`, `formatMoney`. Produces: `<GameOverScreen />` — winner banner + standings + Back to Menu.

- [ ] **Step 1: Write the failing GameOverScreen test**

Create `src/screens/GameOverScreen.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run, expect fail** — `npm test -- GameOverScreen`.

- [ ] **Step 3: Implement `src/screens/GameOverScreen.tsx`**

```tsx
import { useGameStore } from '../state/gameStore';
import { TOKEN_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';
import type { Player, TokenType } from '../types/GameState';

export function GameOverScreen() {
  const gameOver = useGameStore((s) => s.gameOver);
  const myId = useGameStore((s) => s.myPlayerId);
  const reset = useGameStore((s) => s.reset);
  if (!gameOver) return null;

  const winner = gameOver.finalStandings.find((p) => p.id === gameOver.winnerId);
  const standings = [...gameOver.finalStandings].sort((a, b) =>
    a.isBankrupt !== b.isBankrupt ? (a.isBankrupt ? 1 : -1) : b.money - a.money,
  );

  return (
    <div style={wrap}>
      <h1 style={{ margin: 0, fontSize: 40, fontWeight: 800 }}>
        {winner ? (winner.id === myId ? 'You Win!' : `${winner.name} Wins!`) : 'Game Over'}
      </h1>
      <div style={card}>
        {standings.map((p: Player, i) => (
          <div key={p.id} data-testid="standing" style={{ ...row, opacity: p.isBankrupt ? 0.5 : 1 }}>
            <span style={{ width: 22, color: '#8888a0', fontWeight: 800 }}>{i + 1}</span>
            <span style={{ ...dot, background: TOKEN_HEX[p.token as TokenType] }} />
            <span style={{ flex: 1, fontWeight: 800 }}>{p.name}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: p.isBankrupt ? '#e5533d' : '#e8e8f0' }}>
              {p.isBankrupt ? 'Bankrupt' : formatMoney(p.money)}
            </span>
          </div>
        ))}
      </div>
      <button onClick={reset} style={btn}>Back to Menu</button>
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', gap: 22,
  alignItems: 'center', justifyContent: 'center', background: '#08080f', color: '#e8e8f0',
  fontFamily: 'ui-rounded, system-ui, sans-serif', zIndex: 60,
};
const card: React.CSSProperties = { background: '#12121e', borderRadius: 16, padding: 20, width: 340, display: 'flex', flexDirection: 'column', gap: 6 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' };
const dot: React.CSSProperties = { width: 18, height: 18, borderRadius: '50%' };
const btn: React.CSSProperties = { fontFamily: 'inherit', fontWeight: 800, fontSize: 15, color: '#08080f', background: '#d4af37', border: 'none', borderRadius: 14, padding: '12px 26px', cursor: 'pointer' };
```

- [ ] **Step 4: Run, expect pass** — `npm test -- GameOverScreen` (3). Then full `npm test`.

- [ ] **Step 5: Update `src/App.routing.test.tsx`**

Add a test that the game-over screen renders `GameOverScreen` (with a payload set). Keep existing mocks. Add:

```tsx
it('renders GameOverScreen on the game-over screen', () => {
  useGameStore.getState().setGameOver({ winnerId: 'p1', finalStandings: [{ id: 'p1', name: 'Maya', token: 'red', money: 1, isBankrupt: false } as any] });
  useGameStore.getState().setMyPlayerId('p1');
  useGameStore.getState().setScreen('game-over');
  render(<App />);
  expect(screen.getByText(/you win|maya wins/i)).toBeTruthy();
  expect(screen.queryByTestId('canvas')).toBe(null); // NOT the game canvas anymore
});
```

Run: `npm test -- App.routing` → this new assertion FAILS (App still renders GameScene on game-over).

- [ ] **Step 6: Edit `src/App.tsx`**

Imports:

```tsx
import { useGameBusEvent } from './state/useGameBus';
import { ToastLayer } from './ui/ToastLayer';
import { PlayerPods } from './ui/PlayerPods';
import { PropertyListPanel } from './ui/PropertyListPanel';
import { GameLog } from './ui/GameLog';
import { GameOverScreen } from './screens/GameOverScreen';
import type { S_GameOver } from './types/SocketEvents';
```

Inside `App`, add the game-over listener (after the existing connect effect):

```tsx
  const setGameOver = useGameStore((s) => s.setGameOver);
  const setScreen = useGameStore((s) => s.setScreen);
  useGameBusEvent('game-over', (d: S_GameOver) => { setGameOver(d); setScreen('game-over'); });
```

Change the screen rendering: the `'game'` branch renders GameScene + P2 overlays + the new HUD panels + ToastLayer; the `'game-over'` branch renders `<GameOverScreen/>` instead of GameScene:

```tsx
{screen === 'game' && (
  <>
    <GameScene />
    <TurnHud />
    <DiceDisplay />
    <BuyPrompt />
    <PropertyListPanel />
    <PlayerPods />
    <GameLog />
    <ToastLayer />
  </>
)}
{screen === 'game-over' && <GameOverScreen />}
```

(Remove the old combined `screen === 'game' || screen === 'game-over'` branch.)

- [ ] **Step 7: Verify** — `npm test -- App.routing` (pass), full `npm test`, `npm run build` (green).

- [ ] **Step 8: Commit**

```bash
git add src/screens/GameOverScreen.tsx src/screens/GameOverScreen.test.tsx src/App.tsx src/App.routing.test.tsx
git commit -m "feat(hud): GameOverScreen + wire HUD panels/toasts + game-over routing"
```

---

### Task 7: Push + PR

- [ ] **Step 1:** If the Phase 3a plan doc `docs/2026-07-22-mockopoly-3d-phase-3a-hud.md` is untracked, commit it: `git add docs/2026-07-22-mockopoly-3d-phase-3a-hud.md && git commit -m "docs: add Phase 3a (HUD) plan"`. Then `git status --porcelain` (empty), `npm test` (all pass), `npm run build` (green).
- [ ] **Step 2:** `git push -u origin feat/hud-panels`
- [ ] **Step 3:** `gh pr create --repo mockopoly-js/mockopoly-client-3d --base main --head feat/hud-panels --title "Phase 3a: always-on HUD (pods, properties, log, toasts) + GameOver" --body "First slice of Phase 3. Adds the persistent HUD — PlayerPods, owned-property list (direct + partnership), game log, and a ToastLayer that renders + auto-expires store toasts (fixing the unbounded-toast accumulation) — plus a GameOver screen driven by gameBus 'game-over'. Snapshot-driven, additive; no edits to network/contract/board. 3b (DevHacks, Mortgage/build) and 3c (Trade, Partnership, RentDeal) follow. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"`
- [ ] **Step 4:** Do NOT merge from a task. Report the PR URL. (Controller runs the final review; merge via `gh pr merge` after.)

---

## Self-Review

**Spec coverage (Phase 3 §10, HUD subset):** property panel → Task 4; log → Task 5; notifications → Task 2 (+ store Task 1); player status → Task 3; game-over → Task 6. Modals (trade/deal/negotiation/mortgage/partnership/devhacks) → deferred to 3b/3c (explicitly scoped out here).

**Placeholder scan:** complete code in every step. Field-name verification notes (Partnership.partners, GameLogEntry) are explicit checks with the confirmed shapes, not TODOs.

**Type consistency:** `gameOver`/`setGameOver`/`removeToast` defined Task 1, consumed Tasks 2/6; HUD components read the same `state.*` fields; `S_GameOver` shape matches the contract; `reset()` clears both `screen` and `gameOver`.

**Executor notes:** all Phase 3a components are plain HTML → fully unit-testable (no R3F/jsdom limits). Tasks ordered 1→7; App composition (Task 6) is build-verified + routing-tested.

## Execution Handoff

Execute via superpowers:subagent-driven-development — fresh implementer per task, task review + fix loop, final whole-branch review, PR, then merge. Phase 3b (DevHacks + Mortgage/build) follows.
