import * as THREE from 'three';
import { launchFlag } from '../dev/urlFlags';
import { setDebugVisibility } from '../dev/debugVisibility';
import { BOARD_SPACES } from '../constants/board';
import { TOKEN_HEX } from '../constants/theme';
import type { Partnership, Player, PropertyState } from '../types/GameState';
import { BOARD_WORLD_SIZE, tileToWorld } from './positions';
import { CLICK_TARGET_SPACES } from './clickTargets';

/**
 * ── OWNED-TILE GLOW — pure layout + ownership→colour logic ────────────────────
 *
 * Everything the owned-tile glow layer needs that is NOT React: the per-tile quad
 * footprint/transform, the ownership → band-colour derivation, and the geometry +
 * material factories. Split out of OwnedTileGlow.tsx so it can be unit-tested with
 * no renderer and no R3F, exactly like clickTargets.ts does for the pickers.
 *
 * WHAT IT DRAWS
 * -------------
 * ONE instanced, flat, soft-edged quad per purchasable space (28), sharing the
 * click-target instance ordering (CLICK_TARGET_SPACES) so instance `i` is the same
 * board space in both layers. Per tile the quad shows:
 *   - an interior WASH at GLOW_FILL of the peak, low enough that the printed name and
 *     price read straight through it,
 *   - a RIM ridge ramping up to the peak over the outer GLOW_RIM_W of the tile,
 *   - a short outward HALO (GLOW_FEATHER world units) that fades to nothing,
 * all tinted by the owner's TOKEN_HEX colour. Tiles held through an ACTIVE partnership
 * are split into equity-proportional BANDS along the tile's row axis, one per partner,
 * separated by a dark seam. Unowned tiles are collapsed to a ZERO-SCALE instance
 * (degenerate triangles → no fragments), so an early game costs essentially nothing.
 *
 * WHY A HAND-SHAPED QUAD AND NOT AN EMISSIVE MATERIAL
 * ---------------------------------------------------
 * There is NO bloom pass on the mobile pipeline (composite → FXAA → Sharpen →
 * PreExposure → ACES → HueSaturation → BrightnessContrast → WarmGrade → sRGB), so an
 * emissive MeshStandardMaterial would render as a flat brighter patch with a hard
 * polygon edge, not a glow. The halo is therefore FAKED in the material: a signed
 * rounded-box distance field gives the soft edge, and a custom blend composites the
 * result over whatever the board already rendered. No post pass is added.
 *
 * It also sidesteps the iOS shadow landmine: this is an UNLIT ShaderMaterial with
 * `lights: false`, so `renderer.shadowMap.enabled` (TRUE during the mobile BOARD
 * pass) injects no shadow GLSL into it and there is no mediump/highp program to be
 * rejected — unlike a MeshStandardMaterial, which would inherit that risk.
 *
 * COLOUR SPACE: every pass renders into a LINEAR-HDR render target and the grade
 * chain does the single sRGB encode at present time, so the fragment shader writes
 * LINEAR radiance directly (no colorspace_fragment, no tonemapping_fragment). The
 * band colours below are therefore three `Color`s in the linear working space
 * (ColorManagement converts TOKEN_HEX's sRGB hex on `setStyle`).
 */

// ── Tile footprint, DERIVED from positions.ts (never hardcoded) ───────────────
// A regular (non-corner) board tile is TILE_W wide along its row and TILE_D deep
// from the board's outer edge inward. Both come straight out of the ring math:
//   TILE_W = centre-to-centre spacing of two adjacent bottom-row tiles,
//   TILE_D = twice the distance from the board edge (BOARD_WORLD_SIZE/2) to a
//            bottom-row tile centre.
// All 28 purchasable spaces are regular tiles (the four corners are GO / Jail /
// Free Parking / Go To Jail and are never purchasable), so one size fits all.
export const GLOW_TILE_W = Math.abs(tileToWorld(1)[0] - tileToWorld(2)[0]);
export const GLOW_TILE_D = 2 * (BOARD_WORLD_SIZE / 2 - tileToWorld(1)[2]);

/** World units the halo reaches PAST the printed tile edge before hitting zero. */
export const GLOW_FEATHER = 0.07;
/** World units the rim ridge reaches INWARD from the tile edge before the fill. */
export const GLOW_RIM_W = 0.14;
/** Interior plateau level as a fraction of the rim peak (keeps the artwork readable). */
export const GLOW_FILL = 0.55;
/** Half-width (world units, along the row axis) of the dark seam between partner bands. */
export const GLOW_SEAM_W = 0.045;
/** How deeply the partner seam cuts the glow (0 = invisible seam, 1 = fully dark). */
export const GLOW_SEAM_DEPTH = 0.85;

