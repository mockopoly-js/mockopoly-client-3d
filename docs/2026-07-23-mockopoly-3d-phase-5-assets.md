# Mockopoly 3D — Phase 5: Blender-Authored Assets Implementation Plan

> **For agentic workers:** executed via superpowers:subagent-driven-development — fresh implementer per task, review between tasks, final whole-branch review, merge via PR.

**Goal:** Replace procedural placeholder geometry with real Blender-authored `.glb` models across the board — 8 distinct player tokens, houses/hotels, and a living toy-city center — for the Monopoly-GO diorama look.

**Architecture:** A headless-Blender pipeline (`scripts/blender/*.py`, Blender 5.2 LTS bundled Python) procedurally authors low-poly stylized meshes and exports `.glb` into `public/models/`. The client loads them through one reusable `ModelMesh` R3F component (drei `useGLTF`, vertex-color material, optional tint). Tokens bake **white** COLOR_0 and are tinted per player color client-side; buildings/city props bake **multi-color** COLOR_0 and render untinted. The server and all state/network/types code are untouched; this is pure client + asset work.

**Tech Stack:** Blender 5.2 LTS headless (`bpy`, `bmesh`), `@gltf-transform/core` (validation read-back), React 18 + R3F 8 + drei `useGLTF`, three 0.169, TypeScript, Vitest.

## Global Constraints

- Branch: `feat/procedural-models` (existing — holds the proven pipeline + top-hat). No new branch, no reset.
- Do NOT touch `src/network/*`, `src/types/*`, `src/state/*`, the server, or the 2D client. Vendored contract stays byte-verbatim.
- Do NOT push or open a PR until Task 4. Local commits only until then.
- No Draco compression (client has no DRACOLoader wired) — keep meshes modest-poly instead.
- Every model: **base rests at local y=0**; token footprint radius ≈ 0.32 (so existing `scale=3` placement holds); buildings/props sized to sit on/inside the board (`BOARD_WORLD_SIZE = 10`, tiles span world `[-5,-5]..[5,5]`, empty center ≈ `[-3.3,3.3]`).
- Blender 5.2 API (newer than model training): verify every op against the install; known gotchas — `shade_auto_smooth` op (not `Mesh.use_auto_smooth`), vertex colors via `mesh.color_attributes.new(type="FLOAT_COLOR", domain="POINT")` + active, `export_vertex_color="ACTIVE"` (enum). See `scripts/blender/gen_models.py` for the working reference.
- Preserve PlayerTokens animation exactly: 150ms/tile lockstep hop (`ANIMATION_TOKEN_MOVE_PER_SPACE_MS`), squash/stretch juice, stack offsets for co-located tokens, world-space direct-child-of-origin convention, reconcile-on-drain. Identity derives from server `player.id` (never socket id).
- Keep `npm run build` green and the existing 101 tests passing at every task.

## File Structure

- `scripts/blender/lib.py` — CREATE. Shared helpers extracted from `gen_models.py`: `reset_scene()`, bmesh primitives (`add_ring`, `bridge`, `cap`), `apply_material_and_colors(obj, color|per_vertex)`, `apply_smooth_modifiers(obj, ...)`, `export_glb(obj, path)`. All category scripts import it (`sys.path.append(dirname(__file__))`).
- `scripts/blender/gen_tokens.py` — CREATE. 8 token shapes → `public/models/tokens/<name>.glb`, white COLOR_0.
- `scripts/blender/gen_buildings.py` — CREATE. `house.glb`, `hotel.glb` → `public/models/buildings/`, multi-color COLOR_0.
- `scripts/blender/gen_city.py` — CREATE. `tree.glb`, `building-tall.glb`, `building-wide.glb`, `car.glb` → `public/models/city/`, multi-color COLOR_0.
- `scripts/blender/gen_models.py` — DELETE at Task 1 (top-hat logic moves into `gen_tokens.py` + `lib.py`).
- `scripts/gen-models.mjs` — DELETE at Task 1 (dead three.js generator).
- `src/board/ModelMesh.tsx` — CREATE (generalized from `TophatModel.tsx`, which is DELETED). Reusable loader.
- `src/board/PlayerTokens.tsx` — MODIFY. Swap cylinder for `ModelMesh`, preserve animation.
- `src/board/Buildings.tsx` — CREATE. Renders houses/hotels from `state.properties`.
- `src/board/CityDressing.tsx` — CREATE. Static decorative props in board center.
- `src/screens/GameScene.tsx` — MODIFY (Task 4). Remove spike top-hat; mount `Buildings` + `CityDressing`.
- `package.json` — MODIFY (Task 1). npm scripts for the split pipeline.
- `src/App.routing.test.tsx` — MODIFY (Task 1). Update the `TophatModel` mock → `ModelMesh` (or PlayerTokens mock) so the routing test stays green.

