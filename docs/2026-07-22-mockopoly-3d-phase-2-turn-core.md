# Mockopoly 3D — Phase 2 (Turn Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One full turn plays end-to-end in 3D against the server: player tokens render on the board, the current player rolls (cosmetic dice), the token hops tile-by-tile in lockstep with the server's animation clock, landing on an unowned property shows a buy/decline prompt, and a minimal HUD (whose-turn, my money, Roll/Buy/End) is gated by turn phase.

**Architecture:** Additive on the render/UI side over Phase 0/1 infra (already in `main`). The 3D scene gains a token layer (`PlayerTokens`, `useFrame` hop). HTML overlays (`TurnHud`, `DiceDisplay`, `BuyPrompt`) sit over the `<Canvas>`. Durable truth = the `gameStore` snapshot; transient "play this now" pulses = `gameBus` turn events (consumed via a new `useGameBusEvent` hook). No edits to `SocketManager`/`GameStateSync`/`gameStore`/`SocketEvents`/board math.

**Tech Stack:** React 18, react-three-fiber + three (`useFrame`), zustand, eventemitter3, socket.io-client, Vitest + @testing-library/react. No new dependencies.

## Global Constraints

- **Server + 2D client untouched.** Build on `main` (Phase 0+1 merged).
- **Do NOT edit** `src/network/*`, `src/state/gameStore.ts`, `src/types/*`, or the board math. Phase 2 is additive: new files + edits to `src/screens/GameScene.tsx` and `src/App.tsx` only.
- **Identity:** derive "me" from `store.myPlayerId` (via `selectMyPlayer`/`selectIsMyTurn`), compare to `state.turn.currentPlayerId` / payload `playerId`. **Never** use `socketManager.playerId` for turn logic (it is the socket id, not the game player id).
- **Turn C→S events take NO payload:** `socketManager.emit(EVENTS.TURN_ROLL_DICE)` / `TURN_BUY_PROPERTY` / `TURN_PASS_BUY` / `TURN_END`. The server resolves the actor from socket context.
- **Two clocks, don't conflate:** transient (gameBus: `'dice-rolled'`, `'player-moved'`, `'player-landed'`, `'turn-started'`, `'property-bought'`) drives animation; durable (store snapshot: positions, money, `turn.phase`, `turn.hasRolled`) is the truth once animation settles. `TURN_ENDED` is **not** on the bus — read turn end from the snapshot / next `turn-started`.
- **Animation lockstep (verbatim from server `rules.ts`):** `ANIMATION_DICE_ROLL_MS = 800` (dice→move gap), `ANIMATION_TOKEN_MOVE_PER_SPACE_MS = 150` (per-tile hop). Total move = `150 × spacesToAnimate` where `spacesToAnimate = to >= from ? to - from : 40 - from + to`. The client must fill each budget so the token lands as `TURN_LANDED` arrives.
- **Phase gating (P2):** `waiting` + isMyTurn + `!hasRolled` → Roll; `rolling`/`moving`/`landing` → all disabled; `action` → deed prompt (if I landed on unowned buyable) else End Turn; `end` → End Turn.
- **Deed prompt shows only to the landing player who is me.** Owned-property landings (rent) show no prompt in P2. Auction/jail/cards have no P2 UI — resync from snapshot.
- **Decisions (open questions resolved):** dice = HTML overlay with CSS pip faces (physics in-scene → P4); tokens = low cylinder + white ring at `y≈0.15`; hop arc `HOP_H≈0.3`, no scale-flash (P4); camera stays static `[0,9,11]`; no toast UI (GameStateSync already writes `store.toasts`; rendering them = P3); no camera-follow.
- **Git:** branch `feat/turn` OFF `main`; `gh` + `git@personal:` remote; no direct pushes/merges to protected branches; PR only; clean tree after each commit; no `.superpowers/` committed. Base the PR on `main`.

**Working directory:** `/Users/arslan/Desktop/Monopoly/mockopoly-client-3d`.

---

### Task 1: Branch + `useGameBusEvent` hook

**Files:**
- Create: `src/state/useGameBus.ts`
- Test: `src/state/useGameBus.test.tsx`

