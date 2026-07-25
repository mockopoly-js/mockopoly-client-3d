# Mockopoly 3D — Phase 6: Mobile & Performance Implementation Plan

> **For agentic workers:** executed via superpowers:subagent-driven-development — fresh implementer per task, review between tasks, final whole-branch review, merge via PR.

**Goal:** Make the game load fast and play well on phones — code-split the monolithic bundle, cap render cost on high-DPR devices, and make the HUD + camera usable on small touch screens.

**Architecture:** (1) Lazy-load the 3D `GameScene` with `React.lazy` so the entire three/drei/postprocessing stack (~350KB+) leaves the initial bundle and only loads when a game starts; add vendor `manualChunks` for cache stability. (2) Cap the Canvas device-pixel-ratio and add adaptive perf props so high-DPR phones don't render at 3×. (3) Add a `useIsMobile` media-query hook and a responsive pass over the HUD (inline-style components today, no breakpoints): a bottom action bar, compact player pods, and full-width bottom-sheet modals on small screens, plus `touch-action`/overscroll CSS so the canvas gestures don't scroll/zoom the page.

**Tech Stack:** Vite 5 (`build.rollupOptions.output.manualChunks`), React 18 `lazy`/`Suspense`, R3F `Canvas` `dpr`/`performance` props, `window.matchMedia`, inline-style components. No new deps.

## Global Constraints

- Branch: `feat/phase-6` off `main` (69b79de).
- Do NOT touch `src/network/*`, `src/types/*`, `src/state/*`, the server, or the 2D client. Vendored contract byte-verbatim.
- Do NOT regress gameplay: dice/token animation, camera, sound, all modals must still work on desktop exactly as now. Preserve token hop lockstep.
- No new runtime dependencies. No external network (CDN/HDRI/fonts).
- Keep `npm run build` green and existing 125 tests passing at every task; add real tests for the pure `useIsMobile` logic where feasible (matchMedia is mockable in jsdom).
- Do NOT push/PR until the final task. Merge via `gh pr merge` (personal SSH, NO `--admin`).
- Measure the bundle before/after Task 1 (report the chunk table) — the code-split must demonstrably shrink the INITIAL (entry) chunk.

## File Structure