---

## Task 1 (Luna): Shared lib + reusable loader + 8 tokens + PlayerTokens rewire

**Files:** create `scripts/blender/lib.py`, `scripts/blender/gen_tokens.py`, `src/board/ModelMesh.tsx`; modify `src/board/PlayerTokens.tsx`, `package.json`, `src/App.routing.test.tsx`; delete `scripts/blender/gen_models.py`, `scripts/gen-models.mjs`, `src/board/TophatModel.tsx`; remove the spike `<TophatModel>` from `GameScene.tsx` (leave the rest of GameScene alone for Task 4).

**Interfaces produced (consumed by Tasks 2–4):**
- `lib.py` helpers (Python) as listed in File Structure — `apply_material_and_colors` must support BOTH a single color (uniform COLOR_0) and per-region colors, and default export path helpers.
- `ModelMesh` (TSX): `function ModelMesh({ url, tint='#ffffff', position=[0,0,0], scale=1, rotation=[0,0,0] }): JSX` — loads `url` via `useGLTF`, uses the first mesh's geometry, hangs a `MeshStandardMaterial({ vertexColors:true, color:tint, roughness:0.55, metalness:0 })`, `castShadow`. Includes `useGLTF.preload`. Multiple different urls are fine.
- Model files: `public/models/tokens/{tophat,car,dog,ship,boot,thimble,wheelbarrow,cat}.glb` (white COLOR_0).
- Client token map: `TOKEN_MODEL: Record<TokenType,string>` (place in `src/constants/theme.ts` or a new `src/constants/models.ts`) mapping each of the 8 colors to a token glb url, e.g. `red→car, blue→tophat, green→dog, yellow→ship, purple→boot, orange→thimble, cyan→wheelbarrow, pink→cat`.
- npm scripts: `models:tokens`, `models:buildings`, `models:city` (each a Blender headless `--python` on the matching gen script) and `models:build` running all three in sequence. Use absolute Blender path `/Applications/Blender.app/Contents/MacOS/Blender`.

**Art direction (low-poly, chunky, readable silhouettes — bmesh primitives + bevel + light subsurf, ~1.5–3k tris each):**
- `tophat` — reuse the existing working geometry (moved from `gen_models.py`), but export with **white** COLOR_0 (tint moves client-side).
- `car` — classic roadster: rounded body block + tapered hood + cabin + 4 low cylinders (wheels).
- `dog` — stylized Scottie: blocky rounded body + head + 4 stubby legs + perky ears/tail. Chunky, not detailed.
- `ship` — battleship: tapered hull + flat deck + 2 smokestacks (cylinders).
- `boot` — extruded boot side-profile + sole thickness.
- `thimble` — tapered rounded cup, open bottom, slightly domed top.
- `wheelbarrow` — shallow tray + single front wheel + 2 support legs + handles.
- `cat` — sitting cat: rounded body + head + triangular ears + curled tail. Chunky.
- All: white COLOR_0 (so the client tint is the only color), base at y=0, footprint r≈0.32, height 0.5–0.7.

