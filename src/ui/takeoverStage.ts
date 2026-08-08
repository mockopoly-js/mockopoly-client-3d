/**
 * THE OPEN-TAKEOVER REGISTRY — one signal, every takeover, two consumers.
 *
 * WHY THIS EXISTS (the bug it fixes). `TurnHud` is mounted unconditionally for
 * the whole `screen === 'game'` branch and stays mounted under every takeover.
 * `.rn-tk` deliberately carries NO opaque fill — the window layer does, and it
 * masks a band down to 66% alpha across the verdict column so the live board
 * reads through. The HUD sits at --z-hud (110), directly under that band, so
 * the centre readout printed "FREE PARKING £3.5M" straight through the middle
 * column, on top of the net-effect figure. Two live surfaces, one unreadable
 * pixel. The board is supposed to show through; the HUD is not. So the HUD
 * yields, and this is the signal it yields to.
 *
 * WHY A REGISTRY AND NOT A BOOLEAN. The same mask makes any SECOND takeover
 * print through the first one exactly the same way — `DealPanel` already hits
 * this and gates its own surface by hand (`open={isOpen && !goOpen}`, with the
 * failure written up in the comment above it). That hand-gate only works
 * because one component owns both surfaces. Trade + pending rent, or auction +
 * liquidation, are owned by different components mounted as bare siblings, so
 * nothing coordinates them and the pair resolves by DOM order. An ordered
 * stack answers both questions from one fact: "is anything open" for the HUD,
 * and "am I the most recent" for the panels.
 *
 * WHY A STORE AND NOT CONTEXT OR THE BUS. Context needs a provider, and the
 * only common ancestor is App.tsx. The bus (`open-negotiation`,
 * `open-liquidation`) is transient by design — it carries "open this", not
 * "this is open", and nothing on it ever says CLOSED. Openness is already
 * tracked five different ways (zustand flags, bus events, local state seeded
 * off `turn.auctionState`, a controlled `open` prop, `activeTrade` party
 * membership); this does not replace any of them. It observes the one thing
 * they all agree on — the `open` a stage host is actually rendering with.
 *
 * WHY THE STAGE HOSTS REGISTER, NOT THE PANELS. Every takeover in the game is
 * mounted through exactly one of two hosts: `<RuleTakeover>`'s `.rn-layer`
 * (trade, partnership, rent deal, GO advance) and `<TakeoverHost>` (auction,
 * bankruptcy). Both already receive the authoritative `open`. Registering
 * there covers all six panels with a one-prop edit to two of them and none to
 * the other four, and any future takeover joins for free.
 */
import { useEffect, useId } from 'react';
import { create } from 'zustand';
import { KIT, Z } from './kit';
import type { KitStyle } from './kit';

interface TakeoverStack {
  /** Every open takeover stage, oldest first. The last entry owns the screen. */
  stack: readonly string[];
  push: (id: string) => void;
  drop: (id: string) => void;
}

/**
 * Exported for tests. Application code goes through the two hooks below —
 * an id is meaningless outside the stage host that owns it.
 */
export const useTakeoverStack = create<TakeoverStack>((set) => ({
  stack: [],
  // Returning the SAME state object is how zustand v5 is told "no change":
  // it compares with Object.is before notifying. A re-registration under
  // StrictMode's double-invoke therefore costs nothing and, more importantly,
  // cannot reorder the stack and silently re-rank a surface that never moved.
  push: (id) => { set((s) => (s.stack.includes(id) ? s : { stack: [...s.stack, id] })); },
  drop: (id) => { set((s) => (s.stack.includes(id) ? { stack: s.stack.filter((x) => x !== id) } : s)); },
}));

export interface TakeoverStageState {
  /** Spread onto the fixed stage host. Carries the z-order and the stand-down. */
  style: KitStyle;
  /** True when a LATER takeover opened over this one. Set `aria-hidden` from it. */
  buried: boolean;
}