/** Quad size — the tile plus a feather margin on every side, so the halo has room. */
export const GLOW_QUAD_W = GLOW_TILE_W + 2 * GLOW_FEATHER;
export const GLOW_QUAD_D = GLOW_TILE_D + 2 * GLOW_FEATHER;

/**
 * World Y of the glow quads — above the board artwork plane (0.02) so they draw over
 * the print. depthWrite is off, so the board's own depth is what the mobile composite
 * sees; that is what keeps the glow clipped to the board footprint and correctly
 * occluded by tokens/houses. Ordering against the token blob shadow is decided by
 * renderOrder, not by Y (neither writes depth), so the blob still darkens the glow.
 *
 * WHY IT IS NOT 0.0245 (measured, not guessed): the board's TOP material carries
 * polygonOffset(-1, -1), which pulls it toward the camera by roughly one pixel's worth
 * of DEPTH SLOPE. At the near board edge the bottom row's 1.34 world units of tile
 * depth cover ~155 screen pixels, i.e. ~0.009 world units per pixel — so the offset
 * board plane sat NEARER than a glow quad 0.0045 above it and the depth test threw the
 * whole tile face away. The symptom was pathological: the only glow that survived was
 * the sliver hanging past the board edge, where there is no top plane to lose to.
 * The clearance below is paired with GLOW_POLYGON_OFFSET, which beats the board's
 * offset by construction at any camera angle or distance rather than by a fixed
 * world-space guess.
 */
export const GLOW_Y = 0.028;

/**
 * polygonOffset factor/units for the glow. The board top uses (-1, -1); the glow uses
 * a larger negative so it is ALWAYS pulled in front of the board top, at every angle
 * and distance (polygon offset scales with the primitive's own depth slope, so unlike
 * a world-space Y gap it cannot be defeated by a grazing view of the far row).
 */
export const GLOW_POLYGON_OFFSET = -4;

/**
 * ── HOW THE GLOW SURVIVES BOTH GRADES: COVER + EMIT ───────────────────────────
 *
 * A PURELY ADDITIVE glow does not work here, and this was measured, not assumed: the
 * first build was `dst + col*peak` and it was clearly visible where it spilled onto
 * the board's dark outer margin and INVISIBLE on the printed tile face — a pixel-level
 * A/B of glow-on vs glow-off screenshots showed a delta of exactly ZERO across the
 * whole tile. The lit board sits high on the ACES curve, where a modest addition is
 * worth a handful of 8-bit levels; adding enough to be seen there would make the same
 * glow read as a torch on a dark tile.
 *
 * So the blend is PREMULTIPLIED (src = ONE, dst = ONE_MINUS_SRC_ALPHA):
 *
 *      result = col * shape * EMIT   +   board * (1 − shape * COVER)
 *               └── the light it adds ┘   └── the board it covers ──┘
 *
 * COVER is what makes it read on a BRIGHT board (it displaces a fraction of whatever
 * is underneath, so the hue lands regardless of how blown out the board is), and EMIT
 * is what makes it read on a DARK one. Only EMIT is mode-dependent.
 *
 * NIGHT-GRADE BLACK CRUSH: the night grade (exposure 0.95 → ACES → saturation −0.1 →
 * BrightnessContrast +0.22) maps any linear radiance below ~0.029 to pure black.
 * GLOW_EMIT_NIGHT is ~10× that floor, so even over a near-black tile the rim lands
 * around 0.3 linear (~175/255 on the night anchor curve) — clearly visible without
 * reading as a light source. Measured against the shipping night rig, whose board face
 * sits at ~0.27 linear (sampled 152/255 out, inverted through the night anchor table),
 * the rim reaches ~0.4 linear / ~205 out against a 152 board.
 *
 * GLOW_EMIT_DAY is larger because the day rig lights the same board several times
 * brighter; it was tuned on the DESKTOP day path (day HDRI + Bloom), which is the one
 * day render reachable without editing GameScene. Re-check it on mobile day if
 * MOBILE_NIGHT_MODE is ever flipped off.
 */
