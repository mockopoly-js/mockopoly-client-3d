/**
 * DESIGN TOKENS — the TypeScript half of the token layer.
 *
 * WHY TWO HALVES
 * --------------
 * `kit.css` owns the values (a `:root` block of CSS custom properties).
 * This file owns the *names*, as `var(--x)` strings, so that the app's existing
 * inline-style call sites can consume the same tokens with no build step, no
 * CSS-in-JS runtime and no new dependency:
 *
 *     style={{ padding: KIT.sp3, color: KIT.text2, borderRadius: KIT.rLg }}
 *
 * A `var()` string is a perfectly ordinary CSS value; React passes it straight
 * through. That is the whole trick, and it is why the token layer works
 * unchanged in a codebase that is 100% inline styles today and will be a mix of
 * inline styles and `kit-*` classes tomorrow.
 *
 * WHERE JS NEEDS A REAL NUMBER (layout maths, matchMedia, tests, canvas), use
 * the numeric constants at the bottom: TAP_MIN, FS_PX, SA_PX, PANEL_W, DUR_MS.
 * `kit.tokens.test.ts` parses kit.css and asserts every one of them still
 * equals the CSS, so the two halves cannot drift.
 *
 * COLOUR DATA lives in `src/constants/theme.ts` (TOKEN_HEX, COLOR_GROUP_HEX).
 * Those are DATA — a player's token colour and a property's group colour are
 * game state, not design decisions — and they stay the source of truth. The
 * `--p-*` / `--grp-*` CSS variables mirror them 1:1 and the same test asserts
 * it. Use TOKEN_HEX when you need the hex (three.js materials, canvas); use
 * KIT.player.red when you are styling DOM.
 */
import type { CSSProperties } from 'react';

/**
 * A style object that may also carry CSS custom properties.
 * React accepts `--x` keys at runtime but `CSSProperties` does not type them,
 * so use this wherever you set `--pc`, `--gc`, `--turn`, `--digits`, `--pct`.
 */
export type KitStyle = CSSProperties & Partial<Record<`--${string}`, string | number>>;

/**
 * Merge CSS custom properties into a style object for a DOM element.
 *
 * React's `style` prop is typed `CSSProperties`, which has no index signature
 * for `--x` keys, so an inline object literal containing one is rejected by
 * excess-property checking even though React passes it through perfectly at
 * runtime. Spreading through this function widens it to `CSSProperties` without
 * a cast, so no primitive has to write `as CSSProperties` at a call site.
 *
 *     <div style={withVars({ '--pc': color }, style)} />
 */
export function withVars(
  vars: Partial<Record<`--${string}`, string | number>>,
  style?: KitStyle,
): CSSProperties {
  return { ...vars, ...style };
}

