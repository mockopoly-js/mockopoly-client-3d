# Mockopoly 3D — Phase 4b: Game Feel (dice, camera, sound, environment) Implementation Plan

> **For agentic workers:** executed via superpowers:subagent-driven-development — fresh implementer per task, review between tasks, final whole-branch review, merge via PR.

**Goal:** Add the interactive/sensory polish that makes the board feel like a live toy game: tumbling 3D dice that resolve to the server's roll, an orbitable + gently auto-focusing camera, procedural sound effects, and softer diorama lighting.

**Architecture:** All additive to the existing R3F scene. Dice are **procedural** (real 3D cube meshes tumbled in `useFrame`, then slerped to the orientation that shows the server-decided value) — NOT a physics engine, because the outcome is predetermined server-side and rapier would add ~500KB wasm while fighting a forced result. Camera gains drei `OrbitControls` (manual) plus a subtle event-driven auto-focus toward the active player. Sound is synthesized with the WebAudio API (no asset files). Lighting adds a hemisphere light + soft shadows + gradient — no external HDRI.

**Tech Stack:** React 18 + R3F 8.18 + three 0.169 + drei 9.122 (`OrbitControls`, `SoftShadows`), WebAudio API, TypeScript, Vitest. No new heavy deps (no rapier, no audio lib).

## Global Constraints

- Branch: `feat/phase-4b` off `main` (a95a515, includes Phase 5).
- Do NOT touch `src/network/*`, `src/types/*`, `src/state/*`, the server, or the 2D client. Vendored contract byte-verbatim.
- Preserve the token hop lockstep (`HOP_MS=150`) and PlayerTokens animation exactly — do not regress it.
- Dice must show the **server's** `dice` values (`S_DiceRolled.dice: [number,number]`), never a client-random result. Resolve within ~700ms so the value is readable before the token starts moving (server paces the follow-up broadcast ~800ms).
- WebAudio must be lazily started on a user gesture (browser autoplay policy) and be mute-toggleable; a headless/test env has no AudioContext — guard so import/render never throws under jsdom.
- No external network fetches at runtime (no CDN HDRI/fonts). Everything self-contained.
- Keep `npm run build` green and existing tests (111) passing at every task; add real tests for pure logic (dice face→quaternion map, sfx guards).
- Do NOT push/PR until the final task. Merge via `gh pr merge` (personal SSH, NO `--admin`).

## File Structure