/** Peak fraction of the underlying board the rim displaces (mode-independent). */
export const GLOW_COVER = 0.18;
/** Peak LINEAR radiance the rim emits, in DAY lighting. */
export const GLOW_EMIT_DAY = 0.45;
/** Peak LINEAR radiance the rim emits, in NIGHT lighting. */
export const GLOW_EMIT_NIGHT = 0.3;

/**
 * MIRROR of GameScene's module-local `MOBILE_NIGHT_MODE`.
 *
 * The glow has to be tuned per lighting mode (see GLOW_PEAK_* above), but the real
 * flag is a compile-time const private to GameScene.tsx, which this layer cannot
 * import. OwnedTileGlow therefore takes an optional `night` prop and falls back to
 * this mirror: thread `night={isMobile && MOBILE_NIGHT_MODE}` into
 * `<BoardClickTargets />` from GameScene (one line, exactly like
 * `<CityDressing night={...} />` already does) and this constant stops mattering.
 * Until then it MUST be kept in step with MOBILE_NIGHT_MODE.
 *
 * Typed `boolean` (not the literal) so both branches type-check and survive in the
 * bundle for a rebuild-flip A/B, matching MOBILE_FOREST_SHADOWS_ENABLED.
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- the `boolean` annotation is the point: without it the type narrows to `true` and every `? day : night` branch becomes dead code, killing the rebuild-flip A/B (same pattern as MOBILE_FOREST_SHADOWS_ENABLED in positions.ts)
export const GLOW_NIGHT_MODE: boolean = true;

/**
 * DEV-only per-load override of the day/night glow tuning: `?glowNight=1` forces the
 * night peak, `?glowNight=0` forces the day peak. Lets the two tunings be A/B'd on a
 * real device (and screenshotted in both modes) without touching a shared file.
 * Returns null when there is no override. Tree-shaken out of production builds.
 *
 * *** THIS USED TO READ `window.location.search` AND HAD NEVER WORKED. ***
 * `useScreenRouting` navigates to a bare `/game`, which drops the query string,
 * and this is only ever consulted on the game screen — so from a fresh load the
 * override was always absent. It reads the BOOT-TIME snapshot now; see
 * `src/dev/urlFlags.ts` for the measurement and the reasoning.
 */
function glowNightOverride(): boolean | null {
  const v = launchFlag('glowNight');
  if (v === null) return null;
  return v !== '0' && v !== 'false';
}

/** Resolved day/night selection when the mount passes no explicit `night` prop. */
export function glowNightDefault(isMobile: boolean): boolean {
  return glowNightOverride() ?? (isMobile && GLOW_NIGHT_MODE);
}

/**
 * DEV-only per-load KILL SWITCH: `?glow=0` (or `?glow=false`) mounts no glow layer
 * at all.
 *
 * NOT THE SAME KNOB AS `?glowNight`, which only picks between the two peak-radiance
 * tunings and always renders. Until this existed there was NO way to turn the layer
 * off on a device — the only A/B available was a rebuild — which is exactly the
 * measurement a phone-side frame-budget question needs: the layer is fill-bound, and
 * fill cost is the one thing a desktop harness at dpr 2 cannot answer for a panel
 * rasterising at dpr 3. Pair it with `?nohud=1` to separate DOM cost from GPU cost.
 *
 * Absent, empty or any other value = glow ON, so a bare `?glow` cannot silently
 * disable it. Tree-shaken out of production builds: `launchFlag` folds to `null`
 * when `import.meta.env.DEV` is statically replaced with `false`, so this folds to
 * `return false`.
 *
 * Reads the LAUNCH query (see `src/dev/urlFlags.ts`): the router rewrites the URL
 * to a bare `/game` before this is ever consulted, and the first version of this
 * flag read `location.search` directly and was verified NOT to fire on the real
 * client — the glow was still rendering under `?glow=0`.
 *
 * NO LONGER GATES THE MOUNT. It used to be read once at the top of
 * `OwnedTileGlow` to skip mounting the layer entirely; see
 * `seedGlowDebugVisibility` below for what replaced that.
 */
export function glowDisabled(): boolean {
  const v = launchFlag('glow');
  return v === '0' || v === 'false';
}