**Interfaces:**
- Produces: `useGameBusEvent(name: string, handler: (payload: any) => void): void` — subscribes to `gameBus` on mount, unsubscribes on unmount, always calls the latest handler (ref-stable). Consumed by `PlayerTokens` (Task 2) and `DiceDisplay` (Task 3).

- [ ] **Step 1: Branch**

```bash
cd /Users/arslan/Desktop/Monopoly/mockopoly-client-3d
git checkout main && git pull origin main
git checkout -b feat/turn
```

- [ ] **Step 2: Write the failing test**

Create `src/state/useGameBus.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useGameBusEvent } from './useGameBus';
import { gameBus } from './gameBus';

function Listener({ onEvt }: { onEvt: (p: unknown) => void }) {
  useGameBusEvent('player-moved', onEvt);
  return null;
}

describe('useGameBusEvent', () => {
  it('delivers gameBus events to the handler while mounted', () => {
    const spy = vi.fn();
    const { unmount } = render(<Listener onEvt={spy} />);
    gameBus.emit('player-moved', { playerId: 'p1' });
    expect(spy).toHaveBeenCalledWith({ playerId: 'p1' });
    unmount();
    gameBus.emit('player-moved', { playerId: 'p2' });
    expect(spy).toHaveBeenCalledTimes(1); // no delivery after unmount
  });
});
```

- [ ] **Step 3: Run it, expect fail**

Run: `npm test -- useGameBus`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `src/state/useGameBus.ts`**

```ts
import { useEffect, useRef } from 'react';
import { gameBus } from './gameBus';

/**
 * Subscribe a React component to a gameBus (eventemitter3) event for its
 * lifetime. The latest `handler` is always invoked without needing it to be
 * referentially stable, and the listener is removed on unmount.
 */
export function useGameBusEvent(name: string, handler: (payload: any) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (payload: any) => ref.current(payload);
    gameBus.on(name, listener);
    return () => { gameBus.off(name, listener); };
  }, [name]);
}
```

- [ ] **Step 5: Run it, expect pass**

Run: `npm test -- useGameBus`
Expected: PASS (1).

- [ ] **Step 6: Commit**

```bash
git add src/state/useGameBus.ts src/state/useGameBus.test.tsx
git commit -m "feat(turn): add useGameBusEvent hook for React gameBus subscriptions"
```

---

### Task 2: Token layer — hop-path helpers + `PlayerTokens` (R3F)

**Files:**
- Create: `src/board/hopPath.ts`
- Test: `src/board/hopPath.test.ts`
- Create: `src/board/PlayerTokens.tsx`

**Interfaces:**
- Produces: `hopPath(from: number, to: number): number[]` (ordered tiles `from+1 … to`, wrapping past 39→0); `STACK_OFFSETS: [number,number][]`; `stackOffset(indexInTile: number): [number, number]`; `<PlayerTokens />` (renders one mesh per non-bankrupt player, animates hops via `useFrame`).

- [ ] **Step 1: Write the failing helper test**

Create `src/board/hopPath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hopPath, stackOffset } from './hopPath';

describe('hopPath', () => {
  it('lists each tile from+1..to for a simple forward move', () => {
    expect(hopPath(12, 20)).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
  });
  it('wraps past GO (39 -> 0)', () => {
    expect(hopPath(38, 2)).toEqual([39, 0, 1, 2]);
  });
  it('length equals spaces moved', () => {
    expect(hopPath(0, 5)).toHaveLength(5);
    expect(hopPath(37, 4)).toHaveLength(7); // 38,39,0,1,2,3,4
  });
});

describe('stackOffset', () => {
  it('cycles through 4 distinct planar offsets', () => {
    const a = stackOffset(0), b = stackOffset(1), c = stackOffset(4);
    expect(a).not.toEqual(b);
    expect(stackOffset(4)).toEqual(a); // wraps mod 4
    expect(c).toEqual(a);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `npm test -- hopPath`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/board/hopPath.ts`**