**PlayerTokens rewire (preserve ALL animation semantics):**
- Replace the `<cylinderGeometry>` token with `<group ref>` per player (direct child of the top-level group), and inside it a `<ModelMesh url={TOKEN_MODEL[p.token]} tint={TOKEN_HEX[p.token]} />`. Drive `group.position` / `group.scale` in `useFrame` exactly as the mesh was driven today (hop lerp, squash/stretch, stack offset, reconcile-on-drain, seed-on-mount, live refs). The animation must be byte-for-byte equivalent behavior — only the animated object changes from a mesh to a group wrapping the glb.
- Keep a subtle base disc (or drop the white ring) for legibility — implementer's judgment, but do not regress readability on colored tiles.
- Optionally retain a small emissive pop; not required.

**Verification (no unit test for geometry — pipeline + build + existing tests):**
1. `npm run models:tokens` regenerates all 8 token glbs (Blender headless, clean exit). Each glb: 1 node/1 mesh, COLOR_0 + NORMAL present, base y≈0, footprint r≈0.32, tris < ~3k. Validate with a read-back (extend `scripts/blender/inspect_glb.mjs`), print counts.
2. `curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/models/tokens/tophat.glb` → 200 (dev server is running on :5174).
3. `npm run build` green; `npm test` 101/101 (update the routing mock so it doesn't import a deleted module).
4. Commit on `feat/procedural-models` with a clear message. Do NOT push.

---

## Task 2 (Penny): House + Hotel models + Buildings renderer

**Depends on:** Task 1 (`lib.py`, `ModelMesh`, npm `models:buildings` script + `public/models/buildings/` path all exist).

**Files:** create `scripts/blender/gen_buildings.py`, `src/board/Buildings.tsx`. Do NOT edit `GameScene.tsx`, `package.json`, or any Task 1 file (Task 4 mounts Buildings).

**Interfaces produced:**
- `public/models/buildings/house.glb` — small toy house: green walls + darker roof (multi-color baked COLOR_0), optional door/window accent. Footprint ≈ 0.22, height ≈ 0.28, base y=0.
- `public/models/buildings/hotel.glb` — larger toy hotel: red walls + dark roof, wider. Footprint ≈ 0.5×0.3, height ≈ 0.35, base y=0.
- `Buildings` (TSX): `function Buildings(): JSX` — reads `useGameStore(s => s.state?.properties)`; for each `PropertyState` with `houses > 0`, render that many `house` models; with `hasHotel`, render one `hotel` (hotel replaces houses). Uses `ModelMesh` (no tint / white pass-through — models carry their own colors).

**Placement math (mirror the 2D `HouseHotel` intent in 3D):**
- Buildings sit near the **inner edge** of their tile (toward board center = origin) and face the center.
- For tile index `i`: `const [cx,,cz] = tileToWorld(i)`. Inward direction = normalize(`[-cx,-cz]`) (from tile toward origin). Offset the building group inward from tile center by ~35% of a tile so it sits on the tile's color strip, not its center.
- Up to 4 houses spread perpendicular to the inward direction (evenly across the tile's inner edge). A hotel is a single centered model.
- Rotate each building so its front faces the origin: `rotationY = Math.atan2(inwardX, inwardZ)` (verify sign against the model's forward axis; adjust by π if backwards).
- `y = 0` (models rest on the tile top at ~0.02; place at tile top height).

**Verification:**
1. `npm run models:buildings` regenerates `house.glb` + `hotel.glb`, clean exit; validate counts + COLOR_0 via inspect read-back.
2. `curl` each → 200.
3. `npm run build` green; `npm test` 101/101 (Buildings not yet mounted, so no new render in tests — but must compile).
4. If Buildings has non-trivial placement pure-functions (e.g. `buildingSlots(tileIndex, count)`), add a small unit test for the geometry helper (deterministic, no R3F). Keep it real (assert actual computed coords), not a tautology.
5. Commit. Do NOT push.

---

## Task 3 (Penny, parallel with Task 2): City dressing props + renderer

**Depends on:** Task 1 (`lib.py`, `ModelMesh`, npm `models:city` script + `public/models/city/` path).

**Files:** create `scripts/blender/gen_city.py`, `src/board/CityDressing.tsx`. Do NOT edit `GameScene.tsx`, `package.json`, or any Task 1/Task 2 file.

**Interfaces produced:**
- `public/models/city/tree.glb` — stylized low-poly tree: brown trunk + 1–2 green foliage blobs (multi-color). base y=0, height ≈ 0.4.
- `public/models/city/building-tall.glb` — toy skyscraper: tapered/stacked box tower with a lighter roof + window-row accent color. height ≈ 0.9.
- `public/models/city/building-wide.glb` — squat wide block building, different accent color. height ≈ 0.5.
- `public/models/city/car.glb` — tiny toy car (distinct from the token car: simpler, street-prop scale). height ≈ 0.15.
- `CityDressing` (TSX): `function CityDressing(): JSX` — renders a **static, deterministic** arrangement of the props in the empty board center (world center roughly `[-3.2,3.2]` on x and z, avoiding tiles). No game state. Compose a small toy skyline: a cluster of 3–5 buildings, several trees around them, 1–2 cars, tasteful spacing. Hard-code positions/rotations/scales (a `const PROPS: {url,pos,rotY,scale}[]` array mapped to `ModelMesh`). Keep it inside the board footprint so the orbit camera frames it.

**Verification:**
1. `npm run models:city` regenerates all city glbs, clean exit; validate counts + COLOR_0.
2. `curl` a sample → 200.
3. `npm run build` green; `npm test` 101/101 (CityDressing not yet mounted; must compile).
4. Commit. Do NOT push.

---

## Task 4 (Luna): Wire GameScene, cleanup, optimize, final review, PR

**Depends on:** Tasks 1–3 complete and committed.

**Files:** modify `src/screens/GameScene.tsx`; verify no dead references remain.

**Steps:**
1. In `GameScene.tsx`: ensure the spike `<TophatModel>` is gone (Task 1 removed it); mount `<Buildings />` and `<CityDressing />` inside the Canvas (wrap model-loading children in `<Suspense fallback={null}>`). Keep BoardTiles, PlayerTokens, lights, postFX intact.
2. Confirm `npm run models:build` regenerates the ENTIRE set (tokens + buildings + city) from clean in one command.
3. Confirm all model URLs referenced by components exist under `public/models/` and `curl` 200 on the dev server.
4. `npm run build` green; `npm test` full suite green. Run the app; visually confirm nothing throws (loading suspense, no console errors).
5. Dispatch the final whole-branch code review (opus) over `main..HEAD` — checks: animation lockstep/identity preserved in PlayerTokens, no contract/state/network edits, no dead imports, buildings read state correctly, Suspense boundaries present, models valid. Fix Critical/Important via one fix subagent.
6. Push `feat/procedural-models`, open PR (base `main`), merge via `gh pr merge` (personal SSH, **no `--admin`**), per standing git rules.

## Self-Review notes
- Spec coverage: tokens (T1), buildings (T2), city (T3), wiring+review (T4) — full set covered.
- Type consistency: `ModelMesh` signature identical across T1 definition and T2/T3 consumption. `TOKEN_MODEL` keyed by the 8 `TokenType` values from `theme.ts`. `PropertyState` fields (`houses`, `hasHotel`, `spaceIndex`, `ownerId`) per `types/GameState.ts`.
- Visual quality is human-gated: the user views live at :5174 after each wave and can request style iterations; the loop's automated gates are pipeline-validity + build + tests.
