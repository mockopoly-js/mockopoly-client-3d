/**
 * SHELL CHROME — the geometry the four off-board screens share.
 *
 * WHY THIS FILE EXISTS. Menu, lobby, character select and game over are not HUD
 * components: each one owns the whole viewport. The kit deliberately ships no
 * full-viewport stage primitive — `SafeBox`, `Panel` and `Takeover` are all
 * `position:absolute` and assume a positioned, full-size ancestor — so every
 * screen has to hand-roll the same `position:fixed; inset:0; z-index` box.
 * TurnHud and PropertyListPanel each declare their own copy; four more copies
 * across four screens is where that stops being a pattern and starts being a
 * hazard, so the shell screens share these.
 *
 * NOTHING HERE IS A NEW DESIGN TOKEN. Every value is a `KIT.*` reference or
 * arithmetic on the kit's own layout numbers, documented at the point of use.
 */
import { KIT, SP_PX, turnStyle } from '../ui/kit';
import type { KitStyle } from '../ui/kit';

/**
 * The positioned full-viewport ancestor every kit surface needs, at the HUD
 * layer. Inert: `SafeBox` hands pointer events back to its own direct children,
 * so a stage that captured them would swallow every tap that lands in a gap.
 */
export const SHELL_STAGE: KitStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: KIT.zHud,
  pointerEvents: 'none',
  fontFamily: KIT.font,
  /*
   * KIT GAP, WORKED AROUND HERE. `.kit-takeover` sets `font-family` but no
   * `color`, and `.kit-takeover__title` sets none either — so a takeover title
   * inherits from <body>, which in this app is the UA default BLACK. "You win"
   * rendered black on a black takeover and was invisible until it was
   * photographed. Setting the text colour on the stage fixes every screen at
   * once; the real fix belongs on `.kit-takeover`.
   */
  color: KIT.text,
};

/**
 * The same stage for a screen whose content is a <Takeover>.
 *
 * TWO `position:fixed` STAGES CANNOT BE ORDERED BY AN INNER z-index. Each one
 * is its own stacking context, so `--z-takeover` (140) inside a `--z-hud` (110)
 * stage still loses to any sibling stage at 110+. The STAGE has to carry the
 * layer — this exact mistake put a migrated panel under the HUD earlier today.
 */
export const SHELL_STAGE_TAKEOVER: KitStyle = { ...SHELL_STAGE, zIndex: KIT.zTakeover };

/**
 * THE FLAT BACKDROP.
 *
 * The 3D scene is lazy-loaded and only mounts in-game (~1MB gzip), so a live
 * board behind the menu is not deliverable — putting one there would drag the
 * whole three/drei chunk onto the first paint of the app. This is the flat
 * treatment that replaces it: a night sky, a warm horizon where the city would
 * be, and a vignette, all from the kit's own colours. No image, no request, no
 * layout cost.
 *
 * `zIndex: --z-scene` so it sits exactly where the real canvas would.
 */
export const SHELL_BACKDROP: KitStyle = {
  position: 'absolute',
  inset: 0,
  zIndex: KIT.zScene,
  pointerEvents: 'none',
  backgroundColor: '#06060c',
  backgroundImage: [
    // Warm horizon — the city glow, bottom centre.
    'radial-gradient(150% 74% at 50% 114%, rgb(212 175 55 / 17%), rgb(212 175 55 / 5%) 40%, transparent 66%)',
    // Cool upper wash, offset left so the sky is not symmetrical.
    'radial-gradient(120% 92% at 16% -20%, rgb(52 152 219 / 13%), transparent 60%)',
    // Stars. Hand-placed rather than tiled: a repeating pattern reads as a
    // texture, and fourteen points read as a sky.
    'radial-gradient(1.5px 1.5px at 11% 17%, rgb(232 232 240 / 66%), transparent)',
    'radial-gradient(1.2px 1.2px at 23% 32%, rgb(232 232 240 / 44%), transparent)',
    'radial-gradient(1.6px 1.6px at 34% 11%, rgb(232 232 240 / 72%), transparent)',
    'radial-gradient(1.1px 1.1px at 44% 26%, rgb(232 232 240 / 38%), transparent)',
    'radial-gradient(1.5px 1.5px at 57% 9%, rgb(240 208 96 / 58%), transparent)',
    'radial-gradient(1.2px 1.2px at 66% 22%, rgb(232 232 240 / 46%), transparent)',
    'radial-gradient(1.7px 1.7px at 78% 14%, rgb(232 232 240 / 70%), transparent)',
    'radial-gradient(1.1px 1.1px at 88% 29%, rgb(232 232 240 / 40%), transparent)',
    'radial-gradient(1.3px 1.3px at 95% 8%, rgb(232 232 240 / 52%), transparent)',
    'radial-gradient(1.2px 1.2px at 6% 41%, rgb(232 232 240 / 34%), transparent)',
    'radial-gradient(1.4px 1.4px at 71% 38%, rgb(232 232 240 / 36%), transparent)',
    'radial-gradient(1.1px 1.1px at 29% 47%, rgb(232 232 240 / 28%), transparent)',
    // Ground band, so the horizon glow has something to sit behind.
    'linear-gradient(0deg, rgb(4 4 10 / 92%) 0%, rgb(4 4 10 / 30%) 13%, transparent 24%)',
    // Base sky.
    'linear-gradient(180deg, #0a0a17 0%, #08080f 54%, #050509 100%)',
  ].join(', '),
  boxShadow: 'inset 0 0 170px 46px rgb(0 0 0 / 74%)',
};