/**
 * Seeds the `glow` DEBUG-VISIBILITY category's initial value from `?glow=0` (see
 * {@link glowDisabled}), so the Layers panel's "Owned-Tile Glow" toggle starts in
 * the state the launch URL asked for and can still flip it back on live — without
 * a reload, and without the instanced mesh ever unmounting. Called from
 * `OwnedTileGlow`'s mount effect, before it subscribes to the shared debug flags
 * (see `src/dev/debugVisibility.ts`).
 *
 * AT MOST ONCE PER PAGE LOAD, guarded by a module-level flag: `?glow=0` never
 * changes mid-session (it's the boot-time launch-query snapshot — see
 * urlFlags.ts), so re-running this after the dev has already flipped the panel
 * back on — e.g. on a rare GameScene remount — must not silently re-hide the
 * glow out from under them. Reset with `resetGlowDebugVisibilitySeedForTests`
 * in tests, mirroring `hudVisibility.ts#resetHudVisibleForTests`.
 *
 * A no-op when `?glow=0`/`?glow=false` was not passed at all. Exported (rather
 * than inlined in the R3F mount) so this seeding can be unit tested without a
 * renderer, exactly like every other pure function in this file.
 *
 * DEV-only in effect: `glowDisabled()` always returns `false` in production (see
 * above), so this becomes a guaranteed no-op there too.
 */
let glowDebugVisibilitySeeded = false;

export function seedGlowDebugVisibility(): void {
  if (glowDebugVisibilitySeeded) return;
  glowDebugVisibilitySeeded = true;
  if (glowDisabled()) setDebugVisibility('glow', false);
}

/** Seam for tests — see hudVisibility.ts#resetHudVisibleForTests for why this shape exists. */
export function resetGlowDebugVisibilitySeedForTests(): void {
  glowDebugVisibilitySeeded = false;
}

/** Intensity multiplier applied to a MORTGAGED tile (dead capital reads dimmer). */
export const GLOW_MORTGAGE_DIM = 0.35;
/** How far a mortgaged tile's colour is pulled toward its own luminance (grey). */
export const GLOW_MORTGAGE_DESAT = 0.78;

/**
 * Band boundary meaning "there is no further band". The fragment shader selects
 * bands with `step(split, s)` where `s ∈ [0,1]`, so any value > 1 can never fire —
 * a solo tile is literally "band A across the whole tile" with zero extra cost and
 * zero extra branches.
 */
export const GLOW_NO_BAND = 2;

/** Colour used when a band's player cannot be resolved (left the game mid-hand). */
const GLOW_UNKNOWN_HEX = '#8888a0';

/** Maximum bands the shader can show. Partnerships are 2–3 partners (see GameState). */
export const GLOW_MAX_BANDS = 3;

// ── Per-tile transform ────────────────────────────────────────────────────────

/**
 * Board side of a space: 0 = bottom row, 1 = left column, 2 = top row, 3 = right
 * column. Mirrors the ring construction in positions.ts (1–9 bottom, 11–19 left,
 * 21–29 top, 31–39 right), so it stays correct for every purchasable space.
 */
function glowTileSide(spaceIndex: number): number {
  return Math.floor(spaceIndex / 10) % 4;
}

/**
 * Y-rotation that aligns a glow quad with its tile: after the flat −90° X rotation
 * the quad's local +Y points along world −Z, so this yaw turns local +Y to face
 * INWARD (toward the board centre) and local +X to run ALONG the row. Both matter:
 * the tile footprint is anisotropic (GLOW_TILE_W × GLOW_TILE_D) and the partnership
 * bands are split along local +X.
 */
export function glowTileYaw(spaceIndex: number): number {
  //            bottom      left          top   right
  const yaws = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  return yaws[glowTileSide(spaceIndex)];
}

// Module-level scratch reused by glowInstanceMatrix — this runs at mount and on
// ownership changes only, never per frame, but keeping it allocation-free means the
// update path can be called from a store subscription without churning the GC.
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3(1, 1, 1);

/**
 * Compose the local transform for glow instance `i` into `out`: centred over its
 * board space at GLOW_Y, laid flat, and yawed so the quad's axes line up with the
 * tile's. `visible === false` collapses the instance to ZERO SCALE — the cheapest
 * possible hide, because degenerate triangles are dropped at rasterisation so an
 * unowned tile costs no fragments at all (this layer is fill-bound, not vertex-bound).
 */
export function glowInstanceMatrix(i: number, visible: boolean, out: THREE.Matrix4): THREE.Matrix4 {
  const spaceIndex = CLICK_TARGET_SPACES[i];
  const [wx, , wz] = tileToWorld(spaceIndex);
  _pos.set(wx, GLOW_Y, wz);
  // Order 'YXZ' composes as Ry(yaw) · Rx(−90°): flatten the quad first, THEN swing it
  // around to face its board side. One Euler, no intermediate quaternion.
  _euler.set(-Math.PI / 2, glowTileYaw(spaceIndex), 0, 'YXZ');
  _quat.setFromEuler(_euler);
  const s = visible ? 1 : 0;
  _scale.set(s, s, s);
  return out.compose(_pos, _quat, _scale);
}

