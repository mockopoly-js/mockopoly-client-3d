# Mockopoly 3D — Phase 3b (DevHacks + Mortgage/Build modals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Two self-contained modals over the game HUD — a DevHacks panel (six cheat toggles) and a Mortgage/Build panel (mortgage/lift + buy/sell houses & hotels for a selected property) — plus wiring them into App, opening Mortgage from the property list, and moving ToastLayer to the App top level (closing the Phase 3a residual where off-game-screen toasts weren't trimmed).

**Architecture:** HTML overlays reading `store.state.*` snapshot, emitting socket events; identity via `store.myPlayerId`. DevHacks opens via a global keyboard chord (App listener) toggling a new `showDevHacks` store flag. Mortgage/Build opens by clicking a PropertyListPanel row (existing `selectProperty`/`selectedPropertyIndex`), closes via `selectProperty(null)`. Server is authoritative on build/mortgage legality; the client gates the obvious cases and surfaces server `ERROR` via the (now top-level) ToastLayer.

**Tech Stack:** React 18, zustand, Vitest + @testing-library/react. No new deps. No R3F/network/contract edits.

## Global Constraints

- **Server + 2D client untouched.** Build on `main` (Phase 3a merged, tip `d6ccc21`).
- **Do NOT edit** `src/network/*`, `src/types/*`, `src/constants/*`, `src/board/*`, or the P2 turn components. Additive UI + minimal `gameStore` (add `showDevHacks` + `toggleDevHacks`; `reset()` clears it) + App composition. Mortgage reuses the EXISTING `selectedPropertyIndex`/`selectProperty` (no new flag). PropertyListPanel gets an `onClick` on rows (additive).
- **Identity:** `store.myPlayerId` only.
- **Events (verbatim, all `{ spaceIndex }` unless noted):** `EVENTS.MORTGAGE_APPLY`, `EVENTS.MORTGAGE_LIFT`, `EVENTS.BUILD_BUY_HOUSE`, `EVENTS.BUILD_SELL_HOUSE`, `EVENTS.BUILD_BUY_HOTEL`, `EVENTS.BUILD_SELL_HOTEL`; `EVENTS.DEV_SET_HACK` `{ hack: keyof DevHacks, enabled: boolean }`. Emit via `socketManager.emit(EVENTS.X, payload)`.
- **Data:** `PropertyState { spaceIndex, ownerId:string|null, houses:0-4, hasHotel, isMortgaged }`; `BoardSpace { index, type, name, colorGroup?, price?, houseCost?, mortgageValue? }`; `DevHacks { unlimitedMoney, soloPlay, alwaysLandOnMayfair, alwaysLandOnCard, sameTurn, preAssignProperties }` (all boolean); `COLOR_GROUPS: Record<string, number[]>` + `PURCHASABLE_SPACES` from `../constants/board`; `state.devHacks`, `state.turn.currentPlayerId`, `state.players`, `state.properties`.
- **Server-authoritative legality:** the client gates obvious cases (ownership, houses<4, isMortgaged, my-turn, affordability); it need NOT enforce the even-build rule or full-group nuance — the server rejects illegal actions and emits `ERROR` (now shown by ToastLayer). Do not block on rules the server owns.
- **Style tokens:** panel `#12121e`, text `#e8e8f0`, muted `#8888a0`, gold `#d4af37`, border `#2a2a40`; `COLOR_GROUP_HEX`, `TOKEN_HEX`, `formatMoney`; font `"ui-rounded, system-ui, sans-serif"`; modal wrap `zIndex 40`.
- **jest-dom NOT installed:** `(el as HTMLButtonElement).disabled` / `getByText` / `queryByText`; `act()` for store mutations.
- **Git:** branch `feat/hud-modals` OFF `main`; `gh` + `git@personal:`; PR only (base `main`); no direct pushes/merges to protected branches; clean tree after each commit; no `.superpowers/`.

**Working directory:** `/Users/arslan/Desktop/Monopoly/mockopoly-client-3d`.

---

### Task 1: Branch + gameStore `showDevHacks`

**Files:** Modify `src/state/gameStore.ts`; Test `src/state/gameStore.test.ts` (append).

**Interfaces:** Produces `showDevHacks: boolean` (initial false) + `toggleDevHacks(show?: boolean)`; `reset()` sets `showDevHacks: false`.

- [ ] **Step 1: Branch**

