/**
 * DEV-ONLY `?nohud=1` / Layers-panel "DOM HUD" toggle — take the entire DOM
 * overlay off the game screen and leave the 3D canvas alone.
 *
 * WHY THIS EXISTS. The UI is a stack of `position: fixed` DOM surfaces over a
 * WebGL canvas, and the two are rasterised by different machinery at different
 * resolutions: the renderer is capped at dpr 2, the DOM is not, so an iPhone 13
 * Pro paints every HUD pixel at dpr 3 — 2.25x the pixels any dpr-2 harness
 * reports, against a per-tab tile-memory budget iOS Safari enforces and
 * Chromium does not. That makes "how much of this frame is the DOM" a question
 * only the device can answer, and answering it needs an A/B that a desktop
 * profile cannot fake. Pair with `?glow=0` (or the Layers panel's glow row) to
 * separate DOM cost from GPU cost.
 *
 * THE SELECTOR IS THE HARNESS'S OWN DEFINITION OF "HUD ROOT" — every child of
 * #root that does not contain the canvas — so a device reading and a
 * `/tmp/glowperf` reading measure the same thing. Naming the surfaces
 * individually would silently stop covering any overlay added later, which is
 * the failure mode that matters for a measurement tool.
 *
 * ONE DELIBERATE, NARROW EXEMPTION: `[data-hud-exempt]`. Discovered by actually
 * driving the Layers panel headless at 844×390 (not by inspection): the panel
 * itself is a `#root` child with no canvas descendant, so this selector was
 * hiding the panel along with the rest of the HUD the instant its OWN "DOM HUD"
 * row was tapped — taking its own undo button with it, so turning the HUD back
 * on needed a reload after all, defeating the one thing this toggle exists to
 * avoid. `DebugTogglePanel` marks its root with `data-hud-exempt="true"`; this
 * is the only opt-out, and it is scoped to that one element, not a general
 * escape hatch — every other overlay is still covered unnamed, exactly as
 * before.
 *
 * `display: none`, not `visibility: hidden`: this is the "what if the DOM were
 * not here at all" arm, so layout and hit-testing have to go too. That is also
 * why it is a measurement flag and NOT the mechanism used for closed panels and
 * takeovers, which must keep their layout (see takeoverStage.ts).
 *
 * `!important`, because several HUD roots carry an inline `display`.
 *
 * GAME SCREEN ONLY. Applied globally it would hide the menu as well, and you
 * could never reach the game to measure it — the flag would be unusable on the
 * one platform it was written for.
 *
 * LIVE TOGGLE. The URL flag alone was a one-shot value with no way back short
 * of a reload, which loses camera position and game state — exactly the
 * friction the Layers panel exists to remove. The mutable ON/OFF bit now lives
 * in `hudVisibility.ts` (seeded from this same `?nohud=1` flag); this component
 * only subscribes to it. There is still exactly one way this app hides the
 * HUD — the `<style>` rule below — with one exemption for the panel that has
 * to survive its own effect (see above).
 *
 * Tree-shaken from production: every call site is behind `import.meta.env.DEV`,
 * which Vite statically replaces with `false`.
 */
import { useSyncExternalStore } from 'react';
import { getHudVisible, subscribeHudVisible } from './hudVisibility';

/**
 * Renders the kill rule, or nothing. A `<style>` element is itself a #root
 * child and so matches its own selector — harmless, because `display: none` on
 * a `<style>` does not stop its rules applying (it is never rendered anyway).
 *
 * Subscribes to the live `hudVisibility` store rather than reading the launch
 * flag directly, so the DebugTogglePanel's "DOM HUD" row can flip this on/off
 * live, with no remount and no reload.
 *
 * `:not([data-hud-exempt])` — see the module doc above — keeps the panel that
 * owns this very toggle from hiding itself. Not exported as a named constant:
 * a non-component export costs this `.tsx` file its fast-refresh boundary (see
 * the removed `hudHidden()`'s old comment for the same reasoning); the literal
 * is duplicated in hudOverride.test.tsx instead.
 */
export function HudHideStyle(): React.JSX.Element | null {
  const visible = useSyncExternalStore(subscribeHudVisible, getHudVisible, getHudVisible);
  if (visible) return null;
  return <style>{'#root > *:not(:has(canvas)):not([data-hud-exempt]) { display: none !important; }'}</style>;
}