- `vite.config.ts` — MODIFY. Add `build.rollupOptions.output.manualChunks` splitting `three`, `@react-three/*`, `postprocessing`, `react`/`react-dom`, `socket.io-client` into named vendor chunks. Optionally bump `build.chunkSizeWarningLimit`.
- `src/App.tsx` — MODIFY. `const GameScene = lazy(() => import('./screens/GameScene').then(m => ({ default: m.GameScene })))`; wrap the `screen==='game'` GameScene render in `<Suspense fallback={<LoadingScreen/>}>`. Keep the HUD overlays as-is (they're light and needed immediately).
- `src/screens/GameScene.tsx` — MODIFY. Add `dpr={[1, 2]}` (cap at 2×), `performance={{ min: 0.5 }}`, and `gl={{ powerPreference: 'high-performance' }}` to the `<Canvas>`. No scene-graph changes.
- `src/ui/LoadingScreen.tsx` — CREATE. Tiny full-screen branded loading fallback (spinner/text) shown while the 3D chunk loads.
- `src/ui/useIsMobile.ts` — CREATE. `useIsMobile(breakpoint=768): boolean` via `window.matchMedia(`(max-width: ${bp}px)`)`, SSR/jsdom-safe (guard `window`/`matchMedia` absence, subscribe/unsubscribe to change events).
- `src/ui/useIsMobile.test.ts` — CREATE. Mock matchMedia; assert it returns the match state and updates on change; safe when matchMedia is absent.
- `src/index.css` — MODIFY. Add `#root, canvas { touch-action: none; }` (canvas owns gestures), `html, body { overscroll-behavior: none; -webkit-text-size-adjust: 100%; }` to stop pull-to-refresh / page pinch-zoom / text inflation on mobile. Keep existing rules.
- HUD components (`src/ui/TurnHud.tsx`, `HudButtons.tsx`, `PlayerPods.tsx`, `PropertyListPanel.tsx`, `GameLog.tsx`, and the modal panels `MortgagePanel/TradePanel/PartnershipPanel/DealPanel/BuyPrompt`) — MODIFY as needed for the responsive pass (Task 2). Use `useIsMobile()` to switch layout, not a rewrite.

---

## Task 1 (Penny): Code-split + Canvas perf

**Files:** modify `vite.config.ts`, `src/App.tsx`, `src/screens/GameScene.tsx`; create `src/ui/LoadingScreen.tsx`. First step: `git checkout main && git pull origin main && git checkout -b feat/phase-6`.

**Steps:**
1. Record the CURRENT bundle: `npm run build`, capture the chunk table (entry JS size + gzip).
2. `vite.config.ts`: add
   ```ts
   build: {
     chunkSizeWarningLimit: 1200,
     rollupOptions: { output: { manualChunks: {
       'vendor-three': ['three'],
       'vendor-r3f': ['@react-three/fiber', '@react-three/drei'],
       'vendor-postprocessing': ['@react-three/postprocessing', 'postprocessing'],
       'vendor-react': ['react', 'react-dom'],
       'vendor-net': ['socket.io-client'],
     } } },
   }
   ```
   (Keep the existing `plugins`/`server`.)
3. `src/App.tsx`: convert `GameScene` to a lazy import (`lazy` + the named-export `.then` shim). Wrap ONLY the `<GameScene/>` in the `screen==='game'` branch with `<Suspense fallback={<LoadingScreen/>}>` (the HUD overlays stay eager — they're small and must appear immediately). Remove the static `import { GameScene }`.
4. `src/ui/LoadingScreen.tsx`: a fixed full-screen dark panel with a simple CSS spinner + "Loading…" (inline styles, on-brand `#08080f`/gold). No external assets.
5. `src/screens/GameScene.tsx`: add `dpr={[1, 2]}`, `performance={{ min: 0.5 }}`, `gl={{ powerPreference: 'high-performance' }}` to `<Canvas>`. Nothing else.
6. `npm run build` again: confirm the ENTRY chunk shrank (three/drei/postprocessing now in a separate async chunk loaded on game start) and report the new table. Confirm the app still boots (menu/lobby load without the 3D chunk).
7. `npm test` green (125). If the App routing test renders the game screen, ensure the lazy GameScene + Suspense are handled (the existing `vi.mock` of GameScene internals should still apply; if App now lazy-imports GameScene, mock `./screens/GameScene` at the module level in that test so Suspense resolves synchronously).

**Verification:** before/after chunk tables (entry chunk must drop by roughly the three+drei+postprocessing weight); build green; 125 tests green; commit on `feat/phase-6`.

---

## Task 2 (Penny): Mobile responsive HUD + touch

**Files:** create `src/ui/useIsMobile.ts`, `src/ui/useIsMobile.test.ts`; modify `src/index.css` and the HUD components listed in File Structure as needed.

**Steps:**
1. `useIsMobile.ts` + test (see File Structure). jsdom-safe.
2. `index.css`: add the touch/overscroll rules (see File Structure). Verify the canvas still receives OrbitControls gestures (touch-action:none on canvas is correct — it hands all touch to the WebGL canvas / OrbitControls).
3. Responsive HUD pass using `useIsMobile()` — priorities (do the high-impact layout switches; keep desktop rendering identical when not mobile):
   - **Action controls** (`TurnHud` + `HudButtons`): on mobile, dock them as a full-width **bottom action bar** (thumb-reachable), larger tap targets (min ~44px), instead of their desktop placement.
   - **PlayerPods**: on mobile, compact to a slim top strip (smaller avatars/text) so they don't cover the board.
   - **PropertyListPanel + GameLog**: on mobile, these secondary panels should not crowd the board — collapse them (a toggle/drawer) or shrink + move to an edge; do not let them overlap the action bar.
   - **Modals** (`Mortgage/Trade/Partnership/Deal/BuyPrompt`): on mobile, render as full-width bottom sheets (`width:100vw`, pinned bottom, `maxHeight:~85vh`, scrollable) instead of centered fixed-width cards. They already use `maxWidth:92vw` — extend to a proper mobile sheet.
   - Keep all desktop layouts byte-for-behavior unchanged (guard every change behind `useIsMobile()`).
4. Do NOT change any game logic, store reads, or socket emits — layout/CSS only.

**Verification:** `npm run build` green; `npm test` green (125 + useIsMobile tests); desktop unchanged (spot-check a couple components render identically when `useIsMobile()===false`); commit. Visual/mobile behavior is user-gated live (resize / device emulation at :5174).

---

## Task 3 (Luna): Final whole-branch review + PR

**Steps:**
1. Confirm: lazy GameScene + Suspense/LoadingScreen; Canvas dpr/perf props; touch CSS; useIsMobile drives responsive layout; desktop unchanged; no gameplay/logic edits.
2. `npm run build` green (report final chunk table); full `npm test` green; app boots.
3. Controller dispatches the final whole-branch review (opus) over `main..HEAD`: entry-chunk actually shrank, lazy/Suspense correct (no white-screen if chunk slow, fallback shows), no forbidden edits, desktop layout not regressed, mobile guards correct, matchMedia cleanup no leak, no gameplay regression. Fix Critical/Important via one fix subagent.
4. Push `feat/phase-6`, PR base `main`, merge via `gh pr merge` (NO `--admin`).

## Self-Review notes
- Perf win is measurable (chunk table). Mobile UX is user-gated visually.
- Deferred/optional future: per-player token preload (load only active players' glbs), GLB gzip/Draco, LOD, PWA/offline, landscape-lock. Not blocking the "usable on mobile + fast initial load" goal.
- KTX2 intentionally skipped: models use vertex colors, no textures.