```bash
cd /Users/arslan/Desktop/Monopoly/mockopoly-client-3d
git checkout main && git pull origin main
git checkout -b feat/hud-modals
```

- [ ] **Step 2: Append failing test to `src/state/gameStore.test.ts`**

```ts
  it('toggles the dev-hacks panel and reset closes it', () => {
    expect(useGameStore.getState().showDevHacks).toBe(false);
    useGameStore.getState().toggleDevHacks(true);
    expect(useGameStore.getState().showDevHacks).toBe(true);
    useGameStore.getState().toggleDevHacks();       // flips → false
    expect(useGameStore.getState().showDevHacks).toBe(false);
    useGameStore.getState().toggleDevHacks(true);
    useGameStore.getState().reset();
    expect(useGameStore.getState().showDevHacks).toBe(false);
  });
```

- [ ] **Step 3: Run, expect fail** — `npm test -- gameStore`.

- [ ] **Step 4: Edit `src/state/gameStore.ts`** — add to the interface: `showDevHacks: boolean;` and `toggleDevHacks: (show?: boolean) => void;`. Initial state: `showDevHacks: false,`. Action (near the other toggles): `toggleDevHacks: (show) => set((s) => ({ showDevHacks: show ?? !s.showDevHacks })),`. In `reset()` patch add `showDevHacks: false`.

- [ ] **Step 5: Run, expect pass** — `npm test -- gameStore`; then full `npm test`.

- [ ] **Step 6: Commit**

```bash
git add src/state/gameStore.ts src/state/gameStore.test.ts
git commit -m "feat(modals): gameStore showDevHacks flag"
```

---

### Task 2: DevHacksPanel

**Files:** Create `src/ui/DevHacksPanel.tsx`; Test `src/ui/DevHacksPanel.test.tsx`.

**Interfaces:** Consumes `useGameStore` (`showDevHacks`, `toggleDevHacks`, `state.devHacks`), `socketManager`, `EVENTS`, `DevHacks`. Produces `<DevHacksPanel />` — six labelled toggles; null when `!showDevHacks`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/DevHacksPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DevHacksPanel } from './DevHacksPanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function setDevHacks(devHacks: Partial<Record<string, boolean>>) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress', players: [], turn: { currentPlayerId: null },
    config: { maxPlayers: 4 }, properties: [],
    devHacks: { unlimitedMoney: false, soloPlay: false, alwaysLandOnMayfair: false, alwaysLandOnCard: false, sameTurn: false, preAssignProperties: false, ...devHacks },
  } as unknown as GameState);
}

