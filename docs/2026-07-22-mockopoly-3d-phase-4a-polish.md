# Mockopoly 3D — Phase 4a (Polish: big-moment overlays + postFX + token juice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The blind-buildable slice of Phase 4 polish: transient "big-moment" overlays (rent hit, jail, bankruptcy, free-parking) staged for the whole table; conservative postprocessing (bloom + tone mapping) + shadow/light tuning; and token arrival juice. Verified via build + unit tests + judgment (no live view). The feel-critical, asset-dependent items (rapier physics dice, auto-director camera, sound, HDRI-from-file, embedded font) are DEFERRED to a live-iteration session — see "Out of scope" below.

**Architecture:** BigMomentOverlay is an HTML overlay subscribing to gameBus relays via `useGameBusEvent`, reading player names from `store.state.players`; transient, auto-dismissing. PostFX is an R3F `<EffectComposer>` added to `GameScene`'s `<Canvas>`. Token juice extends the existing `PlayerTokens` `useFrame` hop with a subtle arrival scale-flash. All additive; no network/contract/board/state edits (store untouched).

**Tech Stack:** React 18, react-three-fiber + three, `@react-three/postprocessing` (NEW dep) + `postprocessing`, zustand, Vitest + @testing-library/react.

## Global Constraints

- **Server + 2D client untouched.** Build on `main` (Phase 3 merged, tip `c914a2a`).
- **Do NOT edit** `src/network/*`, `src/types/*`, `src/state/*` (store), `src/constants/*`. Additive: new `BigMomentOverlay`, edits to `GameScene.tsx` (postFX) + `PlayerTokens.tsx` (juice) + `App.tsx` (render overlay).
- **Identity:** `store.myPlayerId` only where relevant (overlay is table-wide, so mostly just names).
- **Big-moment gameBus events + payloads (verbatim):** `'rent-collected'` `{fromId,toId,amount,spaceIndex}` · `'jail-sent'` `{playerId}` · `'player-bankrupt'` `{playerId,creditorId}` · `'free-parking-collected'` `{playerId,amount}`. (`'game-over'` is already handled by GameOverScreen — the overlay must NOT handle it.)
- **PostFX defaults are conservative** (bloom low, tone mapping ACES) because they can't be visually verified blind. Values are tunable later; they must not blow out the scene. SSAO is OUT (heavier + needs tuning). Build-green (`npm run build`) is the acceptance for postFX + juice.
- **jest-dom NOT installed:** `getByText`/`queryByText`/`act()`; fake timers for auto-dismiss.
- **R3F components aren't jsdom-testable:** BigMomentOverlay (HTML) is unit-tested; GameScene/PlayerTokens changes are build-verified. The routing test must mock `@react-three/postprocessing` (see Task 4).
- **Out of scope (Phase 4b, do NOT attempt here):** rapier physics dice, auto-director/follow camera, sound/audio, HDRI environment from a file, real/embedded fonts, real Blender models. These need live visual iteration or asset files.
- **Git:** branch `feat/polish` OFF `main`; PR only (base `main`); no direct pushes/merges to protected; clean tree per commit; no `.superpowers/`.

**Working directory:** `/Users/arslan/Desktop/Monopoly/mockopoly-client-3d`.

---

### Task 1: BigMomentOverlay

**Files:** Create `src/ui/BigMomentOverlay.tsx`; Test `src/ui/BigMomentOverlay.test.tsx`.

**Interfaces:** Consumes `useGameBusEvent`, `useGameStore` (`state.players`), `formatMoney`. Produces `<BigMomentOverlay />` — a transient centered banner that appears on a big-moment gameBus event and auto-dismisses after ~2.6s.

- [ ] **Step 1: Branch**

```bash
cd /Users/arslan/Desktop/Monopoly/mockopoly-client-3d
git checkout main && git pull origin main
git checkout -b feat/polish
```

- [ ] **Step 2: Write the failing test**