/**
 * Register a stage host and get back how it should paint.
 *
 * TWO TAKEOVERS AT ONCE RESOLVE BY RECENCY, NOT BY DOM ORDER — and the buried
 * one goes DARK rather than merely going under. Ordering alone is not enough
 * here: both stages are `inset:0`, neither is opaque across the masked band,
 * and z-order would still leave the older surface's columns printing through
 * the newer one's window. `visibility:hidden` is inherited, is not a paint, and
 * (unlike `display:none`) removes the subtree from hit-testing and the focus
 * order without touching layout — so the buried surface cannot be tapped
 * through, cannot be tabbed into, and reappears intact the instant the surface
 * above it closes. Nothing is unmounted, so no panel loses a keystroke of
 * composed state.
 *
 * SUPPRESSION, NOT SUBSTITUTION: whichever takeover opened LAST is the one that
 * just demanded attention, and the older one is still open behind it. Enforcing
 * "one at a time" instead would mean refusing to open a surface the server has
 * already committed to — an auction you can never bid in because a stale trade
 * panel was still up — which is the same class of bug as the one being fixed.
 *
 * The z-index bump is belt and braces: with the buried stage hidden the stack
 * order is no longer load-bearing, but if a descendant ever re-declares
 * `visibility: visible` (`.kit-arm` does exactly that, two levels down) the
 * outcome must still be decided by recency and never by which panel App.tsx
 * happens to mount last. --z-takeover is 140 and --z-guides is 190, so the
 * bump has 49 levels of headroom it will never come close to using.
 *
 * ── A CLOSED STAGE MUST NOT COMPOSITE ──────────────────────────────────────
 *
 * The same `visibility` now also parks the stage while it is merely CLOSED,
 * and that is a MEASURED compositor fix, not tidiness. All six stages are
 * mounted for the whole game (they must be — see GOTCHA 5 in rules.css: a
 * conditionally rendered takeover can never play its exit, and a half-composed
 * trade would lose its state), and a closed one was still handing the
 * compositor a full-viewport `inset:0` host, a full-viewport masked
 * `.rn-window`, a full-viewport `.kit-takeover` and three `overflow-y:auto`
 * columns EACH. Censused at 844x390: 84 compositor layers against HEAD's 20,
 * 12 full-viewport DRAWING layers against HEAD's 2, and 171 MB of backing
 * store at the dpr 3 an iPhone 13 Pro actually rasterises the DOM at (the
 * WebGL renderer is capped at 2, so the phone pays 2.25x what a dpr-2 harness
 * reports, against a per-tab tile-memory budget iOS Safari enforces).
 * `.rn-tile` alone carries `filter: brightness()` on ~40 mini-board tiles per
 * negotiation surface — 159 filtered elements on a screen where HEAD had none.
 *
 * VISIBILITY, NOT `content-visibility: hidden`, AND NOT UNMOUNTING. Both of the
 * stronger tools also skip LAYOUT, and that costs two things this system
 * relies on. (1) THE ENTRANCE. Skipped content does not run transitions, and
 * every stage's `open` reaches the host and the `.is-on` inside it in the SAME
 * React commit — there is no frame in between in which to un-skip, so the
 * surface would snap in instead of fading, and `Takeover` fades precisely
 * because it may not scale (B7: a container scale shrank every 44px button to
 * 42.2px mid-entrance). (2) THE SAFE-AREA AUDIT. `content-visibility: hidden`
 * zeroes `getBoundingClientRect`, so the 18-surface inset audit would start
 * "passing" because it could no longer see the surfaces — the exact false
 * negative that audit exists to catch. `visibility: hidden` paints nothing and
 * allocates no backing store while leaving layout, geometry and composed state
 * completely intact.
 *
 * THE HIDE IS DELAYED BY THE FADE ON THE WAY OUT and undelayed on the way in —
 * the same `visibility 0s linear <dur>` pairing HUD_STAND_UP/DOWN uses below,
 * for the same reason: the exit has to finish painting before the stage stops
 * painting at all. Burying is undelayed, because a buried stage must go dark
 * the instant the surface above it opens.
 */
export function useTakeoverStage(open: boolean): TakeoverStageState {
  const id = useId();
  const rank = useTakeoverStack((s) => s.stack.indexOf(id));
  const depth = useTakeoverStack((s) => s.stack.length);

  useEffect(() => {
    if (!open) return;
    // Read the actions off the store rather than subscribing to them: they are
    // stable for the life of the store, and pulling them in as deps would make
    // this effect look re-runnable when it is not.
    const { push, drop } = useTakeoverStack.getState();
    push(id);
    return () => { drop(id); };
  }, [open, id]);

  const buried = rank >= 0 && rank < depth - 1;
  const shown = open && !buried;

  return {
    buried,
    style: {
      // Math.max: an unregistered stage (closed, or the one render before the
      // effect commits) reads rank -1 and must still sit at the base band.
      zIndex: Z.takeover + Math.max(rank, 0),
      visibility: shown ? 'visible' : 'hidden',
      transition: `visibility 0s ${KIT.easeLinear} ${shown || buried ? '0s' : KIT.durTakeover}`,
    },
  };
}

/**
 * True while ANY takeover owns the screen. The HUD's stand-down signal.
 *
 * A boolean selector, not the array: zustand compares with Object.is, so the
 * HUD re-renders when the screen changes hands between "a takeover is up" and
 * "the board is yours", and not once for every reorder underneath it.
 */
export function useAnyTakeoverOpen(): boolean {
  return useTakeoverStack((s) => s.stack.length > 0);
}

// ────────────────────────────────────────────────────────────────────────────
// THE STAND-DOWN
// ────────────────────────────────────────────────────────────────────────────