describe('DevHacksPanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('renders nothing when closed', () => {
    setDevHacks({});
    const { container } = render(<DevHacksPanel />);
    expect(container.firstChild).toBe(null);
  });

  it('shows six toggles when open and emits DEV_SET_HACK on toggle', () => {
    setDevHacks({});
    useGameStore.getState().toggleDevHacks(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<DevHacksPanel />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    fireEvent.click(screen.getByLabelText(/1-player game start/i)); // soloPlay
    expect(emit).toHaveBeenCalledWith(EVENTS.DEV_SET_HACK, { hack: 'soloPlay', enabled: true });
  });

  it('reflects current devHacks state', () => {
    setDevHacks({ unlimitedMoney: true });
    useGameStore.getState().toggleDevHacks(true);
    render(<DevHacksPanel />);
    expect((screen.getByLabelText(/999m/i) as HTMLInputElement).checked).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect fail** — `npm test -- DevHacksPanel`.

- [ ] **Step 3: Implement `src/ui/DevHacksPanel.tsx`**

```tsx
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { DevHacks } from '../types/GameState';

const HACKS: { key: keyof DevHacks; label: string }[] = [
  { key: 'unlimitedMoney', label: 'Set all players to £999M' },
  { key: 'soloPlay', label: 'Allow 1-player game start' },
  { key: 'alwaysLandOnMayfair', label: 'Override movement to position 39' },
  { key: 'alwaysLandOnCard', label: 'Cycle Chance / Community Chest spaces' },
  { key: 'sameTurn', label: 'Never advance to next player' },
  { key: 'preAssignProperties', label: 'Give test properties on game start' },
];

export function DevHacksPanel() {
  const open = useGameStore((s) => s.showDevHacks);
  const toggleDevHacks = useGameStore((s) => s.toggleDevHacks);
  const devHacks = useGameStore((s) => s.state?.devHacks);
  if (!open) return null;

  const set = (key: keyof DevHacks, enabled: boolean) =>
    socketManager.emit(EVENTS.DEV_SET_HACK, { hack: key, enabled });

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={hdr}>
          <span>Dev Hacks</span>
          <button onClick={() => toggleDevHacks(false)} aria-label="Close" style={x}>×</button>
        </div>
        {HACKS.map(({ key, label }) => (
          <label key={key} style={rowStyle}>
            <input
              type="checkbox"
              checked={!!devHacks?.[key]}
              onChange={(e) => set(key, e.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
        <div style={foot}>Changes apply immediately to the current game.</div>
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: 'ui-rounded, system-ui, sans-serif' };
const card: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: 16, padding: 20, width: 340, boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)' };
const hdr: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 800, fontSize: 18, marginBottom: 14 };
const x: React.CSSProperties = { background: 'none', border: 'none', color: '#8888a0', fontSize: 22, cursor: 'pointer', lineHeight: 1 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', fontSize: 14, cursor: 'pointer' };
const foot: React.CSSProperties = { marginTop: 12, fontSize: 12, color: '#8888a0' };
```

- [ ] **Step 4: Run, expect pass** — `npm test -- DevHacksPanel` (3). Then full `npm test`. (`getByLabelText` matches the `<label>` text wrapping each checkbox.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/DevHacksPanel.tsx src/ui/DevHacksPanel.test.tsx
git commit -m "feat(modals): DevHacksPanel (six toggles → DEV_SET_HACK)"
```

---

### Task 3: MortgagePanel (+ build)

**Files:** Create `src/ui/MortgagePanel.tsx`; Test `src/ui/MortgagePanel.test.tsx`.

**Interfaces:** Consumes `useGameStore` (`selectedPropertyIndex`, `selectProperty`, `state.properties`, `state.players`, `state.turn.currentPlayerId`, `myPlayerId`), `BOARD_SPACES`, `COLOR_GROUP_HEX`, `socketManager`, `EVENTS`, `formatMoney`. Produces `<MortgagePanel />` — manages the selected property (mortgage/lift, build/sell houses & hotels); null when `selectedPropertyIndex == null`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/MortgagePanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MortgagePanel } from './MortgagePanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import type { GameState } from '../types/GameState';

const prop = BOARD_SPACES.find((s) => s.type === 'property' && (s.houseCost ?? 0) > 0)!;

function setState(over: { houses?: number; hasHotel?: boolean; isMortgaged?: boolean; ownerId?: string | null; money?: number } = {}) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money: over.money ?? 15_000_000 }],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 },
    properties: [{ spaceIndex: prop.index, ownerId: over.ownerId ?? 'p1', houses: over.houses ?? 0, hasHotel: over.hasHotel ?? false, isMortgaged: over.isMortgaged ?? false }],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
  useGameStore.getState().selectProperty(prop.index);
}

describe('MortgagePanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('renders nothing when no property is selected', () => {
    const { container } = render(<MortgagePanel />);
    expect(container.firstChild).toBe(null);
  });

  it('shows the selected property and mortgages it', () => {
    setState({});
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<MortgagePanel />);
    expect(screen.getByText(prop.name)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^mortgage$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.MORTGAGE_APPLY, { spaceIndex: prop.index });
  });

  it('buys a house and emits BUILD_BUY_HOUSE', () => {
    setState({ houses: 1 });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<MortgagePanel />);
    fireEvent.click(screen.getByRole('button', { name: /buy house/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.BUILD_BUY_HOUSE, { spaceIndex: prop.index });
  });

  it('lift is enabled only when mortgaged; mortgage disabled when mortgaged', () => {
    setState({ isMortgaged: true });
    render(<MortgagePanel />);
    expect((screen.getByRole('button', { name: /^mortgage$/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /unmortgage/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('closes via the X (clears selection)', () => {
    setState({});
    render(<MortgagePanel />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(useGameStore.getState().selectedPropertyIndex).toBe(null);
  });
});
```

- [ ] **Step 2: Run, expect fail** — `npm test -- MortgagePanel`.

- [ ] **Step 3: Implement `src/ui/MortgagePanel.tsx`**

```tsx
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import { COLOR_GROUP_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';

export function MortgagePanel() {
  const idx = useGameStore((s) => s.selectedPropertyIndex);
  const selectProperty = useGameStore((s) => s.selectProperty);
  const properties = useGameStore((s) => s.state?.properties);
  const players = useGameStore((s) => s.state?.players);
  const currentId = useGameStore((s) => s.state?.turn.currentPlayerId);
  const myId = useGameStore((s) => s.myPlayerId);

  if (idx == null) return null;
  const space = BOARD_SPACES[idx];
  const prop = properties?.find((p) => p.spaceIndex === idx);
  const me = players?.find((p) => p.id === myId);
  if (!space || !prop) return null;

  const mine = prop.ownerId === myId;
  const isMyTurn = currentId === myId;
  const canBuild = space.type === 'property'; // railroads/utilities can't build
  const houseCost = space.houseCost ?? 0;
  const accent = space.colorGroup ? COLOR_GROUP_HEX[space.colorGroup] : '#555570';

  const emit = (ev: string) => socketManager.emit(ev, { spaceIndex: idx });

  const canMortgage = mine && !prop.isMortgaged && prop.houses === 0 && !prop.hasHotel;
  const canLift = mine && prop.isMortgaged;
  const canBuyHouse = mine && isMyTurn && canBuild && !prop.isMortgaged && !prop.hasHotel && prop.houses < 4 && (me?.money ?? 0) >= houseCost;
  const canBuyHotel = mine && isMyTurn && canBuild && !prop.isMortgaged && prop.houses === 4 && !prop.hasHotel && (me?.money ?? 0) >= houseCost;
  const canSellHouse = mine && canBuild && prop.houses > 0 && !prop.hasHotel;
  const canSellHotel = mine && canBuild && prop.hasHotel;

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={hdr}>
          <span style={{ ...strip, background: accent }} />
          <span style={{ flex: 1, fontWeight: 800, fontSize: 18 }}>{space.name}</span>
          <button onClick={() => selectProperty(null)} aria-label="Close" style={x}>×</button>
        </div>
        <div style={meta}>
          {prop.hasHotel ? 'Hotel' : `${prop.houses} house${prop.houses === 1 ? '' : 's'}`}
          {prop.isMortgaged && ' · Mortgaged'}
          {houseCost > 0 && ` · House ${formatMoney(houseCost)}`}
        </div>
        {!mine && <div style={{ color: '#8888a0', fontSize: 13 }}>You do not own this property.</div>}
        {mine && (
          <div style={grid}>
            <button style={btn} disabled={!canMortgage} onClick={() => emit(EVENTS.MORTGAGE_APPLY)}>Mortgage</button>
            <button style={btn} disabled={!canLift} onClick={() => emit(EVENTS.MORTGAGE_LIFT)}>Unmortgage</button>
            {canBuild && <>
              <button style={btn} disabled={!canBuyHouse} onClick={() => emit(EVENTS.BUILD_BUY_HOUSE)}>Buy House</button>
              <button style={btn} disabled={!canSellHouse} onClick={() => emit(EVENTS.BUILD_SELL_HOUSE)}>Sell House</button>
              <button style={btn} disabled={!canBuyHotel} onClick={() => emit(EVENTS.BUILD_BUY_HOTEL)}>Buy Hotel</button>
              <button style={btn} disabled={!canSellHotel} onClick={() => emit(EVENTS.BUILD_SELL_HOTEL)}>Sell Hotel</button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: 'ui-rounded, system-ui, sans-serif' };
const card: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: 16, padding: 20, width: 340, boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)' };
const hdr: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 };
const strip: React.CSSProperties = { width: 14, height: 14, borderRadius: 4 };
const x: React.CSSProperties = { background: 'none', border: 'none', color: '#8888a0', fontSize: 22, cursor: 'pointer', lineHeight: 1 };
const meta: React.CSSProperties = { color: '#8888a0', fontSize: 13, marginBottom: 16 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const btn: React.CSSProperties = { fontFamily: 'inherit', fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 12, padding: '11px 12px', cursor: 'pointer', background: '#2a2a40', color: '#e8e8f0' };
```

Note: disabled buttons keep the same base style (browser dims via `:disabled` is not applied to inline styles; that's fine — the `disabled` attribute still blocks clicks. Optional: dim in a follow-up). Server rejects any action the client over-enabled and the ERROR toast surfaces it.

- [ ] **Step 4: Run, expect pass** — `npm test -- MortgagePanel` (5). Then full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/MortgagePanel.tsx src/ui/MortgagePanel.test.tsx
git commit -m "feat(modals): MortgagePanel — mortgage/lift + build/sell houses & hotels"
```

---

### Task 4: Wire into App (+ ToastLayer top-level, property-row open, devhacks keybind)

**Files:** Modify `src/App.tsx`, `src/ui/PropertyListPanel.tsx`; Test `src/App.routing.test.tsx`.

- [ ] **Step 1: Update `src/App.routing.test.tsx`** — extend the game-screen assertions or add a test that (a) the devhacks chord opens the panel and (b) selecting a property opens the mortgage panel. Add:

```tsx
it('opens DevHacksPanel via the keyboard chord on the game screen', () => {
  useGameStore.getState().setScreen('game');
  render(<App />);
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', metaKey: true, shiftKey: true, altKey: true }));
  });
  expect(useGameStore.getState().showDevHacks).toBe(true);
});
```

(Import `act` from `@testing-library/react` if not already. Keep existing mocks; ensure the store is reset in `beforeEach`.)

Run: `npm test -- App.routing` → the new test FAILS (no keybind yet).

- [ ] **Step 2: Edit `src/App.tsx`**

Imports: `DevHacksPanel`, `MortgagePanel` from `./ui/...`. Add a global keydown effect for the DevHacks chord:

```tsx
  const toggleDevHacks = useGameStore((s) => s.toggleDevHacks);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleDevHacks();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleDevHacks]);
```

In the `screen === 'game'` branch, add `<MortgagePanel />` and `<DevHacksPanel />` (after the HUD panels). **Move `<ToastLayer />` out of the game branch to the top-level fragment** (next to `<ConnectionStatus/>`), so toasts render + auto-expire on ALL screens (closing the Phase 3a residual). Remove `<ToastLayer/>` from the game branch.

- [ ] **Step 3: Edit `src/ui/PropertyListPanel.tsx`** — make each row clickable to open the mortgage panel: add `onClick={() => selectProperty(p.spaceIndex)}` and `cursor: 'pointer'` to the row (pull `selectProperty` from the store). This is additive; existing tests still pass (they don't assert click).

- [ ] **Step 4: Verify** — `npm test -- App.routing` (pass), full `npm test` (all pass), `npm run build` (green).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/ui/PropertyListPanel.tsx src/App.routing.test.tsx
git commit -m "feat(modals): wire DevHacks/Mortgage panels, top-level ToastLayer, property-row open"
```

---

### Task 5: Push + PR

- [ ] **Step 1:** If plan doc `docs/2026-07-22-mockopoly-3d-phase-3b-modals.md` is untracked, commit it (`git add … && git commit -m "docs: add Phase 3b plan"`). Then `git status --porcelain` (empty), `npm test` (all pass), `npm run build` (green).
- [ ] **Step 2:** `git push -u origin feat/hud-modals`
- [ ] **Step 3:** `gh pr create --repo mockopoly-js/mockopoly-client-3d --base main --head feat/hud-modals --title "Phase 3b: DevHacks + Mortgage/build modals" --body "Adds the DevHacks panel (six cheat toggles → DEV_SET_HACK, keyboard chord) and the Mortgage/Build panel (mortgage/lift + buy/sell houses & hotels, opened from the property list). Moves ToastLayer to App top-level so toasts render+expire on all screens (closes the 3a residual). Additive; no network/contract/board edits. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"`
- [ ] **Step 4:** Do NOT merge from a task. Report the PR URL.

---

## Self-Review

**Spec coverage (Phase 3 §10, modal subset):** DevHacks modal → Tasks 1-2; Mortgage + build → Task 3; wiring + toast fix → Task 4. Trade/partnership/deal → 3c (out of scope here).

**Placeholder scan:** complete code in every step. Server-authoritative-legality note is an explicit design decision, not a TODO.

**Type consistency:** `showDevHacks`/`toggleDevHacks` (Task 1) consumed in Task 2 + Task 4; MortgagePanel reuses `selectedPropertyIndex`/`selectProperty`; event constants + `{spaceIndex}`/`{hack,enabled}` payloads match the contract.

**Executor notes:** all plain-HTML components (unit-testable). Task 4 is App composition (build-verified + routing test). Tasks ordered 1→5.

## Execution Handoff

Execute via superpowers:subagent-driven-development — fresh implementer per task, task review + fix loop, final whole-branch review, PR, merge. Phase 3c (Trade + Partnership + RentDeal/Negotiation) follows.