Create `src/ui/BigMomentOverlay.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { BigMomentOverlay } from './BigMomentOverlay';
import { useGameStore } from '../state/gameStore';
import { gameBus } from '../state/gameBus';
import type { GameState } from '../types/GameState';

function players() {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red' }, { id: 'p2', name: 'Jonas', token: 'blue' }],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 }, properties: [],
  } as unknown as GameState);
}

describe('BigMomentOverlay', () => {
  beforeEach(() => { useGameStore.getState().reset(); players(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('shows nothing initially', () => {
    const { container } = render(<BigMomentOverlay />);
    expect(container.firstChild).toBe(null);
  });

  it('announces a rent hit with names + amount', () => {
    render(<BigMomentOverlay />);
    act(() => { gameBus.emit('rent-collected', { fromId: 'p2', toId: 'p1', amount: 2_400_000, spaceIndex: 6 }); });
    const t = screen.getByText(/jonas/i).textContent ?? '';
    expect(t).toMatch(/jonas/i); expect(t).toMatch(/maya/i); expect(t).toMatch(/2\.400M/);
  });

  it('announces jail and auto-dismisses', () => {
    render(<BigMomentOverlay />);
    act(() => { gameBus.emit('jail-sent', { playerId: 'p1' }); });
    expect(screen.getByText(/maya.*jail/i)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2800); });
    expect(screen.queryByText(/jail/i)).toBe(null);
  });

  it('announces bankruptcy', () => {
    render(<BigMomentOverlay />);
    act(() => { gameBus.emit('player-bankrupt', { playerId: 'p2', creditorId: 'p1' }); });
    expect(screen.getByText(/jonas.*bankrupt/i)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run, expect fail** — `npm test -- BigMomentOverlay`.

- [ ] **Step 4: Implement `src/ui/BigMomentOverlay.tsx`**

```tsx
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { useGameBusEvent } from '../state/useGameBus';
import { formatMoney } from '../utils/format';
import type { Player } from '../types/GameState';

interface Moment { text: string; tone: 'rent' | 'jail' | 'bankrupt' | 'parking'; id: number }
const TONE: Record<Moment['tone'], string> = { rent: '#e5533d', jail: '#e0a30a', bankrupt: '#c53a26', parking: '#46b16a' };

export function BigMomentOverlay() {
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const [moment, setMoment] = useState<Moment | null>(null);
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? 'A player';

  // stable id so repeated identical texts still re-key the animation
  const show = (text: string, tone: Moment['tone']) => setMoment({ text, tone, id: (moment?.id ?? 0) + 1 });

  useGameBusEvent('rent-collected', (d: { fromId: string; toId: string; amount: number }) =>
    show(`${name(d.fromId)} paid ${formatMoney(d.amount)} rent to ${name(d.toId)}`, 'rent'));
  useGameBusEvent('jail-sent', (d: { playerId: string }) => show(`${name(d.playerId)} → Jail!`, 'jail'));
  useGameBusEvent('player-bankrupt', (d: { playerId: string }) => show(`${name(d.playerId)} went bankrupt!`, 'bankrupt'));
  useGameBusEvent('free-parking-collected', (d: { playerId: string; amount: number }) =>
    show(`${name(d.playerId)} scooped ${formatMoney(d.amount)} from Free Parking!`, 'parking'));

  // auto-dismiss whenever a new moment arrives
  useGameBusEvent('__tick__', () => {}); // no-op placeholder to keep hook count stable if extended
  if (moment) setTimeoutOnce(moment.id, () => setMoment((m) => (m?.id === moment.id ? null : m)));

  if (!moment) return null;
  return (
    <div key={moment.id} style={{ ...wrap }}>
      <div style={{ ...banner, borderColor: TONE[moment.tone], color: TONE[moment.tone] }}>{moment.text}</div>
    </div>
  );
}

// one-shot timer per moment id (module-scoped so re-renders don't stack timers)
const fired = new Set<number>();
function setTimeoutOnce(id: number, fn: () => void) {
  if (fired.has(id)) return;
  fired.add(id);
  setTimeout(() => { fired.delete(id); fn(); }, 2600);
}

