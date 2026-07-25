# Mockopoly 3D — Phase 7: Production Polish Implementation Plan

> Executed via superpowers:subagent-driven-development. Two themed PRs; one opus whole-branch review per PR before merge.

**Goal:** Ship the remaining production polish, all produced in-repo (no user-supplied assets, no runtime CDN): a real rounded game font, procedural studio-quality lighting, richer sound, a fully mobile-ready UI (the hard requirement), installable PWA/offline, and leaner token loading.

**Architecture:** Everything self-hosted. The font is an OFL file (Baloo 2) fetched once and vendored into `public/fonts/` + `@font-face` (no runtime CDN). The environment map is authored procedurally with drei `Environment`+`Lightformer` (no `.hdr`). Audio stays procedural WebAudio synth (polished). PWA icons are generated from an SVG we author (via `sharp` at build-script time). No new RUNTIME dependencies except the font file; `vite-plugin-pwa` + `sharp` are dev/build tooling.

**Tech Stack:** React 18 + R3F 8.18 + drei 9.122 (`Environment`,`Lightformer`) + three 0.169, WebAudio, `vite-plugin-pwa`, `sharp` (dev, icon gen), Vitest.

## Global Constraints
- Do NOT touch `src/network/*`, `src/types/*`, `src/state/*`, the server, or the 2D client. Vendored contract byte-verbatim.
- No runtime CDN / external fetch at app runtime. The font is vendored locally. Everything self-contained.
- Preserve the Phase 6 bundle win: entry ~78KB gz, `dist/index.html` zero `modulepreload`, three/rapier/drei only in the async GameScene chunk. Re-verify after any GameScene/vite change. The font CSS + PWA registration are tiny and may live in the entry; the font FILE must be lazy/async (font-display: swap, not render-blocking).
- Do NOT regress gameplay, dice, camera, or existing 131+ tests. Add real tests for new pure logic.
- Merge via `gh pr merge` (personal SSH, NO `--admin`). Two PRs.

## PR A — Look & Feel (branch `feat/polish-look` off main 1b7ddef)

### Task A1 (Penny): Rounded game font (Baloo 2)
- Fetch the OFL variable font ONCE into `public/fonts/`: `curl -sL -o public/fonts/Baloo2.ttf "https://github.com/google/fonts/raw/main/ofl/baloo2/Baloo2%5Bwght%5D.ttf"` (confirmed working, ~667KB TrueType). Verify with `file`. Also copy the OFL license text to `public/fonts/OFL.txt` (fetch `https://github.com/google/fonts/raw/main/ofl/baloo2/OFL.txt`).
- Add `@font-face` in `src/index.css` (or a new `src/fonts.css` imported by main): `font-family: 'Baloo 2'; src: url('/fonts/Baloo2.ttf') format('truetype-variations'); font-weight: 400 800; font-display: swap;`.
- Create `src/constants/fonts.ts`: `export const FONT_FAMILY = "'Baloo 2', ui-rounded, system-ui, sans-serif";`.
- Sweep ALL 18 files that currently hardcode `'ui-rounded, system-ui, sans-serif'` (list: DealPanel, PropertyListPanel, MuteButton, GameLog, HudButtons, BigMomentOverlay, TurnHud, TradePanel, MortgagePanel, ToastLayer, PartnershipPanel, BuyPrompt, ConnectionStatus, PlayerPods, Lobby, GameOverScreen, MainMenu — and LoadingScreen which uses `'ITC Kabel Std'`) → import and use `FONT_FAMILY` from `constants/fonts.ts`. Also set `body { font-family: <same> }` in index.css as the inherited default.
- Verify: `npm run build` green; `npm test` green; entry chunk still ~78KB gz + no modulepreload (the .ttf is a static public asset, not bundled). Commit.

### Task A2 (Penny): Procedural HDRI environment
- In `src/screens/GameScene.tsx`, add a drei `<Environment resolution={256} frames={1}>` (baked once, cheap) containing a few `<Lightformer>`s (a large soft key overhead, a cool rim, a warm fill) to give the glossy toy models real soft reflections/IBL. Keep it subtle — complement, don't blow out, the existing directional + hemisphere + bloom. Optionally set `environmentIntensity` low. Do NOT add an `.hdr` file or `preset` (presets fetch from CDN — forbidden).
- Keep camera/shadows/postFX intact. Re-verify bundle (drei already in the GameScene async chunk; must stay out of entry).
- Verify build + tests green. Commit.