- `src/board/Dice3D.tsx` — CREATE. The 3D dice group: two `<Die>` meshes, tumble+resolve animation driven by `dice-rolled`.
- `src/board/dice-orientation.ts` — CREATE. Pure: `FACE_NORMAL` map (value 1–6 → local unit normal) + `resolveQuaternion(value)` (aligns that face to +Y). Unit-tested.
- `src/ui/DiceDisplay.tsx` — MODIFY or RETIRE. Replace the HTML pip overlay with the 3D dice (keep a tiny textual fallback only if useful; otherwise remove and delete its use in App).
- `src/board/CameraRig.tsx` — CREATE. drei `OrbitControls` + event-driven auto-focus (eases the controls target toward the active player's tile on turn start / dice / landing).
- `src/audio/sfx.ts` — CREATE. WebAudio synth: `initAudioOnGesture()`, `playSfx(name)`, `setMuted(bool)`, `isMuted()`. Names: `roll`, `hop`, `buy`, `rent`, `jail`, `bankrupt`, `win`. Pure-synth (oscillators/noise), no files.
- `src/audio/useSfx.ts` — CREATE. Hook wiring gameBus events → `playSfx`, mounted once in App.
- `src/ui/MuteButton.tsx` — CREATE. Small HUD toggle for sound.
- `src/screens/GameScene.tsx` — MODIFY. Mount `Dice3D` + `CameraRig`; add hemisphere light + `SoftShadows` + gradient tuning.
- `src/App.tsx` — MODIFY. Mount `useSfx()` + `MuteButton`; swap DiceDisplay if retired; start audio on first gesture.
- Tests: `src/board/dice-orientation.test.ts`, `src/audio/sfx.test.ts`.

---

## Task 1 (Luna): Procedural 3D dice

**Files:** create `src/board/dice-orientation.ts`, `src/board/Dice3D.tsx`, `src/board/dice-orientation.test.ts`; modify `src/screens/GameScene.tsx` (mount `<Dice3D/>` inside Canvas), `src/App.tsx` + `src/ui/DiceDisplay.tsx` (retire the HTML overlay OR keep it hidden; recommend removing the overlay and its App usage since 3D dice replace it).

**Interfaces produced:**
- `dice-orientation.ts`: `export const FACE_NORMAL: Record<number, [number,number,number]>` for values 1–6 (opposite faces sum to 7; consistent standard-die layout); `export function resolveQuaternion(value: number): THREE.Quaternion` returning the rotation q with `q * FACE_NORMAL[value] ≈ (0,1,0)` (target face points up, toward the overhead-ish camera). Use `Quaternion.setFromUnitVectors(new Vector3(...FACE_NORMAL[value]), new Vector3(0,1,0))`.
- `Dice3D()`: renders two dice above the board (near center, e.g. y≈1.6). Subscribes to `dice-rolled` (`{dice:[number,number]}`); on event, sets each die spinning (fast multi-axis angular velocity, ease-out) for ~450ms, then over ~250ms slerps each die's quaternion to `resolveQuaternion(dice[i])`, lands with a small scale pop, holds ~1s, then fades/hides. Idle = hidden (return dice group with visible=false when no active roll). Drive entirely in `useFrame` (no react-spring).

**Die mesh:** a rounded/beveled white box (~0.5 units) + pips as small dark meshes (spheres or flat discs) inset on each face at the standard pip grid for that face's value (21 pips per die), positioned along each face normal. Faces MUST match `FACE_NORMAL` so the resolve shows the right value. `castShadow`.

**Verification:**
1. `dice-orientation.test.ts` (real assertions, no R3F): for each value 1–6, apply `resolveQuaternion(v)` to `FACE_NORMAL[v]` and assert the result ≈ `(0,1,0)` (within 1e-6); assert opposite faces sum to 7 and all 6 normals are unit + axis-aligned + distinct.
2. `npm run build` green; `npm test` (111 + new dice tests) green. Under jsdom the Dice3D component must not be exercised (mock it in any routing test that renders GameScene, matching the existing ModelMesh/PlayerTokens mock pattern).
3. Visual (user, live :5174): roll → dice tumble → land showing the server values.
4. Commit on `feat/phase-4b`. First step: `git checkout main && git pull origin main && git checkout -b feat/phase-4b`.

---

## Task 2 (Penny): Camera rig (orbit + auto-focus) + environment/lighting polish

**Files:** create `src/board/CameraRig.tsx`; modify `src/screens/GameScene.tsx`.

**Interfaces produced:**
- `CameraRig()`: renders drei `<OrbitControls>` configured for a tabletop feel — `enablePan={false}` (or limited), `minPolarAngle`/`maxPolarAngle` to keep the camera above the board, `minDistance`/`maxDistance` zoom clamps, `enableDamping`. Plus a subtle auto-focus: on `dice-rolled` / turn change (read `selectCurrentPlayer` from gameStore + a gameBus signal), ease the OrbitControls `target` toward the active player's `tileToWorld(position)` over ~600ms, then leave control to the user. Auto-focus must NOT hard-lock the camera or fight active user dragging (skip auto-move while the user is interacting — OrbitControls fires `start`/`end` events). Keep it gentle (recenter target only; do not yank position/zoom).

**Environment/lighting (in GameScene):**
- Add `<hemisphereLight>` (soft sky/ground fill, e.g. sky `#cbe8f5` ground `#8a9a5b`, low intensity) to complement the existing directional + ambient. Consider reducing ambient slightly so shadows read.
- Add drei `<SoftShadows>` (pure, no assets) for softer contact shadows, tuned modestly (size/samples reasonable for perf).
- Optional subtle gradient background instead of flat `#cbe8f5` (a simple vertical gradient via a large backing plane or keeping the flat color — implementer's judgment; keep it tasteful and cheap). Do not add external HDRI.
- Keep camera initial `position`/`fov` as-is; OrbitControls takes over interaction. Keep EffectComposer/Bloom/ToneMapping.

**Verification:**
1. `npm run build` green; `npm test` green (mock CameraRig/OrbitControls in any GameScene routing test if needed — OrbitControls needs a real renderer; guard under jsdom).
2. Visual: user can orbit/zoom; camera gently recenters on the active player each turn; shadows softer; lighting reads as a lit diorama.
3. Commit on `feat/phase-4b`.

---

## Task 3 (Penny): Procedural WebAudio SFX

**Files:** create `src/audio/sfx.ts`, `src/audio/useSfx.ts`, `src/ui/MuteButton.tsx`, `src/audio/sfx.test.ts`; modify `src/App.tsx` (mount `useSfx()` + `<MuteButton/>`, start audio on first user gesture).

**Interfaces produced:**
- `sfx.ts`: lazy singleton AudioContext created only on first `initAudioOnGesture()` (called from a click/keydown handler in App). `playSfx(name: SfxName)` synthesizes the sound (oscillators + gain envelopes + short noise bursts) — `roll` (dice rattle: short filtered-noise burst), `hop` (soft blip per token hop), `buy` (two-tone coin ding), `rent` (descending tone), `jail` (low clang), `bankrupt` (downward sweep), `win` (rising arpeggio). `setMuted`/`isMuted` persist mute to localStorage. ALL functions no-op safely if no AudioContext (jsdom/SSR) — never throw on import or call.
- `useSfx()`: subscribes to gameBus events and maps → `playSfx`: `dice-rolled`→roll, `player-moved`→hop (one per hop is ideal but a single blip per move is acceptable), `property-bought`→buy, `rent-collected`→rent, `jail-sent`→jail, `player-bankrupt`→bankrupt, `game-over`→win. Confirm exact event names against `src/network/GameStateSync.ts` before wiring; only wire events that actually exist.
- `MuteButton`: small fixed HUD button toggling `setMuted`, reflects `isMuted()`, uses 🔊/🔇 or text.

**Verification:**
1. `sfx.test.ts`: assert `playSfx`/`initAudioOnGesture`/`setMuted` do NOT throw when AudioContext is absent (jsdom); assert mute state round-trips via localStorage; assert `playSfx` with an unknown name is a safe no-op. (Do not assert actual audio output.)
2. `npm run build` green; `npm test` green.
3. Visual/audio (user): sounds fire on the right events after the first click; mute works.
4. Commit on `feat/phase-4b`.

---

## Task 4 (Luna): Final wiring check, whole-branch review, PR

**Steps:**
1. Confirm GameScene mounts Dice3D + CameraRig + new lights; App mounts useSfx + MuteButton; DiceDisplay retirement left no dead imports; all under correct Suspense/guards.
2. `npm run build` green; full `npm test` green; run the app — no console errors; verify jsdom-guarded paths (audio, OrbitControls, Dice3D) don't break tests.
3. Controller dispatches the final whole-branch review (opus) over `main..HEAD`: dice resolve correctness (server value shown, lockstep timing), camera doesn't fight user input, audio guards, no forbidden edits, no regression to token animation. Fix Critical/Important via one fix subagent.
4. Push `feat/phase-4b`, PR base `main`, merge via `gh pr merge` (NO `--admin`).

## Self-Review notes
- Dice value correctness is the crux — the resolve quaternion is pure + unit-tested; the tumble is cosmetic and cannot change the shown value.
- Deviation from spec label: procedural dice instead of rapier physics (rationale in Architecture) — flag to the human; real physics is a possible future follow-up.
- Deferred (need asset files/bigger scope): real HDRI, licensed/recorded audio, embedded rounded font, rapier bounce. Phase 6 = mobile/perf/code-splitting.