const wrap: React.CSSProperties = {
  position: 'fixed', top: '32%', left: '50%', transform: 'translateX(-50%)', zIndex: 50, pointerEvents: 'none',
  fontFamily: 'ui-rounded, system-ui, sans-serif',
};
const banner: React.CSSProperties = {
  background: '#12121e', border: '2px solid', borderRadius: 14, padding: '14px 26px',
  fontWeight: 800, fontSize: 20, textAlign: 'center', boxShadow: '0 20px 50px -16px rgba(0,0,0,.7)',
  fontVariantNumeric: 'tabular-nums', maxWidth: '80vw',
};
```

Note on the timer: the `setTimeoutOnce` module helper guarantees exactly one dismiss timer per moment id regardless of re-renders. Remove the `'__tick__'` placeholder line if it complicates — it is only there as a reminder that all `useGameBusEvent` hooks must be called unconditionally every render (they already are, above the `if (!moment)` return). **VERIFY: all four `useGameBusEvent` calls run before the `if (!moment) return null` early return** (they do in this layout). If the implementer prefers a cleaner dismiss, a `useEffect(() => { const t = setTimeout(...); return () => clearTimeout(t); }, [moment?.id])` is equally acceptable — keep the hook before the early return.

- [ ] **Step 5: Run, expect pass** — `npm test -- BigMomentOverlay` (4). Then full `npm test`. If the module-timer approach fights the fake-timer test, switch to the `useEffect`+`clearTimeout` dismiss keyed on `moment?.id` (hook before the early return) — that plays cleanly with `vi.advanceTimersByTime`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/BigMomentOverlay.tsx src/ui/BigMomentOverlay.test.tsx
git commit -m "feat(polish): BigMomentOverlay — transient rent/jail/bankruptcy/free-parking banners"
```

---

### Task 2: PostFX + lighting in GameScene

**Files:** Modify `src/screens/GameScene.tsx`; `package.json` (+ `@react-three/postprocessing`).

**Interfaces:** none new — additive to the scene.

- [ ] **Step 1: Install the dep**

```bash
npm install @react-three/postprocessing@^2.16.0 postprocessing@^6.36.0
```

(Compatible with three 0.169 / R3F 8. If npm resolves nearer compatible versions, accept them as long as `npm run build` passes.)

- [ ] **Step 2: Edit `src/screens/GameScene.tsx`** — add conservative postprocessing + better shadows. Inside the `<Canvas>` (after the scene contents), add:

```tsx
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
// ...inside <Canvas>, after <PlayerTokens />:
      <EffectComposer>
        <Bloom intensity={0.35} luminanceThreshold={0.9} luminanceSmoothing={0.3} mipmapBlur />
        <ToneMapping />
      </EffectComposer>
```

Tune the directional light for grounded shadows (adjust the existing `<directionalLight>`): add `shadow-mapSize={[1024, 1024]}` and a shadow camera frustum that covers the board, e.g.:

```tsx
      <directionalLight
        position={[6, 10, 6]} intensity={1.15} castShadow
        shadow-mapSize={[1024, 1024]}
      >
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
      </directionalLight>
```

