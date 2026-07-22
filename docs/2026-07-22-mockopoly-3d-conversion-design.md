# Mockopoly 3D Conversion — Design Spec

**Date:** 2026-07-22
**Status:** Approved design, pre-implementation
**Owner:** Arslan (mockopoly-js org)

Companion documents:
- Architecture reference (2D system, fully mapped): https://claude.ai/code/artifact/8311afa5-fdcc-4f77-b6ce-cf4cc168f65d
- HUD / art-direction mockup (flat CSS prototype): https://claude.ai/code/artifact/3e8d6546-6bbe-4e8a-a3fa-6a290d5d8b3d
- Product strategy: `PRODUCT.md`
- Visual system (seed): `DESIGN.md`

---

## 1. Goal

Convert the existing 2D Phaser Mockopoly client into a full-fledged **3D game** that looks and feels like a hit casual mobile title (Monopoly GO / Rento family): a bright, low-poly **living toy-world** with the classic board at the center of an animated isometric city diorama.

**The single load-bearing fact:** the existing system is fully **server-authoritative** and the client is a **pure read-only mirror** (server snapshot → animate). Therefore this project is a **new client render layer only**. The server and all game logic are untouched.

Success = players say "this feels like a real game, not a website," it runs smoothly on phone and desktop, and a table of friends wants to keep playing.

## 2. Non-goals & hard constraints

- **No changes to `mockopoly-server`.** Zero. Same socket protocol, same URL.
- **No changes to the existing `mockopoly-client` (2D)** repo. It stays playable until the 3D client reaches parity, then is retired.
- **New standalone repo** `mockopoly-client-3d` in the **`mockopoly-js`** GitHub org.
- **Git rules (see `memory/git-workflow.md`):** all git via `gh` + the personal SSH key (`git@personal:` alias); **no direct pushes/merges** to `main`/`staging`/`dev`; integration **only via PRs**; Arslan merges via web.
- Not a website/dashboard, not the old dark-luxury 2D, not realistic/skeuomorphic, not gambling/casino (per `PRODUCT.md` anti-references).

## 3. Architecture

### 3.1 Repo & structure
New folder inside the workspace, own repo:
```
Monopoly/
├── mockopoly-server/        (untouched repo)
├── mockopoly-client/        (untouched 2D repo, stays live during migration)
└── mockopoly-client-3d/     (NEW repo → git@personal:mockopoly-js/mockopoly-client-3d.git)
```
`PRODUCT.md` and `DESIGN.md` (currently at workspace root) move into `mockopoly-client-3d/` during Phase 0. The architecture reference + this spec live under `mockopoly-client-3d/docs/`.