### Task A3 (Penny): SFX polish
- In `src/audio/sfx.ts`, enrich the procedural synths (better ADSR envelopes, add a subtle dice-landing thud layered on `roll`, warmer `buy` coin shimmer, softer `hop`), keep everything synth (no sample files), keep jsdom-safe guards + mute + the 7 event mappings. Do NOT change `useSfx.ts` wiring or event names.
- Verify `sfx.test.ts` still green (10) + build + full tests. Commit.

**→ Controller: one opus whole-branch review of `feat/polish-look`; fix Critical/Important; push + PR base main + merge (no --admin).**

## PR B — Mobile & PWA (branch `feat/mobile-pwa` off updated main)

### Task B1 (Penny): Deep mobile pass (THE hard requirement)
- **Menu/Lobby/GameOver responsive** (the gap — Phase 6 only did in-game HUD): make `MainMenu`, `Lobby`, `GameOverScreen` mobile-friendly via `useIsMobile()` — fluid widths, stacked layouts, ≥44px tap targets, readable type, no horizontal overflow at 360px wide.
- **Viewport height**: replace `100vh`/`height:100%` reliance with `100dvh` (dynamic viewport) where full-height matters, so mobile address bars don't clip the UI. Update `index.css` (`html,body,#root` height → `100dvh` with `100vh` fallback).
- **Safe-area insets**: apply `env(safe-area-inset-*)` padding to top strip, bottom action bar, and bottom-sheet modals so notches/home-indicators don't overlap controls (Phase 6 added it to the action bar — audit all fixed edges).
- **Orientation**: the board reads best in landscape on a phone. Add a lightweight portrait hint overlay on small portrait screens ("↻ rotate for the best view") that's dismissible / auto-hides in landscape — do NOT hard-lock. Use `matchMedia('(orientation: portrait)')` via a small hook (or extend useIsMobile). Keep it non-blocking.
- **Touch feel**: ensure buttons have `:active`/touch feedback, `-webkit-tap-highlight-color: transparent`, and no accidental double-tap-zoom (`touch-action: manipulation` on interactive controls).
- Add a real test for any new pure hook (e.g. `useOrientation`). Verify build + tests green. Commit.

### Task B2 (Luna): PWA + offline
- Add `vite-plugin-pwa` (dev dep) with `registerType:'autoUpdate'`, a `manifest` (name "Mockopoly", short_name, theme_color `#08080f`, background `#08080f`, display `standalone`, orientation `any`), and Workbox precache of the app shell + a runtime cache for `/models/*.glb` (CacheFirst) so a played game works offline.
- **Author the icon yourself + generate the set:** write `scripts/gen-icons.mjs` that draws an on-brand SVG app icon (e.g. a gold Monopoly-style token/board glyph on `#08080f`) and rasterizes it with `sharp` (dev dep) to `public/icons/icon-192.png`, `icon-512.png`, and a `maskable-512.png` (safe padding). Reference these in the manifest. Add an npm `icons:build` script. No external icon downloads.
- Ensure the service worker registration is tiny + in the entry (does not pull the 3D chunk). Re-verify: entry still ~78KB gz + zero modulepreload of heavy chunks; PWA precache manifest excludes the huge async three/rapier chunk from render-blocking (precache is fine, but must not modulepreload it into first paint).
- Verify `npm run build` produces `sw.js` + `manifest.webmanifest` + icons; build + tests green. Commit.

### Task B3 (Annie): Per-player token preload
- In `src/constants/models.ts`, REMOVE the eager `for (…) useGLTF.preload(url)` loop that warms ALL 8 tokens. Instead export a helper `preloadToken(token: TokenType)` and call it from `PlayerTokens.tsx` in an effect keyed on the current players so only the active players' token glbs are warmed. Keep `TOKEN_MODEL` unchanged. (Models still load on demand via `useGLTF` regardless; this just stops warming 8 when 2 are playing.)
- Verify build + tests green (mock/import path in tests unaffected). Commit.

**→ Controller: one opus whole-branch review of `feat/mobile-pwa` (focus: mobile correctness at 360px + landscape, dvh/safe-area, PWA SW doesn't regress initial load, offline works, no forbidden edits); fix; push + PR base main + merge (no --admin).**

## Self-Review notes
- Font: OFL (free, redistributable) vendored locally + license included; no runtime CDN.
- Bundle invariant re-checked after A2 (env), B2 (PWA SW) — the two GameScene/entry-touching tasks.
- All "asset" items produced in-repo: font fetched-and-vendored, env procedural, audio synth, icons generated from authored SVG.
- Deferred as genuinely out-of-scope (need real recordings/large effort): licensed music/voice, hand-authored HDRI photography. Not required for "production polish."