Keep the ambient light + background. Do not change the camera position.

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: tsc + vite green (EffectComposer/Bloom typecheck; new dep bundles). Then `npm test` — all still pass (no unit test for the scene; the routing test may need the postprocessing mock — that's Task 4).

If the routing test (`App.routing.test.tsx`) fails now because GameScene imports `@react-three/postprocessing` and the mocked Canvas renders it, that mock is added in Task 4; you may temporarily see it — Task 4 fixes it. If you prefer, add the `vi.mock('@react-three/postprocessing', ...)` line now (see Task 4 Step 1) so the suite stays green.

- [ ] **Step 4: Commit**

```bash
git add src/screens/GameScene.tsx package.json package-lock.json
git commit -m "feat(polish): conservative bloom + tone mapping + shadow tuning"
```

---

### Task 3: Token arrival juice

**Files:** Modify `src/board/PlayerTokens.tsx`.

- [ ] **Step 1: Edit `src/board/PlayerTokens.tsx`** — add a subtle scale-flash as the token settles each hop, and a gentle squash tied to the vertical arc. In the `useFrame` hop branch, after setting `mesh.position`, drive `mesh.scale`:

```tsx
        // juice: squash toward the top of the arc, pop on arrival
        const arc = Math.sin(t * Math.PI);           // 0→1→0 over the hop
        const s = 1 + arc * 0.12;                     // stretch up mid-hop
        mesh.scale.set(1 + (1 - arc) * 0.06, s, 1 + (1 - arc) * 0.06);
```

In the reconcile (idle) branch, reset scale to 1:

```tsx
        mesh.scale.set(1, 1, 1);
```

Keep everything else (position lerp, hopPath queue, 150ms/tile lockstep, coordinate space) exactly as-is. This is purely a `scale` addition; timing/position unchanged.

- [ ] **Step 2: Build check** — `npm run build` (green), `npm test` (all pass; PlayerTokens has no unit test — build-verified). hopPath test still green.

- [ ] **Step 3: Commit**

```bash
git add src/board/PlayerTokens.tsx
git commit -m "feat(polish): token hop squash/stretch + arrival scale juice"
```

---

### Task 4: Wire BigMomentOverlay into App + routing test

**Files:** Modify `src/App.tsx`, `src/App.routing.test.tsx`.

- [ ] **Step 1: Mock `@react-three/postprocessing` in `src/App.routing.test.tsx`** — add alongside the existing R3F mocks so the stubbed Canvas doesn't try to render the effect components:

```tsx
vi.mock('@react-three/postprocessing', () => ({
  EffectComposer: () => null, Bloom: () => null, ToneMapping: () => null,
}));
```

Run `npm test -- App.routing` — should pass (existing tests) with the mock; if BigMomentOverlay isn't rendered yet the new assertion below fails.

- [ ] **Step 2: Add a routing test** — BigMomentOverlay renders on the game screen and shows a rent moment:

```tsx
it('shows a big-moment banner on the game screen', () => {
  useGameStore.getState().update({ roomCode: 'A', status: 'in-progress', players: [{ id: 'p1', name: 'Maya', token: 'red' }, { id: 'p2', name: 'Jonas', token: 'blue' }], turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 }, properties: [] } as any);
  useGameStore.getState().setScreen('game');
  render(<App />);
  act(() => { gameBus.emit('jail-sent', { playerId: 'p2' }); });
  expect(screen.getByText(/jonas.*jail/i)).toBeTruthy();
});
```

(Import `gameBus` + `act` in the test if not present.) Run → FAILS (App doesn't render BigMomentOverlay yet).

- [ ] **Step 3: Edit `src/App.tsx`** — import `BigMomentOverlay`; render it in the `screen==='game'` branch (after the other overlays). Keep all prior wiring intact.

- [ ] **Step 4: Verify** — `npm test -- App.routing` (pass), full `npm test` (all pass), `npm run build` (green).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.routing.test.tsx
git commit -m "feat(polish): render BigMomentOverlay on the game screen"
```

---

### Task 5: Push + PR

- [ ] **Step 1:** Commit the plan doc if untracked (`git add docs/2026-07-22-mockopoly-3d-phase-4a-polish.md && git commit -m "docs: add Phase 4a plan"`). `git status --porcelain` (empty), `npm test` (all pass), `npm run build` (green).
- [ ] **Step 2:** `git push -u origin feat/polish`
- [ ] **Step 3:** `gh pr create --repo mockopoly-js/mockopoly-client-3d --base main --head feat/polish --title "Phase 4a: big-moment overlays + postFX + token juice" --body "Blind-buildable polish slice. Adds: BigMomentOverlay (transient rent/jail/bankruptcy/free-parking banners, gameBus-driven, auto-dismiss); conservative bloom + ACES tone mapping + shadow tuning in GameScene; token hop squash/stretch + arrival juice. Additive; no network/contract/store/board edits. NOTE: postFX/juice values are conservative defaults verified by build only (not live) — tune with a live view. DEFERRED to a live-iteration session (Phase 4b): rapier physics dice, auto-director camera, sound, HDRI-from-file, embedded font. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"`
- [ ] **Step 4:** Do NOT merge from a task. Report the PR URL.

---

## Self-Review

**Spec coverage (Phase 4 subset, blind-buildable):** big-moment overlays → Task 1/4; postFX (bloom/tone map) + shadows → Task 2; token juice → Task 3. Explicitly deferred (feel/asset-dependent): physics dice, auto-camera, sound, HDRI file, font — listed in the PR body + ledger (not silently dropped).

**Placeholder scan:** complete code in each step. The BigMomentOverlay timer note offers a concrete `useEffect`+`clearTimeout` alternative (not a TODO); the routing-mock note is an explicit instruction.

**Type consistency:** gameBus payloads match the contract (`fromId/toId/amount`, `playerId`, etc.); `useGameBusEvent` reused; no store/contract edits.

**Executor notes:** BigMomentOverlay is unit-tested (fake timers); GameScene + PlayerTokens are build-verified only (R3F). postFX/juice values are conservative and tunable — build-green is the bar, visual tuning is a later live pass. All `useGameBusEvent` hooks must precede the early return.

## Execution Handoff

Execute via superpowers:subagent-driven-development. After merge, Phase 4b (physics dice, camera, sound, assets, font) should be done in a live-view session with visual iteration.