/**
 * FULL-HEIGHT RIGHT INTERACTIVE COLUMN.
 *
 * `ZoneAct` is bottom-anchored for a small in-game action cluster. The menu and
 * the lobby stack five or six controls, not two, so they need the whole right
 * third top to bottom. The width is the kit's own `--zone-act-w` (250), so the
 * 250 / 250 / 250 split still holds.
 *
 * RIGHT-ANCHORED, NOT `left: --zone-mid-x2`. The three zone widths sum to 750,
 * which is the safe box width on exactly one device (844 - 47 - 47). Pinning
 * this column's LEFT edge at 500 assumes that sum forever: measured at 60px
 * insets the safe box is 724 wide, and a column running 500->750 inside it put
 * "Create room", the skin button and the whole lobby control stack 26px past
 * the right safe edge and under the bezel. Anchoring the right edge instead
 * makes the column track whatever the safe box actually is. At 47px insets it
 * lands at 500 exactly as before, so nothing moves on the verified device.
 *
 * No `boxSizing` here any more: `index.css` sets border-box globally, so the
 * 12px block padding is taken out of the height `top:0; bottom:0` gives this
 * box rather than added to it. That is what this used to say inline.
 */
export const COL_ACT: KitStyle = {
  position: 'absolute',
  right: 0,
  top: 0,
  bottom: 0,
  width: KIT.zoneActW,
  padding: `${SP_PX[3]}px 0`,
  zIndex: KIT.zHudOver,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: KIT.tapGap,
};

/**
 * THE SCENE IS FROZEN AND HAS NO TURN TO REPORT.
 *
 * None of the shell screens are in-game, so none of them have a "whose turn" to
 * represent. `--turn` defaults to the blue player, and every turn-lit surface
 * in the kit reads it, so leaving it alone paints a false turn cue on a menu.
 *
 * The derived pair has to be re-stated. `--turn-soft` / `--turn-faint` are
 * declared on `:root` as `color-mix(… var(--turn) …)`, and a custom property's
 * `var()` is substituted where the property is DECLARED — re-declaring `--turn`
 * further down the tree leaves both still resolved against the root blue.
 * Restating them HERE, on the same element, is what makes them follow.
 */
export const NEUTRAL_TURN: KitStyle = turnVars('#555570');

/** Sets `--turn` and both of its derivations for a subtree. See NEUTRAL_TURN. */
export function turnVars(hex: string): KitStyle {
  return {
    ...turnStyle(hex),
    '--turn-soft': `color-mix(in srgb, ${hex} 30%, transparent)`,
    '--turn-faint': `color-mix(in srgb, ${hex} 13%, transparent)`,
  };
}

/** 11px caps, secondary colour — the caption above a block of read-only value. */
export const CAP_LINE: KitStyle = {
  font: `600 ${KIT.fsMicro}/1.22 ${KIT.font}`,
  textTransform: 'uppercase',
  letterSpacing: KIT.lsWider,
  color: KIT.text2,
  margin: 0,
};