/** Every token, as a `var()` reference. Safe in any inline style. */
export const KIT = {
  // ── surfaces ──────────────────────────────────────────────────────────────
  surfaceVoid: 'var(--surface-void)',
  surfacePanel: 'var(--surface-panel)',
  surfaceRaised: 'var(--surface-raised)',
  surfaceSunken: 'var(--surface-sunken)',
  surfaceGlass: 'var(--surface-glass)',
  surfaceGlassSoft: 'var(--surface-glass-soft)',
  surfaceScrim: 'var(--surface-scrim)',
  surfaceScrimHeavy: 'var(--surface-scrim-heavy)',

  // ── borders ───────────────────────────────────────────────────────────────
  border: 'var(--border)',
  borderSoft: 'var(--border-soft)',
  borderLit: 'var(--border-lit)',
  borderW: 'var(--border-w)',
  borderW2: 'var(--border-w-2)',

  // ── text colours. NEVER use opacity to de-emphasise text (rule R3) ────────
  text: 'var(--text)',
  text2: 'var(--text-2)',
  /** 2.6:1 — DECORATIVE ONLY. Dividers, disabled glyphs, locked rows. */
  text3: 'var(--text-3)',
  textOnGold: 'var(--text-on-gold)',
  textOnAccent: 'var(--text-on-accent)',

  // ── accent ────────────────────────────────────────────────────────────────
  gold: 'var(--gold)',
  goldBright: 'var(--gold-bright)',
  goldDim: 'var(--gold-dim)',
  goldGlow: 'var(--gold-glow)',

  // ── semantic ──────────────────────────────────────────────────────────────
  success: 'var(--success)',
  successBright: 'var(--success-bright)',
  warn: 'var(--warn)',
  warnBright: 'var(--warn-bright)',
  danger: 'var(--danger)',
  dangerBright: 'var(--danger-bright)',
  info: 'var(--info)',

  // ── active-player colour. Set once with turnStyle(hex); everything follows ─
  turn: 'var(--turn)',
  turnSoft: 'var(--turn-soft)',
  turnFaint: 'var(--turn-faint)',

  // ── type scale, in RENDERED px. 11px is an absolute floor ─────────────────
  fsMicro: 'var(--text-micro)',
  fsMicroLg: 'var(--text-micro-lg)',
  fsLabel: 'var(--text-label)',
  fsLabelLg: 'var(--text-label-lg)',
  fsGlance: 'var(--text-glance)',
  fsGlanceLg: 'var(--text-glance-lg)',
  fsHero: 'var(--text-hero)',
  fsHeroLg: 'var(--text-hero-lg)',
  /** BRAND ONLY: wordmark, winner name. Never functional UI. */
  fsDisplay: 'var(--text-display)',

  lhFlat: 'var(--lh-flat)',
  lhTight: 'var(--lh-tight)',
  lhSnug: 'var(--lh-snug)',
  lhBody: 'var(--lh-body)',

  lsTight: 'var(--ls-tight)',
  lsNone: 'var(--ls-none)',
  lsWide: 'var(--ls-wide)',
  lsWider: 'var(--ls-wider)',
  lsWidest: 'var(--ls-widest)',

  font: 'var(--font)',
  fontMono: 'var(--font-mono)',

  // ── spacing, 4px base ─────────────────────────────────────────────────────
  spHair: 'var(--sp-hair)',
  sp1: 'var(--sp-1)',
  sp2: 'var(--sp-2)',
  sp3: 'var(--sp-3)',
  sp4: 'var(--sp-4)',
  sp5: 'var(--sp-5)',
  sp6: 'var(--sp-6)',
  sp7: 'var(--sp-7)',
  sp8: 'var(--sp-8)',
  sp9: 'var(--sp-9)',

  // ── radii ─────────────────────────────────────────────────────────────────
  rXs: 'var(--r-xs)',
  rSm: 'var(--r-sm)',
  rMd: 'var(--r-md)',
  rLg: 'var(--r-lg)',
  rXl: 'var(--r-xl)',
  r2xl: 'var(--r-2xl)',
  rPill: 'var(--r-pill)',

  // ── elevation ─────────────────────────────────────────────────────────────
  shadow1: 'var(--shadow-1)',
  shadow2: 'var(--shadow-2)',
  shadow3: 'var(--shadow-3)',
  shadow4: 'var(--shadow-4)',
  shadow5: 'var(--shadow-5)',
  liftTop: 'var(--lift-top)',
  ringHair: 'var(--ring-hair)',
  ringGold: 'var(--ring-gold)',
  ringFocus: 'var(--ring-focus)',
  glowGold: 'var(--glow-gold)',
  glowTurn: 'var(--glow-turn)',
  /** MANDATORY on any text sitting directly on the 3D world. */
  textLegible: 'var(--text-legible)',
  textCarve: 'var(--text-carve)',

  // ── blur. One blurred layer per screen, maximum (rule R5) ─────────────────
  blurSm: 'var(--blur-sm)',
  blurMd: 'var(--blur-md)',
  blurLg: 'var(--blur-lg)',

  // ── z-index. Never write a raw z-index ────────────────────────────────────
  zScene: 'var(--z-scene)',
  zSceneFx: 'var(--z-scene-fx)',
  zWorld: 'var(--z-world)',
  zHudUnder: 'var(--z-hud-under)',
  zHud: 'var(--z-hud)',
  zHudOver: 'var(--z-hud-over)',
  zToast: 'var(--z-toast)',
  zScrim: 'var(--z-scrim)',
  zPanel: 'var(--z-panel)',
  zTakeover: 'var(--z-takeover)',
  zGuides: 'var(--z-guides)',
  zDev: 'var(--z-dev)',

  // ── motion ────────────────────────────────────────────────────────────────
  durInstant: 'var(--dur-instant)',
  durTap: 'var(--dur-tap)',
  durFeedback: 'var(--dur-feedback)',
  durSwap: 'var(--dur-swap)',
  durScene: 'var(--dur-scene)',
  durPanel: 'var(--dur-panel)',
  durTakeover: 'var(--dur-takeover)',
  durLight: 'var(--dur-light)',
  durHold: 'var(--dur-hold)',
  durTurn: 'var(--dur-turn)',
  durTurnWarn: 'var(--dur-turn-warn)',
  easeOut: 'var(--ease-out)',
  easeIo: 'var(--ease-io)',
  easeIn: 'var(--ease-in)',
  /** OVERSHOOT. Celebratory beats only — wins, monopolies, building. */
  easeCelebrate: 'var(--ease-celebrate)',
  easeLinear: 'var(--ease-linear)',

  // ── safe area. DO NOT ADD PADDING TO THESE — use sa() below ───────────────
  saL: 'var(--sa-l)',
  saR: 'var(--sa-r)',
  saT: 'var(--sa-t)',
  saB: 'var(--sa-b)',

  // ── layout + tap geometry ─────────────────────────────────────────────────
  zoneReadW: 'var(--zone-read-w)',
  zoneMidX1: 'var(--zone-mid-x1)',
  zoneMidX2: 'var(--zone-mid-x2)',
  zoneActW: 'var(--zone-act-w)',
  panelW: 'var(--panel-w)',
  tapMin: 'var(--tap-min)',
  tapPrimary: 'var(--tap-primary)',
  tapLg: 'var(--tap-lg)',
  tapGap: 'var(--tap-gap)',
  btnFs: 'var(--btn-fs)',
  btnFsPrimary: 'var(--btn-fs-primary)',
  btnWPrimary: 'var(--btn-w-primary)',
  rowPad: 'var(--row-pad)',
  badgeReserve: 'var(--badge-reserve)',
  deedRow: 'var(--deed-row)',

  // ── palettes (DOM styling only — see the header note) ─────────────────────
  player: {
    red: 'var(--p-red)',
    blue: 'var(--p-blue)',
    green: 'var(--p-green)',
    yellow: 'var(--p-yellow)',
    purple: 'var(--p-purple)',
    orange: 'var(--p-orange)',
    cyan: 'var(--p-cyan)',
    pink: 'var(--p-pink)',
  },
  group: {
    brown: 'var(--grp-brown)',
    'light-blue': 'var(--grp-light-blue)',
    pink: 'var(--grp-pink)',
    orange: 'var(--grp-orange)',
    red: 'var(--grp-red)',
    yellow: 'var(--grp-yellow)',
    green: 'var(--grp-green)',
    'dark-blue': 'var(--grp-dark-blue)',
    /** #2b2b2b vanishes on dark surfaces — use groupOnDark() instead. */
    railroad: 'var(--grp-railroad)',
    utility: 'var(--grp-utility)',
  },
  /** Lifted railroad, for dark surfaces (board bands, dark deed heads). */
  groupRailroadLift: 'var(--grp-railroad-lift)',
} as const;