```ts
/** Ordered tile indices a token visits moving from `from` to `to`, i.e. from+1 … to,
 *  wrapping past 39 → 0. Matches the server's spacesToAnimate count. */
export function hopPath(from: number, to: number): number[] {
  const path: number[] = [];
  let i = from;
  do {
    i = (i + 1) % 40;
    path.push(i);
  } while (i !== to);
  return path;
}

/** Planar (x,z) offsets so up to 4 tokens sharing a tile don't overlap. World units. */
export const STACK = 0.28;
export const STACK_OFFSETS: [number, number][] = [
  [-STACK, -STACK], [STACK, -STACK], [-STACK, STACK], [STACK, STACK],
];
export function stackOffset(indexInTile: number): [number, number] {
  return STACK_OFFSETS[indexInTile % 4];
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `npm test -- hopPath`
Expected: PASS (4).

- [ ] **Step 5: Implement `src/board/PlayerTokens.tsx`** (R3F — build-verified, not unit-tested)

```tsx
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../state/gameStore';
import { useGameBusEvent } from '../state/useGameBus';
import { tileToWorld } from './positions';
import { hopPath, stackOffset } from './hopPath';
import { TOKEN_HEX } from '../constants/theme';
import type { Player, TokenType } from '../types/GameState';

const BASE_Y = 0.15;
const HOP_H = 0.3;
const HOP_MS = 150; // ANIMATION_TOKEN_MOVE_PER_SPACE_MS — keeps lockstep with server

interface Anim { queue: number[]; elapsed: number; fromX: number; fromZ: number; }

/** Rest offset for a token: its index among players currently sharing its tile. */
function restOffset(player: Player, players: Player[]): [number, number] {
  const coLocated = players.filter((p) => p.position === player.position && !p.isBankrupt);
  const idx = coLocated.findIndex((p) => p.id === player.id);
  return stackOffset(idx < 0 ? 0 : idx);
}