// ── Ownership → glow bands ────────────────────────────────────────────────────

/**
 * GPU-ready description of ONE tile's glow. Filled in place by
 * {@link resolveGlowSpecInto} so an ownership change allocates nothing.
 *
 * `colorA/B/C` are LINEAR working-space colours, each normalised so its largest
 * channel is 1 (see resolveGlowSpecInto) — hue and saturation are preserved but the
 * raw brightness spread between token colours is not, otherwise a yellow owner would
 * glow ~3× brighter than a red one for the same tuning value.
 */
export interface GlowSpec {
  /** False when the tile is unowned — the instance is collapsed to zero scale. */
  visible: boolean;
  colorA: THREE.Color;
  colorB: THREE.Color;
  colorC: THREE.Color;
  /** Cumulative band boundary A→B in 0..1, or GLOW_NO_BAND when there is no band B. */
  split0: number;
  /** Cumulative band boundary B→C in 0..1, or GLOW_NO_BAND when there is no band C. */
  split1: number;
  /** Intensity multiplier: 1 for a live tile, GLOW_MORTGAGE_DIM when mortgaged. */
  intensity: number;
}

/** Allocate an empty {@link GlowSpec} (one per instance, reused forever). */
export function createGlowSpec(): GlowSpec {
  return {
    visible: false,
    colorA: new THREE.Color(),
    colorB: new THREE.Color(),
    colorC: new THREE.Color(),
    split0: GLOW_NO_BAND,
    split1: GLOW_NO_BAND,
    intensity: 1,
  };
}

/** True when `a` and `b` describe the same glow (used to skip GPU uploads). */
export function glowSpecEquals(a: GlowSpec, b: GlowSpec): boolean {
  if (a.visible !== b.visible) return false;
  if (!a.visible) return true; // hidden tiles: nothing else is read
  return a.split0 === b.split0
    && a.split1 === b.split1
    && a.intensity === b.intensity
    && a.colorA.equals(b.colorA)
    && a.colorB.equals(b.colorB)
    && a.colorC.equals(b.colorC);
}

/** Copy `src` into `dst` (no allocation) — the cache-write half of the diff. */
export function copyGlowSpec(dst: GlowSpec, src: GlowSpec): void {
  dst.visible = src.visible;
  dst.split0 = src.split0;
  dst.split1 = src.split1;
  dst.intensity = src.intensity;
  dst.colorA.copy(src.colorA);
  dst.colorB.copy(src.colorB);
  dst.colorC.copy(src.colorC);
}

/** One resolved band: a player's colour and their share of the tile. */
interface Band {
  hex: string;
  /** Raw equity percentage — normalised into a 0..1 fraction by the caller. */
  pct: number;
}

// Reused across resolveGlowSpecInto calls so the (rare) ownership-change path stays
// allocation-free. Never escapes this module.
const _bands: Band[] = [
  { hex: GLOW_UNKNOWN_HEX, pct: 0 },
  { hex: GLOW_UNKNOWN_HEX, pct: 0 },
  { hex: GLOW_UNKNOWN_HEX, pct: 0 },
];

function tokenHexOf(playerId: string, players: readonly Player[]): string {
  const p = players.find((q) => q.id === playerId);
  return p ? TOKEN_HEX[p.token] : GLOW_UNKNOWN_HEX;
}

/**
 * The ACTIVE partnership this tile is held through, or undefined when the tile is
 * solo-owned.
 *
 * A Partnership is per COLOUR GROUP, not per tile, and a group can be partnered while
 * an individual property in it belongs to somebody outside the pact — so the deed
 * holder must actually BE one of the partners for the tile to read as shared. Pending
 * (unaccepted) partnerships never count.
 */
function activePartnershipFor(
  spaceIndex: number,
  ownerId: string,
  partnerships: readonly Partnership[],
): Partnership | undefined {
  const group = BOARD_SPACES[spaceIndex].colorGroup;
  if (group === undefined) return undefined;
  return partnerships.find(
    (pt) => pt.status === 'active'
      && pt.colorGroup === group
      && pt.partners.some((e) => e.playerId === ownerId),
  );
}