### 3.2 Stack
- **React 18 + Vite 5 + TypeScript 5** (matches the 2D client's tooling; Node 25 / npm 11 confirmed on the dev machine).
- **react-three-fiber** (declarative Three.js) — the 3D scene.
- **@react-three/drei** — camera controls, glTF loaders, `Html`, `Environment`, helpers.
- **@react-three/rapier** — physics dice.
- **@react-three/postprocessing** — bloom / SSAO / tone mapping.
- **zustand** — the game store (replaces the Phaser-EventEmitter state mirror).
- **socket.io-client ^4.7** — same major/minor as the server.
- **@react-spring/three** — declarative animation/tween springs.
- glTF assets: Draco/meshopt compressed; KTX2 textures; local decoder for mobile.

### 3.3 Copy the non-render stack, rebuild only render
Copy from the 2D client (approved), logic unchanged:
- `types/GameState.ts`, `types/SocketEvents.ts` — the wire contract.
- `network/SocketManager.ts`, `network/GameStateSync.ts` — socket layer.
- `utils/format.ts` — money formatting (£ scale).
- Port `Board.ts`'s tile-index → position map (adapted from 2D pixel coords to 3D world coords).

**The single seam where Phaser dies:** the 2D `LocalGameState extends Phaser.EventEmitter`. In the 3D client it becomes a **zustand store** (`useGameStore`). `GameStateSync` writes to the store instead of emitting Phaser events. `UIState` folds into the same store (or a sibling UI store).

### 3.4 Data flow (unidirectional — unchanged model)
```
server ──socket──▶ SocketManager ──▶ GameStateSync ──▶ zustand store
                                                          │ (reactive)
                        ┌─────────────────────────────────┴───────────┐
                        ▼                                              ▼
                 <Canvas> R3F 3D scene                        React HUD (DOM)
                 (board, tokens, dice, city)                  (pods, rail, feed, modals)
                        │                                              │
                        └──────── user action ──▶ socket.emit ─────────┘
```
The client never invents state; it animates authoritative snapshots. React diffs the store into the scene automatically (replacing Phaser's manual "on `player-moved` → tween" wiring).

### 3.5 Contract sync
The contract (`types/GameState.ts` + `types/SocketEvents.ts`, ~514 lines) is **vendored** (copied) into the new repo because it can't import across repos. **Server is the source of truth.** A `npm run sync-contract` script re-copies the two files from a sibling `mockopoly-server` checkout. Document this in the repo README. (Known upstream quirk to preserve verbatim: the `S_MortgageLifteed` typo exists in both current type files — copy as-is; do not "fix" unilaterally or it desyncs from the server.)

## 4. 3D scene design (inside one R3F `<Canvas>`)

| Element | Build | Notes |
|---|---|---|
| **Board** | Low-poly Blender `.glb`; procedural beveled tiles as the day-one placeholder | 40 tiles in an 11×11 perimeter ring; deed color bands; center logo; corner art. |
| **Living city** | Diorama ring around the board: buildings, roads, trees, cars, pedestrians | **Full living diorama** (approved): animated cars/people; per-color-group landmark buildings that grow with houses/hotels. Instanced + LOD for perf. |
| **Camera** | drei `CameraControls` + an **auto-director** layer | Cinematically frames your token, the dice, and big moments; player can drag to orbit/zoom, then it snaps back. |
| **Tokens** | 1 `.glb` per token type (8: red/blue/green/yellow/purple/orange/cyan/pink) | Tile-index → world (x,z) lookup. Hop animation with squash/stretch along the path. |
| **Houses / hotels** | Instanced meshes on property tiles | ≤4 houses + 1 hotel; pop-in on build. |
| **Dice** | 2 rapier physics dice | **Predetermined:** server sends values; dice tumble then settle on the server faces. Physics is cosmetic. **Scripted non-physics fallback** if rapier proves unstable on low-end mobile. |
| **Cards** | Chance/CC = 3D flip; property deeds = `Html` overlay | Deeds are text-heavy → DOM cleaner than 3D text. |
| **Lighting / FX** | drei `Environment` (HDRI daylight) + key light + soft shadows; postprocessing bloom + SSAO + tone map | Delivers the "expensive-good" sheen. Always daylight (`DESIGN.md` The Daylight Rule). |

## 5. HUD & screens

3D goes in `<Canvas>`; **all text/UI is DOM React overlaying it** — this kills the imperative-canvas-HUD pain of the 2D client and makes the heavy UI maintainable.

### 5.1 Adaptive density (approved)
Same React components at every breakpoint, different density:
- **Desktop — rich:** always-on player pods (all 4), owned-set rail, live table feed, turn banner, hotbar, emote.
- **Mobile — lean:** turn+cash bar, opponent chip row, big center board, primary Roll + `⋯` overflow + 🏠 sheet, floating emote.

### 5.2 Scene → React map (13 Phaser scenes retired)
| Phaser scene | React |
|---|---|
| Boot / Preload | app bootstrap + `<Suspense>` loader (`useGLTF.preload`, fonts) |
| MainMenu | `<MainMenu>` — create/join, name, token pick (staged in-world) |
| Lobby | `<Lobby>` — slots, ready, countdown (staged in-world) |
| GameScene | `<GameCanvas>` — the R3F scene |
| UIScene | `<Hud>` — pods, rail, feed, hotbar, notifications |
| Trade / Deal / Negotiation / Mortgage / Partnership / DevHacks | one `<XPanel>` each — game-native panels, not forms |
| GameOver | `<GameOver>` — standings, winner spectacle |

### 5.3 HUD element inventory (bound to game state)
Turn banner (`currentPlayer`/`turnPhase`) · player pods (`players[]`/`money`) · action hotbar (`GameEngine` legal moves) · owned-set rail (`properties[]`/buildings) · table feed (event stream) · emote/react (social channel) · dice (`TURN_DICE_ROLLED`) · property deed (`BoardSpace`) · big-moment overlays (shared events) · the 6 feature modals.

### 5.4 Social (first-class, approved)
Player pods with avatars + token; radial emote picker; **big-moment overlays** staged for the whole table (rent hit, jail, bankruptcy, winner). Friends-first: these are shared spectacles, not toasts (mobile may downgrade some to toasts — see open questions).

## 6. Art direction

Full detail in `PRODUCT.md` (strategy) and `DESIGN.md` (visual seed). Summary:
- **Palette:** sunny daylight; signature **Sunny Amber** (primary actions, coins, highlights); **Toy-Park Green** (gain/GO); **Sky-Road Teal** (info/roads); warm cream neutrals; **Rent Red** (loss). The 8 property-group colors are a fixed data-palette used only for property identity, never UI chrome.
- **Type:** rounded friendly sans (Baloo/Fredoka/Nunito family) — chunky display + rounded body + **tabular figures** for all money/dice/counts. Real font embedded at build (not the current ITC Kabel Std).
- **Motion:** choreographed, ease-out exponential, no bounce/elastic. Reduced-motion mode swaps choreography for fades.
- **Named rules (enforced):** The Daylight Rule (always light), The Sticker Rule (panels are raised toy objects, never flat web cards), The Coin Rule (tabular money), The Property-Palette Rule, The Cut-Through Rule (critical text on scrimmed panels, WCAG AA).

## 7. Polish tier & acceptance criteria

The CSS mockup is ~5% of the visual ambition — direction sign-off only. The **shipped product** must deliver all of the following (these are acceptance criteria for Phases 4–5, not optional):
- Real 3D depth via Blender low-poly models (board, tokens, buildings, landmarks).
- Living diorama: animated cars, pedestrians, ambient city; landmark buildings grow with development.
- Physics dice that tumble and settle on the server value (or scripted fallback).
- Cinematic auto-director camera + orbit/snap-back.
- HDRI daylight, soft shadows, ambient occlusion, bloom on amber accents, tone mapping.
- Juice: token hops with squash/stretch, coin bursts, building pop-ins, screen-shake on rent hits, confetti on wins.
- Full-table big-moment overlays (rent/jail/bankruptcy/win).
- Sound + music; haptics on mobile.
- Embedded rounded game font.
- All 6 feature modals as game-native panels; menu + lobby staged in-world.

## 8. Animation / sync model

The server already paces broadcasts with `ANIMATION_*_MS` constants (copied via the contract). Map server events → `@react-spring/three` springs, timed to those constants so the client stays in lockstep with the next snapshot:
- `TURN_PLAYER_MOVED` → token hops tile-by-tile at the server's per-step delay.
- `TURN_DICE_ROLLED` → seed the rapier throw to land on the given values.
- card draw → flip/reveal; rent/money deltas → HUD counter tween + floating text; build → house pop-in.
The client must **never** advance state faster than or ahead of the server; motion only visualizes what the server already decided.

## 9. Accessibility

Target **WCAG AA**. Player identity never relies on color alone — the 8 token colors carry a redundant **shape/pattern/label** (●■▲◆…). Provide a **reduced-motion mode** (default experience is animation-heavy). Guarantee readable contrast for all game-critical text over the busy diorama via backing scrims/panels. Responsive across mobile portrait and desktop.

## 10. Migration phases

Each phase is one (or a few) PR(s) into `staging`; Arslan merges via web. No direct pushes to protected branches.

| Phase | Deliverable | Acceptance |
|---|---|---|
| **0 Scaffold** | `gh repo create mockopoly-js/mockopoly-client-3d`; Vite/React/TS/R3F; copy contract+network+state; de-Phaser → zustand store; connect to server; empty `<Canvas>` + "connected" indicator. Move `PRODUCT.md`/`DESIGN.md`/docs in. | App boots, connects to the running server, store updates on a socket event. |
| **1 Lobby loop** | `<MainMenu>` + `<Lobby>` over sockets (room create/join/ready/start). Static procedural 3D board renders. | Two clients can create/join a room and start a game. |
| **2 Turn core** | Camera controls, tokens on board, roll → move → land → buy. Cosmetic dice (values shown, no physics). Minimal HUD (turn, cash, hotbar). | A full turn plays end-to-end in 3D against the server. |
| **3 Full HUD + modals** | Pods, owned-set rail, table feed, notifications; all 6 modals; GameOver. **Feature parity with the 2D client.** | Every 2D feature is reachable and works in 3D. |
| **4 Polish & physics** | rapier predetermined dice; card flip; HDRI + postFX; token/coin/building juice; big-moment overlays; auto-director camera; sound. | Meets §7 polish acceptance criteria. |
| **5 Real assets** | Swap procedural → Blender `.glb` behind the same component API; Draco/KTX2; embedded font; full living-city diorama. | Ships the target art direction; assets compressed. |
| **6 Mobile / perf** | Responsive lean layout, touch camera, instancing/LOD, GPU budgets, loading states, low-end fallback (scripted dice). Retire the 2D client. | Smooth on a mid-range phone; 2D client decommissioned. |

Component API is designed so procedural placeholders and real `.glb` models are swappable behind one `<XView>` per model — **game code lands (Phases 0–3) before art exists (Phase 5).**

## 11. Risks & mitigations
- **Predetermined physics dice** (trickiest) → scripted non-physics fallback that always lands correctly.
- **Mobile GPU** → instancing, LOD, KTX2 textures, Draco, capped pixel ratio + shadow-map size.
- **Contract drift** → `sync-contract` script; server is source of truth; preserve upstream quirks verbatim.
- **Scope (full living diorama + production + responsive is large)** → phased; each phase independently shippable; 2D stays live until Phase 6.
- **Bundle size** → code-split the `<Canvas>`; tree-shake Three.

## 12. Open questions (resolve during build)
- Exact rounded font pick (Baloo 2 vs Fredoka vs Nunito) — decide at Phase 5 with the real board.
- Emote set (which reactions).
- Mobile big-moment behavior: full takeover vs toast for which events.
- Base branch name for the new repo (`main` + `staging`, or add `dev`?) — confirm with Arslan at Phase 0.