/**
 * THE HUD STANDS DOWN UNDER A TAKEOVER — and it is the HUD that yields.
 * ONE mechanism, ONE definition, every HUD-layer surface. Written for
 * <TurnHud>, which is where the bug was found; it lives here because the fix
 * is not a TurnHud fix.
 *
 * THE BUG, FOUND IN A SCREENSHOT AND IN NOTHING ELSE. A takeover's middle
 * column is transparent BY DESIGN: `.rn-tk` carries no fill and `.rn-window`
 * masks a band down to 66% alpha so the live board reads through the verdict —
 * the fix for the most-quoted failure in this genre (Catan Universe's trade
 * screen hiding the map). TurnHud is mounted unconditionally for the whole
 * `screen === 'game'` branch, it sits at --z-hud (110) under that band, and the
 * centre readout is dead centre. So `FREE PARKING £3.5M` printed straight
 * through the window, on top of the net-effect figure: two live surfaces, one
 * unreadable. Filling the window in would delete the feature. The HUD yields.
 *
 * AND IT IS NOT ONE SURFACE, WHICH IS WHY THIS IS A SHARED HOOK. TurnHud stood
 * down alone and the screenshot STILL showed player-pod ghosts behind the YOU
 * GIVE column (measured max 12.9/255, mean 0.42/255): every HUD-layer surface
 * is its own `position:fixed` stage, so each one has to yield for itself. The
 * fill is a radial gradient that only reaches 98.5% at 70% out — it is 95% at
 * the top centre, so a 5% leak of anything bright is the FLOOR, not an edge
 * case, and the transparent band passes ~35%. Anything painting under a
 * takeover shows.
 *
 * THE WHOLE STAGE, NOT THE OFFENDING PART. The centre readout was the only
 * visibly-wrong pixel, but the rest is already invisible (98.5% fill) or
 * already unreachable (a `.is-on` takeover is inset:0 with pointer-events, so
 * it swallows every tap aimed at what is underneath). Hiding one slot would
 * leave gradient edge bands bleeding through the window and leave live buttons
 * under an opaque surface, taking focus and reading to a screen reader. One
 * flag, one code path, nothing half-standing.
 *
 * NOTHING IS UNMOUNTED. A layout teardown under an open takeover is worse than
 * the overlap it fixes: strips, badges, sheets and lists would all re-mount and
 * re-measure on close, and a half-composed panel would lose its state.
 *
 * WHAT IS NOT LOST. Whose turn it is stays on screen — every negotiation
 * takeover carries its own <TurnStrip> in the footer context (CHANNEL 3) and
 * lights its whole surface in that player's colour.
 *
 * OPACITY 0 AND visibility, TOGETHER, AND THAT PAIRING IS THE BUG-FIX.
 * Rule R3 bans opacity as DE-EMPHASIS because a fractional alpha multiplies a
 * glyph's text-shadow into a smeared duplicate — that shipped once as a ghost
 * second money mark. 0 and 1 are a full show/hide and are explicitly outside
 * R3, but a paint at exactly 0 is only correct while the value is exactly 0, so
 * `visibility` guarantees the end state and drops the subtree from hit-testing
 * and the focus order as well. (`opacity` is also the half that actually
 * covers `.kit-arm`, which re-declares `visibility: visible` two levels down —
 * an inherited `hidden` alone would leave an armed confirm painting.) The
 * visibility flip is delayed by the fade length on the way out
 * (`0s linear 450ms`) and undelayed on the way in, which is what lets the
 * opacity transition actually play. --dur-takeover, so this fades out over
 * exactly the interval the takeover fades in: one cross-fade, and the ghost
 * window is the one frame-range where the two are mid-blend.
 */
const T_UP = `opacity ${KIT.durTakeover} ${KIT.easeOut}`;
const T_DOWN = `opacity ${KIT.durTakeover} ${KIT.easeOut}, visibility 0s ${KIT.easeLinear} ${KIT.durTakeover}`;

export const HUD_STAND_UP: KitStyle = { opacity: 1, visibility: 'visible', transition: T_UP };
export const HUD_STAND_DOWN: KitStyle = { opacity: 0, visibility: 'hidden', transition: T_DOWN };

export interface HudStandDown {
  /** Spread onto the surface's own fixed stage, AFTER its base style. */
  style: KitStyle;
  /**
   * Feed straight into `aria-hidden` on the same element. A stood-down surface
   * is not merely invisible, it is not there: a screen reader must not read a
   * free-parking pot or an opponent's cash out of a dialog that has taken the
   * screen. `visibility:hidden` already drops the subtree from the
   * accessibility tree and the focus order; this states it, and it is what
   * keeps `getByRole` out of it in jsdom, which applies neither.
   */
  ariaHidden: true | undefined;
  /** The raw signal, for a surface that also has to branch on it. */
  down: boolean;
}

/**
 * Yield the screen to whatever takeover owns it.
 *
 * @param alsoTransition a transition the surface ALREADY runs. The stand-down
 *   owns the `transition` shorthand, so an existing one (CameraViewButton
 *   animates its own pressed state) must be composed in here rather than
 *   silently clobbered by the spread at the call site.
 */
export function useHudStandDown(alsoTransition?: string): HudStandDown {
  const down = useAnyTakeoverOpen();
  const base = down ? HUD_STAND_DOWN : HUD_STAND_UP;
  return {
    down,
    ariaHidden: down ? true : undefined,
    style: alsoTransition === undefined
      ? base
      : { ...base, transition: `${alsoTransition}, ${down ? T_DOWN : T_UP}` },
  };
}