/** Luminance the band colours are pulled toward (see normaliseGlowColor). */
const GLOW_REF_LUMA = 0.45;
/** 0 = no luminance equalisation, 1 = every band exactly GLOW_REF_LUMA. */
const GLOW_LUMA_EQUALISE = 0.5;

/**
 * Put a linear token colour on a common footing so ONE emission constant reads the
 * same for every player. Two steps, both hue- and saturation-preserving:
 *
 *  1. Full value — scale so the brightest channel is 1. Raw TOKEN_HEX values differ
 *     wildly in linear brightness (red #e74c3c peaks at 0.72, yellow #f1c40f at 0.88),
 *     which would make the glow arbitrarily stronger for some players.
 *  2. Half-way luminance equalisation — even at full value, green (#2ecc71, luma 0.74)
 *     is ~2× as bright to the eye as blue (#3498db, luma 0.39); this was visible in the
 *     first render, where the two green tiles shouted next to a blue one. Scaling by
 *     (REF/luma)^0.5 halves that spread in stops without fully flattening it (a full
 *     correction makes the deep-blue token look artificially hot).
 *
 * The result may exceed 1 per channel — that is fine and intended: the pass is LINEAR
 * HDR and the grade's ACES curve is what maps it back into range.
 */
function normaliseGlowColor(c: THREE.Color): void {
  const m = Math.max(c.r, c.g, c.b);
  if (m <= 1e-6) return;
  c.multiplyScalar(1 / m);
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (l > 1e-6) c.multiplyScalar(Math.pow(GLOW_REF_LUMA / l, GLOW_LUMA_EQUALISE));
}

/**
 * Resolve the glow for ONE board space into `out`, returning it.
 *
 * Band order is DEED HOLDER FIRST, then the remaining partners by descending equity
 * (playerId as a stable tie-break). Band A is therefore always "whoever holds this
 * deed" — the same slot on a solo tile and on a partnered one — while the band WIDTHS
 * carry the equity split. Widths are exact areas: the shader splits along the tile's
 * row axis, so a 60/40 pact paints 60%/40% of the tile.
 *
 * Pure: reads only its arguments and mutates only `out`. The common (solo) path is
 * allocation-free; the partnership branch allocates one small sorted array. Neither
 * runs per frame — this is only called when the store's properties/partnerships/players
 * arrays are actually replaced (see the reference check in OwnedTileGlow.tsx).
 */
export function resolveGlowSpecInto(
  out: GlowSpec,
  spaceIndex: number,
  properties: readonly PropertyState[],
  partnerships: readonly Partnership[],
  players: readonly Player[],
): GlowSpec {
  const prop = properties.find((p) => p.spaceIndex === spaceIndex);
  const ownerId = prop?.ownerId ?? null;
  if (prop === undefined || ownerId === null) {
    out.visible = false;
    return out;
  }

  // ── Bands ──────────────────────────────────────────────────────────────────
  const pact = activePartnershipFor(spaceIndex, ownerId, partnerships);
  let n = 0;
  _bands[0].hex = tokenHexOf(ownerId, players);
  _bands[0].pct = 100;
  n = 1;

  if (pact !== undefined) {
    const ownerEquity = pact.partners.find((e) => e.playerId === ownerId);
    _bands[0].pct = ownerEquity?.percentage ?? 0;
    // Remaining partners, descending equity, playerId as a stable tie-break.
    const others = pact.partners
      .filter((e) => e.playerId !== ownerId)
      .sort((a, b) => (b.percentage - a.percentage) || a.playerId.localeCompare(b.playerId));
    for (const e of others) {
      if (n >= GLOW_MAX_BANDS) {
        // More partners than the shader has bands: fold the tail into the last band
        // so the widths still sum to the whole tile.
        _bands[GLOW_MAX_BANDS - 1].pct += e.percentage;
        continue;
      }
      _bands[n].hex = tokenHexOf(e.playerId, players);
      _bands[n].pct = e.percentage;
      n++;
    }
  }

  // ── Cumulative split boundaries (equity-proportional, always summing to 1) ──
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.max(_bands[i].pct, 0);
  // Degenerate equity (all zero / negative) falls back to an even split so the tile
  // never vanishes into a single arbitrary colour.
  const even = total <= 0;
  let acc = 0;
  const boundary: number[] = [GLOW_NO_BAND, GLOW_NO_BAND];
  for (let i = 0; i < n - 1; i++) {
    acc += even ? 1 / n : Math.max(_bands[i].pct, 0) / total;
    boundary[i] = acc;
  }

  out.visible = true;
  out.split0 = boundary[0];
  out.split1 = boundary[1];
  out.intensity = prop.isMortgaged ? GLOW_MORTGAGE_DIM : 1;

  // ── Colours (sRGB hex → linear via ColorManagement, then full-value) ────────
  const slots = [out.colorA, out.colorB, out.colorC];
  for (let i = 0; i < GLOW_MAX_BANDS; i++) {
    // Unused slots repeat the last real band: `step` can never select them, but a
    // defined value keeps the buffer free of stale colours from a previous owner.
    const c = slots[i];
    c.setStyle(_bands[Math.min(i, n - 1)].hex);
    normaliseGlowColor(c);
    if (prop.isMortgaged) {
      // Pull toward the colour's own luminance (ITU-R BT.709 weights on the LINEAR
      // channels): a mortgaged tile reads as a washed, dim ghost of the owner's
      // colour instead of a second live colour.
      const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      c.setRGB(
        THREE.MathUtils.lerp(c.r, l, GLOW_MORTGAGE_DESAT),
        THREE.MathUtils.lerp(c.g, l, GLOW_MORTGAGE_DESAT),
        THREE.MathUtils.lerp(c.b, l, GLOW_MORTGAGE_DESAT),
        THREE.LinearSRGBColorSpace,
      );
    }
  }

  return out;
}