// ────────────────────────────────────────────────────────────────────────────
// TYPE PRESETS — the scale as ready-made inline-style objects.
// Sizes are RENDERED px with a hard floor of 11. Do not invent an intermediate
// size; if none of these fits, the layout is wrong, not the scale.
// ────────────────────────────────────────────────────────────────────────────
const base: CSSProperties = { fontFamily: KIT.font, margin: 0 };

export const TYPE = {
  /** 32/800 — BRAND ONLY. Wordmark, winner name. Never functional UI. */
  display: { ...base, fontSize: 32, fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.2px' },
  /** 24/700 — my cash, primary button label, screen titles. */
  hero: { ...base, fontSize: 24, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.2px' },
  /** 26/800 — the single most important number on screen. */
  heroLg: { ...base, fontSize: 26, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.2px' },
  /** 15/600 — opponent cash, whose-turn, rent amounts. */
  glance: { ...base, fontSize: 15, fontWeight: 600, lineHeight: 1.08 },
  /** 17/700 — glance values that must win a scan; primary button label. */
  glanceLg: { ...base, fontSize: 17, fontWeight: 700, lineHeight: 1.08 },
  /** 13/500 — player names, secondary labels, panel headings. */
  label: { ...base, fontSize: 13, fontWeight: 500, lineHeight: 1.22 },
  /** 14/600 — the same roles when they lead a block. */
  labelLg: { ...base, fontSize: 14, fontWeight: 600, lineHeight: 1.22 },
  /** 11/600 — ABSOLUTE FLOOR. Set counts, badges, timestamps, unit suffixes. */
  micro: { ...base, fontSize: 11, fontWeight: 600, lineHeight: 1.22 },
  /** 12/600 — micro that needs slightly more presence. */
  microLg: { ...base, fontSize: 12, fontWeight: 600, lineHeight: 1.22 },
  /** 14/400/1.38 — running copy (taglines, rules text). */
  body: { ...base, fontSize: 14, fontWeight: 400, lineHeight: 1.38 },
} as const satisfies Record<string, CSSProperties>;

/** Uppercase + tracking. Caps get tracking; lowercase mostly does not. */
export const CAPS: CSSProperties = { textTransform: 'uppercase', letterSpacing: '0.8px' };
/** Tabular figures, so a changing number never reflows its neighbours. */
export const NUM: CSSProperties = { fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.2px' };
/** MANDATORY on text sitting directly on the 3D world with no panel behind it. */
export const LEGIBLE: CSSProperties = { textShadow: KIT.textLegible };

// ────────────────────────────────────────────────────────────────────────────
// REAL NUMBERS — for layout maths, matchMedia, canvas and tests.
// kit.tokens.test.ts asserts each of these still equals the value in kit.css.
// ────────────────────────────────────────────────────────────────────────────

/** Apple HIG minimum, 44x44pt. The floor for any routine interactive. */
export const TAP_MIN = 44;
/** The primary turn action only. Nothing else goes above 44 except TAP_LG. */
export const TAP_PRIMARY = 48;
/** The one oversized icon button, if a screen needs one. */
export const TAP_LG = 52;
/** Minimum dead space between two adjacent interactives. */
export const TAP_GAP = 12;
/** Inline padding for ANY full-bleed row; clears the 2px inset accent bar. */
export const ROW_PAD = 12;
/** Held back on the right of the action cluster so a corner badge can overhang. */
export const BADGE_RESERVE = 8;
/** Right slide-in panel width, INCLUDING the right safe inset. */
export const PANEL_W = 392;
export const PANEL_W_NARROW = 312;
export const PANEL_W_WIDE = 472;
/** Min-width of the primary CTA. */
export const BTN_W_PRIMARY = 176;
/** Deed / ladder row height. */
export const DEED_ROW = 24;
/** Nothing renders below this. The one exemption was the mockups' dev strip. */
export const TYPE_FLOOR_PX = 11;

/** The type scale in rendered px. */
export const FS_PX = {
  micro: 11, microLg: 12, label: 13, labelLg: 14,
  glance: 15, glanceLg: 17, hero: 24, heroLg: 26, display: 32,
} as const;

/** The 4px spacing scale. */
export const SP_PX = {
  hair: 2, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 32, 8: 40, 9: 48,
} as const;

/**
 * A REFERENCE DEVICE'S SAFE-AREA INSETS. iPhone 13 Pro, landscape, measured:
 * 47 left, 47 right, 21 bottom, 0 top (symmetric on the long edges).
 *
 * *** THESE ARE NOT FLOORS AND NOTHING IN THE CSS USES THEM. *** They were,
 * until `--sa-*` baked them in as `max(47px, env(…))` — a device measurement
 * masquerading as a design token, which spent 47px a side on desktop browsers
 * that have no notch and made the `max(var(--sa-r), 14px)` at every call site
 * dead code, because 47 always won. The CSS custom properties are now pure
 * `env()`, so they report what the device reports and nothing else, and the
 * design gutter is chosen per surface at the call site by `sa(side, pad)`.
 *
 * What these numbers are still good for is TESTS: evaluating an inset
 * expression at a plausible device to check the arithmetic (see
 * ChromeCluster.test.tsx, which resolves the three chrome buttons' `right`
 * against SA_PX.r to prove their 52px pitch survives a real inset). Use them to
 * reason about a device; never to constrain the stylesheet.
 */
export const SA_PX = { l: 47, r: 47, t: 0, b: 21 } as const;

/** Motion durations in ms, for setTimeout / animation coordination. */
export const DUR_MS = {
  instant: 100, tap: 150, feedback: 200, swap: 250, scene: 320,
  panel: 400, takeover: 450, light: 900, hold: 1200,
} as const;

/** The z-index scale as numbers, for the rare case a portal needs one. */
export const Z = {
  scene: 100, sceneFx: 102, world: 104, hudUnder: 108, hud: 110, hudOver: 114,
  toast: 120, scrim: 130, panel: 134, takeover: 140, guides: 190, dev: 200,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Safe inset combined with interior padding — the ONLY correct way.
 *
 *     paddingRight: sa('r', 14)   ->  max(var(--sa-r), 14px)
 *
 * THE SAFE INSET IS NOT INTERIOR PADDING AND THE TWO DO NOT STACK. An earlier
 * pass wrote `calc(var(--sa-r) + 14px)` and got a 61px right gutter with only
 * 285px of content in a 392px panel — 15.6% dead space, and the deed's colour
 * band visibly stopped short of the edge. 47px of bezel clearance is already
 * generous visual padding and needs no help. Take the larger, never the sum.
 */
export function sa(side: 'l' | 'r' | 't' | 'b', pad = 0): string {
  return pad > 0 ? `max(var(--sa-${side}), ${pad}px)` : `var(--sa-${side})`;
}

/**
 * Sets the active-player colour for a subtree. Every turn-lit surface
 * (primary button, pod, turn strip dot, glow) reads `--turn`.
 *
 *     <div style={turnStyle(TOKEN_HEX[currentPlayer.token])}>…</div>
 */
export function turnStyle(hex: string): KitStyle {
  return { '--turn': hex };
}

/** Sets a component's player colour (`--pc`): pods, turn strip, plates. */
export function playerStyle(hex: string): KitStyle {
  return { '--pc': hex };
}

/** Sets a component's colour-group (`--gc`): deed band, set swatch, pips. */
export function groupStyle(hex: string): KitStyle {
  return { '--gc': hex };
}

/**
 * Colour-group hex, lifted where the true value would vanish.
 * Railroad's real colour is #2b2b2b, which is invisible on every dark surface
 * in this system — board bands, deed heads, panel rows. Pass `onDark` for those.
 */
export function groupColor(hex: string, onDark = false): string {
  return onDark && hex.toLowerCase() === '#2b2b2b' ? '#4a4a58' : hex;
}