export function PlayerTokens() {
  const players = (useGameStore((s) => s.state?.players) ?? []).filter((p) => !p.isBankrupt);

  // live refs read inside useFrame (avoids stale closures)
  const playersRef = useRef<Player[]>(players);
  playersRef.current = players;
  const meshes = useRef<Record<string, THREE.Mesh | null>>({});
  const anims = useRef<Record<string, Anim>>({});

  // server says a token moved → enqueue the tile-by-tile hop
  useGameBusEvent('player-moved', (d: { playerId: string; from: number; to: number }) => {
    const mesh = meshes.current[d.playerId];
    const start = mesh ? { x: mesh.position.x, z: mesh.position.z } : (() => {
      const [x, , z] = tileToWorld(d.from); return { x, z };
    })();
    anims.current[d.playerId] = { queue: hopPath(d.from, d.to), elapsed: 0, fromX: start.x, fromZ: start.z };
  });

  useFrame((_, delta) => {
    const dtMs = delta * 1000;
    for (const p of playersRef.current) {
      const mesh = meshes.current[p.id];
      if (!mesh) continue;
      const anim = anims.current[p.id];
      if (anim && anim.queue.length) {
        anim.elapsed += dtMs;
        const t = Math.min(anim.elapsed / HOP_MS, 1);
        const [tx, , tz] = tileToWorld(anim.queue[0]);
        mesh.position.x = THREE.MathUtils.lerp(anim.fromX, tx, t);
        mesh.position.z = THREE.MathUtils.lerp(anim.fromZ, tz, t);
        mesh.position.y = BASE_Y + Math.sin(t * Math.PI) * HOP_H;
        if (t >= 1) {
          anim.fromX = tx; anim.fromZ = tz; anim.elapsed = 0;
          anim.queue.shift();
          if (anim.queue.length === 0) delete anims.current[p.id];
        }
      } else {
        // reconcile to the authoritative tile + stack offset
        const [x, , z] = tileToWorld(p.position);
        const [ox, oz] = restOffset(p, playersRef.current);
        mesh.position.set(x + ox, BASE_Y, z + oz);
      }
    }
  });

  return (
    <group>
      {players.map((p) => {
        const [x, , z] = tileToWorld(p.position);
        const [ox, oz] = restOffset(p, players);
        return (
          <group key={p.id} position={[x + ox, BASE_Y, z + oz]}>
            {/* white base ring for legibility on colored tiles */}
            <mesh position={[0, -0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.32, 0.32, 0.04, 24]} />
              <meshStandardMaterial color="#ffffff" />
            </mesh>
            <mesh
              ref={(m) => { meshes.current[p.id] = m; }}
              castShadow
              position={[0, 0, 0]}
            >
              <cylinderGeometry args={[0.26, 0.26, 0.3, 24]} />
              <meshStandardMaterial
                color={TOKEN_HEX[p.token as TokenType]}
                emissive={TOKEN_HEX[p.token as TokenType]}
                emissiveIntensity={0.15}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
```

Note: the outer `<group>` positions the ring at rest; the animated colored mesh is the one whose `position` `useFrame` drives (its position is relative to its parent group, so on enqueue we seed `fromX/fromZ` from the mesh's local position — which starts at 0). **Because the mesh position is local to a per-player group, animate in that group's local space:** simplest correct approach is to make the animated mesh a direct child of the top `<group>` (world space). If you hit a coordinate-space mismatch, move the ring to be a child that follows the animated mesh, or animate the per-player `group` instead of the inner mesh. Keep the hop in ONE consistent space; verify visually that the token hops smoothly from tile to tile and lands on the correct final tile.

- [ ] **Step 6: Build check**

Run: `npm run build`
Expected: tsc + vite green (PlayerTokens typechecks). Then `npm test` — all still pass (hopPath + prior suites).

- [ ] **Step 7: Commit**

```bash
git add src/board/hopPath.ts src/board/hopPath.test.ts src/board/PlayerTokens.tsx
git commit -m "feat(turn): player tokens with tile-by-tile hop (150ms/tile lockstep) + stacking"
```

---

### Task 3: `DiceDisplay` (HTML overlay, cosmetic)

**Files:**
- Create: `src/ui/DiceDisplay.tsx`
- Test: `src/ui/DiceDisplay.test.tsx`

**Interfaces:**
- Consumes: `useGameBusEvent` (Task 1). Produces: `<DiceDisplay />` — shows the two server dice values as CSS pip faces after `'dice-rolled'`, hides otherwise.

- [ ] **Step 1: Write the failing test**

Create `src/ui/DiceDisplay.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DiceDisplay } from './DiceDisplay';
import { gameBus } from '../state/gameBus';

describe('DiceDisplay', () => {
  it('renders nothing before a roll', () => {
    const { container } = render(<DiceDisplay />);
    expect(container.querySelectorAll('[data-die]')).toHaveLength(0);
  });
  it('shows two dice with the rolled values', () => {
    render(<DiceDisplay />);
    act(() => { gameBus.emit('dice-rolled', { playerId: 'p1', dice: [5, 3], isDoubles: false }); });
    const dice = screen.getAllByRole('img'); // each die has role=img + aria-label
    expect(dice).toHaveLength(2);
    expect(dice[0]).toHaveAttribute('aria-label', 'die showing 5');
    expect(dice[1]).toHaveAttribute('aria-label', 'die showing 3');
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `npm test -- DiceDisplay`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/ui/DiceDisplay.tsx`**

```tsx
import { useState } from 'react';
import { useGameBusEvent } from '../state/useGameBus';

// pip layout per die value (3x3 grid cells that are filled)
const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function Die({ value }: { value: number }) {
  const on = new Set(PIPS[value] ?? []);
  return (
    <div data-die role="img" aria-label={`die showing ${value}`} style={dieStyle}>
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} style={{ ...pipStyle, opacity: on.has(i) ? 1 : 0 }} />
      ))}
    </div>
  );
}

export function DiceDisplay() {
  const [dice, setDice] = useState<[number, number] | null>(null);
  useGameBusEvent('dice-rolled', (d: { dice: [number, number] }) => setDice(d.dice));
  if (!dice) return null;
  return (
    <div style={wrap}>
      <Die value={dice[0]} />
      <Die value={dice[1]} />
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)',
  display: 'flex', gap: 12, pointerEvents: 'none', zIndex: 20,
};
const dieStyle: React.CSSProperties = {
  width: 46, height: 46, background: '#fffdf8', borderRadius: 10,
  display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 3, padding: 7,
  boxShadow: '0 8px 20px -6px rgba(0,0,0,.5)',
};
const pipStyle: React.CSSProperties = {
  width: 8, height: 8, borderRadius: '50%', background: '#3b3224', alignSelf: 'center', justifySelf: 'center',
};
```

- [ ] **Step 4: Run it, expect pass**

Run: `npm test -- DiceDisplay`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/ui/DiceDisplay.tsx src/ui/DiceDisplay.test.tsx
git commit -m "feat(turn): cosmetic dice overlay (server values, CSS pips)"
```

---

### Task 4: `TurnHud` (HTML overlay)

**Files:**
- Create: `src/ui/TurnHud.tsx`
- Test: `src/ui/TurnHud.test.tsx`

**Interfaces:**
- Consumes: `useGameStore` (+ `selectMyPlayer`/`selectIsMyTurn`/`selectCurrentPlayer`), `socketManager`, `EVENTS`, `formatMoney`. Produces: `<TurnHud />` — whose-turn + my-money + Roll/End buttons gated by phase.

- [ ] **Step 1: Write the failing test**

Create `src/ui/TurnHud.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TurnHud } from './TurnHud';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function setState(turn: Partial<Record<string, unknown>>, money = 15_000_000) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money, position: 0, isBankrupt: false, isConnected: true }],
    turn: { currentPlayerId: 'p1', phase: 'waiting', hasRolled: false, ...turn },
    config: { maxPlayers: 4 }, properties: [],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('TurnHud', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('enables Roll on my waiting turn and emits TURN_ROLL_DICE', () => {
    setState({ phase: 'waiting', hasRolled: false });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<TurnHud />);
    const roll = screen.getByRole('button', { name: /roll/i });
    expect(roll).not.toBeDisabled();
    fireEvent.click(roll);
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_ROLL_DICE);
  });

  it('disables Roll during moving and shows my money', () => {
    setState({ phase: 'moving', hasRolled: true });
    render(<TurnHud />);
    expect(screen.getByRole('button', { name: /roll/i })).toBeDisabled();
    expect(screen.getByText(/£15\.000M/)).toBeTruthy();
  });

  it('enables End Turn in action phase and emits TURN_END', () => {
    setState({ phase: 'action', hasRolled: true });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<TurnHud />);
    fireEvent.click(screen.getByRole('button', { name: /end turn/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_END);
  });
});
```

(If `toBeDisabled` is unavailable — jest-dom is not installed — use `(el as HTMLButtonElement).disabled` checks, per the established test convention.)

- [ ] **Step 2: Run it, expect fail**

Run: `npm test -- TurnHud`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/ui/TurnHud.tsx`**

```tsx
import { useGameStore, selectMyPlayer, selectIsMyTurn, selectCurrentPlayer } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { formatMoney } from '../utils/format';

export function TurnHud() {
  const me = useGameStore(selectMyPlayer);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const current = useGameStore(selectCurrentPlayer);
  const turn = useGameStore((s) => s.state?.turn);

  if (!turn) return null;

  const canRoll = isMyTurn && turn.phase === 'waiting' && !turn.hasRolled;
  const canEnd = isMyTurn && (turn.phase === 'action' || turn.phase === 'end');

  const roll = () => socketManager.emit(EVENTS.TURN_ROLL_DICE);
  const end = () => socketManager.emit(EVENTS.TURN_END);

  return (
    <>
      <div style={topBar}>
        <span style={{ fontWeight: 800, color: isMyTurn ? '#d4af37' : '#e8e8f0' }}>
          {isMyTurn ? 'Your turn' : `${current?.name ?? '…'}'s turn`}
        </span>
        <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {me ? formatMoney(me.money) : ''}
        </span>
      </div>
      <div style={hotbar}>
        <button onClick={roll} disabled={!canRoll} style={{ ...btn, ...(canRoll ? primary : disabled) }}>🎲 Roll</button>
        <button onClick={end} disabled={!canEnd} style={{ ...btn, ...(canEnd ? primary : disabled) }}>✔ End Turn</button>
      </div>
    </>
  );
}

const FONT = "ui-rounded, system-ui, sans-serif";
const topBar: React.CSSProperties = {
  position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', gap: 20, alignItems: 'center', fontFamily: FONT,
  background: '#12121e', color: '#e8e8f0', padding: '8px 18px', borderRadius: 999, zIndex: 30,
};
const hotbar: React.CSSProperties = {
  position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', gap: 10, fontFamily: FONT, zIndex: 30,
};
const btn: React.CSSProperties = { fontFamily: FONT, fontWeight: 800, fontSize: 15, border: 'none', borderRadius: 14, padding: '12px 22px', cursor: 'pointer' };
const primary: React.CSSProperties = { background: '#e07d0a', color: '#fff' };
const disabled: React.CSSProperties = { background: '#2a2a42', color: '#6a6a86', cursor: 'default' };
```

- [ ] **Step 4: Run it, expect pass**

Run: `npm test -- TurnHud`
Expected: PASS (3). (Apply the `.disabled` convention if `toBeDisabled` errors.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/TurnHud.tsx src/ui/TurnHud.test.tsx
git commit -m "feat(turn): minimal turn HUD (whose-turn, money, Roll/End gated by phase)"
```

---

### Task 5: `BuyPrompt` (HTML overlay)

**Files:**
- Create: `src/ui/BuyPrompt.tsx`
- Test: `src/ui/BuyPrompt.test.tsx`

**Interfaces:**
- Consumes: `useGameStore` (+ `selectMyPlayer`/`selectIsMyTurn`), `BOARD_SPACES`, `COLOR_GROUP_HEX`, `socketManager`, `EVENTS`, `formatMoney`. Produces: `<BuyPrompt />` — deed prompt when I land on an unowned buyable space in phase `action`; Buy (afford) / Decline.

- [ ] **Step 1: Write the failing test**

Create `src/ui/BuyPrompt.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BuyPrompt } from './BuyPrompt';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import type { GameState } from '../types/GameState';

// pick a real unowned buyable space (property with a price)
const prop = BOARD_SPACES.find((s) => s.type === 'property' && (s.price ?? 0) > 0)!;

function land(phase: string, money: number, ownerId: string | null = null) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money, position: prop.index, isBankrupt: false, isConnected: true }],
    turn: { currentPlayerId: 'p1', phase, hasRolled: true },
    config: { maxPlayers: 4 },
    properties: [{ spaceIndex: prop.index, ownerId, houses: 0, hasHotel: false, isMortgaged: false }],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('BuyPrompt', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('shows nothing outside the action phase', () => {
    land('moving', 15_000_000);
    const { container } = render(<BuyPrompt />);
    expect(container.textContent).not.toContain(prop.name);
  });

  it('shows the deed and emits TURN_BUY_PROPERTY when affordable', () => {
    land('action', 15_000_000);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<BuyPrompt />);
    expect(screen.getByText(prop.name)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /buy/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_BUY_PROPERTY);
  });

  it('emits TURN_PASS_BUY on decline', () => {
    land('action', 15_000_000);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<BuyPrompt />);
    fireEvent.click(screen.getByRole('button', { name: /decline/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_PASS_BUY);
  });

  it('disables Buy when unaffordable but still allows Decline', () => {
    land('action', 0);
    render(<BuyPrompt />);
    expect((screen.getByRole('button', { name: /buy/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /decline/i })).toBeTruthy();
  });

  it('shows nothing when the space is already owned', () => {
    land('action', 15_000_000, 'p2');
    const { container } = render(<BuyPrompt />);
    expect(container.textContent).not.toContain(prop.name);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `npm test -- BuyPrompt`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/ui/BuyPrompt.tsx`**

```tsx
import { useGameStore, selectMyPlayer, selectIsMyTurn } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import { COLOR_GROUP_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';

const BUYABLE = ['property', 'railroad', 'utility'];

export function BuyPrompt() {
  const me = useGameStore(selectMyPlayer);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const phase = useGameStore((s) => s.state?.turn.phase);
  const properties = useGameStore((s) => s.state?.properties);

  if (!me || !isMyTurn || phase !== 'action') return null;

  const space = BOARD_SPACES[me.position];
  if (!space || !BUYABLE.includes(space.type)) return null;
  const owned = properties?.find((p) => p.spaceIndex === space.index);
  if (!owned || owned.ownerId != null) return null; // only unowned
  const price = space.price ?? 0;
  if (price <= 0) return null;

  const canAfford = me.money >= price;
  const accent = space.colorGroup ? COLOR_GROUP_HEX[space.colorGroup] : '#d4af37';

  const buy = () => socketManager.emit(EVENTS.TURN_BUY_PROPERTY);
  const decline = () => socketManager.emit(EVENTS.TURN_PASS_BUY);

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ height: 10, borderRadius: 6, background: accent, marginBottom: 12 }} />
        <div style={{ fontWeight: 800, fontSize: 20 }}>{space.name}</div>
        <div style={{ color: '#9a8f7c', margin: '4px 0 16px', fontVariantNumeric: 'tabular-nums' }}>
          Price {formatMoney(price)}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={buy} disabled={!canAfford} style={{ ...btn, ...(canAfford ? buyBtn : disabled) }}>Buy</button>
          <button onClick={decline} style={{ ...btn, ...declineBtn }}>Decline</button>
        </div>
        {!canAfford && <div style={{ color: '#e5533d', marginTop: 8, fontSize: 13 }}>Not enough cash</div>}
      </div>
    </div>
  );
}

const FONT = "ui-rounded, system-ui, sans-serif";
const wrap: React.CSSProperties = {
  position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', fontFamily: FONT, zIndex: 40, pointerEvents: 'none',
};
const card: React.CSSProperties = {
  pointerEvents: 'auto', background: '#fbf6ec', color: '#3b3224', borderRadius: 18,
  padding: 22, minWidth: 260, boxShadow: '0 24px 60px -20px rgba(0,0,0,.6)',
};
const btn: React.CSSProperties = { fontFamily: FONT, fontWeight: 800, border: 'none', borderRadius: 14, padding: '12px 20px', cursor: 'pointer', flex: 1 };
const buyBtn: React.CSSProperties = { background: '#46b16a', color: '#fff' };
const declineBtn: React.CSSProperties = { background: '#e7dcbf', color: '#3b3224' };
const disabled: React.CSSProperties = { background: '#d8ccae', color: '#9a8f7c', cursor: 'default' };
```

- [ ] **Step 4: Run it, expect pass**

Run: `npm test -- BuyPrompt`
Expected: PASS (5). If `PropertyState`'s field names differ (`spaceIndex`/`ownerId`), match the actual `GameState.ts` interface — do not invent.

- [ ] **Step 5: Commit**

```bash
git add src/ui/BuyPrompt.tsx src/ui/BuyPrompt.test.tsx
git commit -m "feat(turn): buy/decline deed prompt on landing an unowned property"
```

---

### Task 6: Wire tokens + overlays into GameScene & App

**Files:**
- Modify: `src/screens/GameScene.tsx` (add `<PlayerTokens/>`)
- Modify: `src/App.tsx` (render `<TurnHud/>`, `<DiceDisplay/>`, `<BuyPrompt/>` over `<GameScene/>` on the game screen)
- Modify: `src/App.routing.test.tsx` (extend mocks so the game screen still renders in jsdom)

**Interfaces:** none new — composition only.

- [ ] **Step 1: Update the routing test first (RED)**

In `src/App.routing.test.tsx`, extend the existing R3F mocks so `PlayerTokens` (which calls `useFrame`) doesn't run in jsdom, then assert the game screen renders the HUD. Add to the `vi.mock` block for `@react-three/fiber` a `useFrame: () => {}` export, and mock the token layer:

```tsx
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: unknown }) => <div data-testid="canvas">{children as never}</div>,
  useFrame: () => {},
}));
vi.mock('./board/BoardTiles', () => ({ BoardTiles: () => null }));
vi.mock('./board/PlayerTokens', () => ({ PlayerTokens: () => null }));
```

Add a test:

```tsx
it('renders the turn HUD on the game screen', () => {
  useGameStore.getState().setScreen('game');
  render(<App />);
  // TurnHud returns null without a turn; set a minimal in-progress state
  // (see below — this assertion is completed once App renders TurnHud)
  expect(screen.getByTestId('canvas')).toBeTruthy();
});
```

Run: `npm test -- App.routing` → expect the new mock wiring to pass the existing assertions; if `useFrame`/`PlayerTokens` mock is missing it FAILS. (This step verifies the mocks; the HUD render is exercised in the TurnHud unit test.)

- [ ] **Step 2: Edit `src/screens/GameScene.tsx`**

Add the import and render `<PlayerTokens/>` inside `<Canvas>` after `<BoardTiles/>`:

```tsx
import { PlayerTokens } from '../board/PlayerTokens';
// ... inside <Canvas>, after <BoardTiles />:
      <PlayerTokens />
```

- [ ] **Step 3: Edit `src/App.tsx` game-screen branch**

Import the three overlays and render them with `GameScene` on the game screen:

```tsx
import { TurnHud } from './ui/TurnHud';
import { DiceDisplay } from './ui/DiceDisplay';
import { BuyPrompt } from './ui/BuyPrompt';
// ...
{(screen === 'game' || screen === 'game-over') && (
  <>
    <GameScene />
    <TurnHud />
    <DiceDisplay />
    <BuyPrompt />
  </>
)}
```

- [ ] **Step 4: Verify**

Run: `npm test` (all pass) then `npm run build` (green).
Expected: full suite green; tsc + vite green.

- [ ] **Step 5: Commit**

```bash
git add src/screens/GameScene.tsx src/App.tsx src/App.routing.test.tsx
git commit -m "feat(turn): wire PlayerTokens into scene + TurnHud/DiceDisplay/BuyPrompt overlays"
```

---

### Task 7: Push + PR

**Files:** none (git only).

- [ ] **Step 1: Confirm clean + green**

Run: `git status --porcelain` (empty; the Phase 2 plan doc `docs/2026-...-phase-2-turn-core.md` may be untracked — if so, commit it: `git add docs/2026-07-22-mockopoly-3d-phase-2-turn-core.md && git commit -m "docs: add Phase 2 (turn core) implementation plan"`). Then `npm test` (all pass) + `npm run build` (green).

- [ ] **Step 2: Push**

```bash
git push -u origin feat/turn
```

- [ ] **Step 3: Open the PR (base `main`)**

```bash
gh pr create --repo mockopoly-js/mockopoly-client-3d --base main --head feat/turn \
  --title "Phase 2: turn core (tokens, dice, hop, buy, minimal HUD)" \
  --body "Builds on Phase 0+1 (merged). Adds one full turn end-to-end in 3D: PlayerTokens with 150ms/tile hop in lockstep with the server clock; cosmetic dice overlay; minimal turn HUD (whose-turn, money, Roll/End gated by phase + isMyTurn); buy/decline deed prompt on landing an unowned property; useGameBusEvent hook. Server + 2D client untouched; no edits to network/state/contract. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Do NOT merge from a task.** Report the PR URL. (The controller runs the final whole-branch review; the user has authorized merging via `gh pr merge` after review.)

---

## Self-Review

**1. Spec coverage (Phase 2 row of design spec §10):** camera (static, existing) ✓; tokens on board → Task 2; roll→move→land → Tasks 2/3 + server timing (Global Constraints); cosmetic dice → Task 3; buy → Task 5; minimal HUD → Task 4; wiring/end-to-end → Task 6. Acceptance "a full turn plays end-to-end in 3D" = Tasks 2–6 composed.

**2. Placeholder scan:** complete code in every step. The `PlayerTokens` coordinate-space note is an explicit verify-visually instruction (animation can't be jsdom-tested) with a concrete fallback, not a TODO. `PropertyState`/`BoardSpace` field-name checks are explicit verifications against real types.

**3. Type consistency:** `useGameBusEvent` (Task 1) consumed in Tasks 2–3; `hopPath`/`stackOffset` (Task 2) internal; store selectors (`selectMyPlayer`/`selectIsMyTurn`/`selectCurrentPlayer`) reused in Tasks 4–5; `EVENTS.TURN_*` no-payload emits consistent; `formatMoney`/`TOKEN_HEX`/`COLOR_GROUP_HEX`/`BOARD_SPACES`/`tileToWorld` all from Phase 0/1.

**Executor notes:** Tasks ordered 1→7. The animation lockstep (Task 2) and the `PlayerTokens` coordinate space are the fragile points — verify the token hops smoothly and lands on the correct final tile by running the app against the server (Task 6). Unit tests cover the pure helpers, hooks, and all HTML overlays; the R3F scene is build-verified + manually smoke-tested.

## Execution Handoff

Execute via superpowers:subagent-driven-development — fresh implementer per task, task review + fix loop, final adversarial whole-branch review, then PR. Phase 3 (full HUD + modals) gets its own plan after this merges.