// ── Geometry + material factories ─────────────────────────────────────────────

/** Per-instance attribute names, shared by the factory and the writer. */
export const GLOW_ATTR = {
  colorA: 'aColorA',
  colorB: 'aColorB',
  colorC: 'aColorC',
  split: 'aSplit',
  glow: 'aGlow',
} as const;

/**
 * The instanced quad geometry: ONE plane sized GLOW_QUAD_W × GLOW_QUAD_D (so the
 * vertex `position.xy` IS the local offset from the tile centre in world units — the
 * fragment shader can run its distance field directly on it, with no extra uniforms
 * and no per-instance scale), plus the five per-instance attributes.
 */
export function buildGlowGeometry(count: number): THREE.BufferGeometry {
  const geom = new THREE.PlaneGeometry(GLOW_QUAD_W, GLOW_QUAD_D);
  geom.setAttribute(GLOW_ATTR.colorA, new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
  geom.setAttribute(GLOW_ATTR.colorB, new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
  geom.setAttribute(GLOW_ATTR.colorC, new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
  geom.setAttribute(GLOW_ATTR.split, new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2));
  geom.setAttribute(GLOW_ATTR.glow, new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
  return geom;
}

const GLOW_VERT = /* glsl */ `
attribute vec3 aColorA;
attribute vec3 aColorB;
attribute vec3 aColorC;
attribute vec2 aSplit;
attribute float aGlow;

varying vec2 vLocal;
varying vec3 vColA;
varying vec3 vColB;
varying vec3 vColC;
varying vec2 vSplit;
varying float vGlow;

void main() {
  // The plane is authored at quad size, so position.xy is already the offset from
  // the tile centre in WORLD units (the instance matrix carries no scale except the
  // 0/1 hide flag) — the fragment distance field needs nothing else.
  vLocal = position.xy;
  vColA = aColorA;
  vColB = aColorB;
  vColC = aColorC;
  vSplit = aSplit;
  vGlow = aGlow;

  vec4 mv = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    mv = instanceMatrix * mv;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * mv;
}
`;

/**
 * Fragment shader. All shape constants are baked in from the exported tunables so
 * there is exactly ONE uniform (uEmit) and no per-instance uniform traffic.
 *
 * NO DERIVATIVES: the seam and edge softness use fixed world-space widths rather than
 * fwidth(). dFdx/fwidth in a GLSL ES 1.00 shader depends on an extension whose
 * availability differs between WebGL1/WebGL2 contexts, and a shader that fails to
 * compile on iOS renders INVISIBLE rather than broken — not worth the risk for
 * antialiasing that a fixed-width smoothstep already provides at this scale.
 */
function glowFragmentShader(): string {
  const f = (n: number) => n.toFixed(5);
  return /* glsl */ `
uniform float uEmit;

varying vec2 vLocal;
varying vec3 vColA;
varying vec3 vColB;
varying vec3 vColC;
varying vec2 vSplit;
varying float vGlow;

const vec2  TILE_HALF  = vec2(${f(GLOW_TILE_W / 2)}, ${f(GLOW_TILE_D / 2)});
const float FEATHER    = ${f(GLOW_FEATHER)};
const float RIM_W      = ${f(GLOW_RIM_W)};
const float FILL       = ${f(GLOW_FILL)};
const float INV_TILE_W = ${f(1 / GLOW_TILE_W)};
const float SEAM_W     = ${f(GLOW_SEAM_W / GLOW_TILE_W)};
const float SEAM_DEPTH = ${f(GLOW_SEAM_DEPTH)};
const float COVER      = ${f(GLOW_COVER)};

void main() {
  // Signed distance to the printed tile rectangle: <0 inside, 0 on the edge, >0 out.
  vec2 e = abs(vLocal) - TILE_HALF;
  float sd = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);

  // Profile: a ridge centred on the tile edge, a low plateau inside it, and a short
  // halo outside it. The outside term is 1 everywhere inside, so the interior is flat.
  float outside = 1.0 - smoothstep(0.0, FEATHER, sd);
  float rim = smoothstep(-RIM_W, 0.0, sd);
  float shape = outside * (FILL + (1.0 - FILL) * rim);

  // Ownership bands run along the tile's ROW axis (local X) — a seam perpendicular
  // to the board edge, which no printed feature on the tile shares. s is the
  // position across the tile in 0..1.
  float s = clamp(vLocal.x * INV_TILE_W + 0.5, 0.0, 1.0);
  vec3 col = vColA;
  col = mix(col, vColB, step(vSplit.x, s));
  col = mix(col, vColC, step(vSplit.y, s));

  // Dark gap on each band boundary so a shared tile reads as two separated blocks
  // rather than an ambiguous colour ramp. Solo tiles carry split = GLOW_NO_BAND (2),
  // which is off the 0..1 range, so no seam is ever cut.
  float g = max(1.0 - smoothstep(0.0, SEAM_W, abs(s - vSplit.x)),
                1.0 - smoothstep(0.0, SEAM_W, abs(s - vSplit.y)));
  shape *= (1.0 - SEAM_DEPTH * g) * vGlow;

  // PREMULTIPLIED output: rgb is the LINEAR radiance this layer emits, alpha is how
  // much of the board underneath it displaces. The blend (ONE, ONE_MINUS_SRC_ALPHA)
  // turns that into  col*shape*uEmit + board*(1 - shape*COVER)  — see the COVER/EMIT
  // note in this file for why a purely additive version is invisible in day light.
  gl_FragColor = vec4(col * (shape * uEmit), shape * COVER);
}
`;
}

/**
 * The glow material: unlit, premultiplied-alpha, depth-tested but NOT depth-writing.
 *
 * CustomBlending with src = ONE and dst = ONE_MINUS_SRC_ALPHA (premultiplied "over"),
 * NOT THREE.AdditiveBlending: additive alone cannot be seen on the day board (measured
 * — see the COVER/EMIT note above), and THREE.NormalBlending would multiply the colour
 * by alpha and so couple emission to coverage. The ALPHA channel is written with
 * (ZERO, ONE) so the destination alpha is left exactly as the board slab left it —
 * only rgb is touched.
 *
 * depthWrite=false is load-bearing on mobile: the composite merges the board pass and
 * the scene pass BY DEPTH, so leaving the board slab's depth untouched is what clips
 * the glow to the board footprint and lets tokens/houses (scene pass, nearer) occlude
 * it correctly.
 */
export function buildGlowMaterial(emit: number): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uEmit: { value: emit } },
    vertexShader: GLOW_VERT,
    fragmentShader: glowFragmentShader(),
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    // Beat the board top's own polygonOffset(-1,-1) — see GLOW_POLYGON_OFFSET.
    polygonOffset: true,
    polygonOffsetFactor: GLOW_POLYGON_OFFSET,
    polygonOffsetUnits: GLOW_POLYGON_OFFSET,
  });
  // Explicit highp, matching the pattern used for every material that must survive
  // the iOS/Metal compiler (see the forest ground). This shader has no lights and no
  // shadow chunks, so it is not exposed to the mediump shadow-injection failure at
  // all — highp here is belt-and-braces and costs nothing at 28 quads.
  mat.precision = 'highp';
  // The board opts out of scene fog; the glow lives on the board, so it must too.
  // (ShaderMaterial has no fog chunks anyway — this documents the intent.)
  mat.fog = false;
  return mat;
}
