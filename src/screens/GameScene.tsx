import { Suspense, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import {
  EffectComposer,
  N8AO,
  Bloom,
  ToneMapping,
  HueSaturation,
  BrightnessContrast,
  SMAA,
} from '@react-three/postprocessing';
// KernelSize enum for the MOBILE-ONLY tilt-shift blur kernel (see
// MOBILE_TILTSHIFT_* below + MobileCrispBoardPipeline). Imported from the base
// `postprocessing` package (the @react-three/postprocessing wrapper does not
// re-export it).
import { KernelSize } from 'postprocessing';
import { SoftShadows, Stats, useTexture } from '@react-three/drei';
import { BoardTiles } from '../board/BoardTiles';
import { PlayerTokens } from '../board/PlayerTokens';
import { Buildings } from '../board/Buildings';
import { CityDressing } from '../board/CityDressing';
import { ForestEnvironment } from '../board/ForestEnvironment';
import { Dice3D } from '../board/Dice3D';
import { CameraRig } from '../board/CameraRig';
import { BoardClickTargets } from '../board/BoardClickTargets';
import { ShaderWarmup } from '../board/ShaderWarmup';
import { MobileRenderController } from '../board/MobileRenderController';
import { MobileCrispBoardPipeline } from '../board/MobileCrispBoardPipeline';
import { RenderStatsReadout } from '../board/RenderStatsReadout';
import { BOARD_ROTATION, MOBILE_FOREST_SHADOWS_ENABLED } from '../board/positions';
import { getProceduralNightSky } from '../board/ProceduralSky';
import { NightStreetLights } from '../board/NightStreetLights';
import { useIsMobile } from '../ui/useIsMobile';

/**
 * Game screen: renders the static 3D board in a daylight diorama scene.
 *
 * Lighting (soft-GI look without path tracing — AO + a shaped 3-point rig do
 * the grounding that flat ambient used to fake):
 * - N8AO: screen-space ambient occlusion, FIRST effect in the composer. Darkens
 *   contacts/crevices (under buildings, trees, tokens, board edges) so objects
 *   read as sitting IN the scene instead of floating on a flat wash. Half-res
 *   for perf. Tunables: AO_INTENSITY / AO_RADIUS / AO_DISTANCE_FALLOFF.
 * - hemisphereLight: soft sky/ground fill (sky #cbe8f5, ground #8a9a5b),
 *   trimmed 0.35 → 0.25 so it tints unlit sides without flattening.
 * - ambientLight: trimmed 0.4 → 0.15 — AO now supplies the crevice darkening a
 *   high flat ambient was washing out; this just lifts pure black.
 * - directionalLight ×3 (key/fill/rim rig):
 *     KEY  — warm sun (KEY_COLOR), the ONLY shadow caster; position + 1024²
 *            shadow map + ortho bounds kept as before.
 *     FILL — cool, low, opposite-ish angle; softens the shadow side. No shadow.
 *     RIM  — cool-bright, high/behind; edge-lights tops for separation. No shadow.
 * - SoftShadows: drei helper (PCF soft shadows, no extra assets) with modest
 *   size/samples so shadow edges are feathered without tanking perf.
 * - CameraRig: drei OrbitControls tuned for tabletop overhead view + gentle
 *   auto-focus toward the active player's tile each turn.
 * - HdriSky: loads /images/sky.webp — a 2048x1024 equirectangular sky map —
 *   via useTexture, sets EquirectangularReflectionMapping + SRGBColorSpace, and
 *   assigns scene.environment (IBL/reflections) and optionally scene.background
 *   (visible sky). Suspends while loading via useTexture's Suspense contract.
 */

/**
 * HDRI tunables.
 * - ENV_INTENSITY: strength of the image-based lighting/reflections the sky
 *   contributes. Kept modest so the directional key light still dominates and
 *   Bloom doesn't blow out.
 * - BG_INTENSITY: brightness of the visible HDRI sky background.
 * - SHOW_HDRI_BACKGROUND: when true, the HDRI sky is rendered as the scene
 *   background (replacing the flat #cbe8f5 color). When false, the Environment
 *   only lights the scene and the flat <color> background is used instead.
 */
const ENV_INTENSITY = 0.6;
const BG_INTENSITY = 1.0;
const SHOW_HDRI_BACKGROUND = true;

/**
 * MOBILE-ONLY sky/env intensities (see HdriSkyMobile). REALISM SWAP: the mobile
 * branch now assigns the SAME real equirect /images/sky.webp desktop uses (read-only
 * reuse of the shared asset — the file and HdriSkyDesktop are untouched) to BOTH
 * scene.background AND scene.environment (IBL), REPLACING the old flat 16×512
 * procedural gradient. A real daylight equirect gives directional sky IBL
 * (blue-from-above, warm-from-horizon, sun-ward brightening) + believable reflection
 * variation instead of the gradient's uniform wash — the single biggest fix for the
 * "game-y / flat" mobile look.
 *
 * INTENSITY RETUNE: the real sky's average luminance (blue sky + darker ground) is
 * LOWER than the near-white procedural gradient, so env is RAISED 0.75 → 1.0 so the
 * ambient fill does not drop when the source swaps. This works WITH the new
 * MOBILE_EXPOSURE lever (a global multiplicative midtone lift, pre-tonemap): env
 * intensity supplies the shaded-side/ambient lift + directional realism, exposure
 * lifts the whole range. MOBILE_ENV_INTENSITY is a PRIMARY user nudge knob (TUNABLE
 * 0.85–1.2: raise to soften/flatten the shade back up, drop for deeper directional
 * contrast). LDR CAVEAT: sky.webp is 8-bit, so its 'sun' region caps at ~1.0 (no HDR
 * hotspot in reflections) — that is fine and standard: the directional KEY light
 * (MOBILE_KEY_INTENSITY) supplies the HDR sun punch, the LDR sky supplies directional
 * ambient + reflection shape. Desktop keeps ENV_INTENSITY/BG_INTENSITY on the same
 * sky.webp, untouched.
 */
const MOBILE_ENV_INTENSITY = 0.32;
const MOBILE_BG_INTENSITY = 1.0;

/**
 * Global color-grade tunables — applied by the post FX chain AFTER tone mapping
 * so we grade the tone-mapped LDR image (colors read punchy instead of washed
 * out). Effect order in the composer: Bloom -> ToneMapping -> HueSaturation ->
 * BrightnessContrast.
 *
 * SATURATION: this is the main "game look" knob (postprocessing HueSaturation
 *   `saturation` prop). In postprocessing 6.39.3 the prop is NOT a raw
 *   multiplier: 0 = unchanged, and positive values push colors away from their
 *   per-pixel average (increasing saturation) via factor
 *   (1 - 1/(1.001 - saturation)). So 0.28 ≈ +28% pop. Range roughly 0..0.5.
 * BRIGHTNESS: postprocessing BrightnessContrast `brightness`; 0 = unchanged.
 * CONTRAST: postprocessing BrightnessContrast `contrast`; 0 = unchanged,
 *   positive tightens the tonal range (divides by 1 - contrast).
 */
const SATURATION = 0.28;
const BRIGHTNESS = 0.0;
const CONTRAST = 0.12;

/**
 * MOBILE-ONLY grade knobs — DECOUPLED from the desktop values above so the
 * realistic look can be tuned without touching the frozen desktop composer. Passed
 * to <MobileCrispBoardPipeline> instead of SATURATION/BRIGHTNESS/CONTRAST.
 *
 * REBALANCE for the exposure + real-sky lift (the two PRIMARY too-dark fixes:
 * MOBILE_EXPOSURE below multiplies linear midtones up pre-tonemap, and the real
 * sky.webp env raises directional ambient — see MOBILE_ENV_INTENSITY). Because the
 * multiplicative pre-exposure now does the lifting, these are trimmed to finishing
 * nudges, not drivers:
 * - BRIGHTNESS 0.0 — HELD. The pre-exposure MULTIPLY lifts the whole range and the
 *   re-activated WarmGrade shadow term adds a gentle lift, so an ADDITIVE brightness
 *   offset would double-lift the floor and risk milky/washed blacks; a multiply
 *   preserves the black point far better, so let exposure do the lifting.
 * - CONTRAST 0.10 → 0.13 — SHADOW-DRAMA round. Widen the highlight/shadow separation
 *   after ACES so the muted palette (MOBILE_SATURATION −0.18) reads as VALUE drama, not
 *   oversaturation. The stylized low-poly references are muted but NOT grey — they hold
 *   value contrast from the one key. The BrightnessContrast bump is now 1/0.87 = ×1.149
 *   (a hair above the desktop ×1.124 crush), pairing with the raised KEY + darker baked
 *   shadow to re-establish midtone snap. Tunable 0.10–0.15.
 * - SATURATION 0.15 → -0.08 → -0.18 — the REFERENCE-MATCH palette lever. The good
 *   stylized low-poly renders share MUTED, harmonious, DESATURATED palettes; our
 *   neon-uniform green is the #1 "cheap" tell. postprocessing 6.39.3 HueSaturation runs
 *   `color += (average − color) · −saturation` for saturation<0 — a clean LINEAR pull
 *   toward per-pixel grey — so −0.18 ≈ 18% global desaturation (deepened from −0.08 for
 *   the "smooth/blended" pass — grass reads sage/muted rather than neon-green). It mutes
 *   the board too (the board is composited BEFORE this single grade pass), so it is
 *   PAIRED with the board-preserving MOBILE_BOARD_SATURATION boost in BoardTiles so
 *   the branded tiles stay vivid/readable. Previously validated on-device range was
 *   −0.05..−0.14; −0.18 is intentionally past that range for this pass — re-verify
 *   on-device that the board still reads vivid/legible through the boost. NO global
 *   `hue` nudge — that would rotate the branded board tiles' hues. Cohesive warm/cool
 *   harmony is added separately by the now-active WarmGrade split-tone seam (luma-keyed,
 *   board-safe — see WarmGradeEffect), not by a hue rotation.
 * Tune ON-DEVICE together with MOBILE_EXPOSURE (1.25–1.5), MOBILE_ENV_INTENSITY
 * (0.85–1.2) and MOBILE_BOARD_SATURATION. Paired with ACES_FILMIC tone, the ACTIVE
 * warm/cool split-tone seam, NO vignette, and the raking directional daylight rig.
 * Desktop <HueSaturation>/<BrightnessContrast> still read SATURATION/BRIGHTNESS/
 * CONTRAST → byte-identical.
 */
const MOBILE_SATURATION = -0.18;
const MOBILE_BRIGHTNESS = 0.0;
const MOBILE_CONTRAST = 0.20;

/**
 * MOBILE-ONLY PRE-EXPOSURE — the PRIMARY "too-dark" fix. A linear-HDR MULTIPLY
 * applied by <MobileCrispBoardPipeline>'s grade pass BETWEEN Sharpen and the ACES
 * ToneMapping (see PreExposureEffect), i.e. on the raw linear composite BEFORE the
 * tonemap. ACES/AGX compress midtones without exposure compensation, so the scene
 * reads DIM despite the light rig; scaling linear radiance up here lifts midtones
 * while ACES rolls the boosted highlights off near white (its natural shoulder) —
 * midtones brighten, highlights hold, and a MULTIPLY preserves the black point far
 * better than the additive brightness offset it replaces. This is a global
 * multiplicative lift; MOBILE_ENV_INTENSITY adds the shaded-side/ambient + directional
 * realism — they work together. 1.0 = unchanged. STARTING VALUE 1.35; TUNABLE
 * on-device 1.25–1.5. PERF-NEUTRAL: one uniform read + one multiply per fragment,
 * merged into the already-present single grade EffectPass (no new pass/RT). Desktop
 * has no equivalent (its EffectComposer is untouched) → byte-identical.
 */
const MOBILE_EXPOSURE = 1.18;

/**
 * MOBILE FXAA subpixel-blend quality (postprocessing FXAAEffect `subpixelQuality`
 * → SUBPIXEL_QUALITY define; default 0.75, range 0..1). This is the component of
 * FXAA that blurs small high-contrast features (thin board-text glyph edges) to
 * hide sub-pixel shimmer — and it is a big part of why the dpr-2 board text
 * reads SOFT. Dialled down to 0.4 so edges stay anti-aliased (the edge search /
 * gradient step is untouched) while the softening blur is cut, letting the
 * SharpenEffect below land on crisper text. Not so low that thin edges shimmer.
 * MOBILE ONLY — desktop uses SMAA, not FXAA, so this does not touch the frozen
 * desktop chain.
 */
const MOBILE_FXAA_SUBPIXEL_QUALITY = 0.4;

/**
 * Ambient Occlusion tunables (N8AO — the FIRST effect in the composer, before
 * Bloom/ToneMapping/grade). AO is the single biggest fix for the flat EEVEE
 * look: it darkens contact shadows / crevices so geometry reads as grounded.
 *
 * - AO_INTENSITY: strength of the darkening (higher = deeper contact shadows).
 * - AO_RADIUS: sample radius in WORLD units. The board/scene is ~10 units
 *   across, so ~0.7 catches under-building/under-tree contacts without smearing
 *   AO across whole tiles. Raise for softer, wider occlusion.
 * - AO_DISTANCE_FALLOFF: how quickly occlusion fades with depth distance
 *   (fraction of AO_RADIUS); ~1.0 keeps it local and avoids dark halos.
 * - AO_HALF_RES: render AO at half resolution then upsample — big perf win for
 *   this fragment-heavy pass; the denoiser hides the resolution drop.
 * - AO_QUALITY: N8AO sample-count preset (performance|low|medium|high|ultra).
 */
const AO_INTENSITY = 1.2;
const AO_RADIUS = 0.7;
const AO_DISTANCE_FALLOFF = 1.0;
const AO_HALF_RES = true;
const AO_QUALITY = 'medium' as const;

/**
 * 3-point directional-light rig — replaces a single key + flat fill so the
 * scene gets shaped light (warm sun / cool shadow-side fill / cool rim) instead
 * of a uniform wash. The HDRI Environment (ENV_INTENSITY) stays as the soft
 * global/IBL light; these are the DIRECT lights layered on top.
 */
// KEY — the sun. Warm tint, the only shadow caster. Position + shadow map + the
// ortho shadow-camera bounds are kept exactly as the previous single light.
const KEY_COLOR = '#fff1de';
const KEY_INTENSITY = 1.3;
const KEY_POSITION: [number, number, number] = [6, 10, 6];
// FILL — cool, low intensity, from an opposite-ish angle. Lifts the shadow side
// without flattening the form. No shadow (keeps perf + avoids double shadows).
const FILL_COLOR = '#cfe0ff';
const FILL_INTENSITY = 0.35;
const FILL_POSITION: [number, number, number] = [-6, 5, -4];
// RIM / BACK — cool-bright, high and behind. Edge-lights the tops of trees /
// buildings / tokens so they separate from the sky. No shadow.
const RIM_COLOR = '#e8f0ff';
const RIM_INTENSITY = 0.4;
const RIM_POSITION: [number, number, number] = [-4, 8, -8];
// Flat fills reduced (ambient 0.4 → 0.15, hemi 0.35 → 0.25) so AO + the rig do
// the shaping instead of a uniform wash brightening every surface equally.
const AMBIENT_INTENSITY = 0.15;
const HEMI_INTENSITY = 0.25;

/**
 * ── MOBILE-ONLY DIRECTIONAL SIDE-LIGHT DAYLIGHT RIG (SIDE-LIGHT DEPTH) ─────────
 * Fixes flat-reading low-poly CITY BOXES (their vertical walls only differentiate
 * when the sun rakes from a LOWER/SIDE angle — a near-overhead sun lit all four
 * walls ~equally). The fix is a LOWERED raking KEY sun (~31° elevation) over a
 * NATURAL neutral fill (hemi + ambient + IBL). Now a wall facing the sun is bright,
 * the wall turned away falls into shade, and the (longer) baked KEY shadow lands
 * dark against the lit ground — so every box reads a bright side + mid top + dark
 * side, and form/shadows/face-to-face separation all READ as depth (even on
 * low-poly). Depth comes from the sun DIRECTION, NOT from crushing the fill dark
 * (the earlier hard fill cut is reversed — it was making the shaded sides muddy).
 * The fill stays NEUTRAL (no teal-orange split — that cinematic look was separately
 * rejected). FILL/RIM stay desktop-only (already dropped on mobile). These twins
 * replace the desktop hemisphere/ambient/KEY on mobile; desktop keeps its KEY /
 * HEMI / AMBIENT consts above, byte-identical.
 *
 * KEY (the sun): neutral warm-WHITE, LOWERED to a raking side-light so boxy walls
 * differentiate. POSITION [7,11,6] → [7,5.5,6] — x/z (azimuth) UNCHANGED, only Y
 * dropped 11 → 5.5 (horizontal dist √85 ≈ 9.22, elevation atan(5.5/9.22) ≈ 31° —
 * down from ≈50°). At ≈50° the top face (N·L 0.766) out-lit every vertical wall
 * (0.42–0.64) so boxes read as bright-topped slabs; at ≈31° the sun-facing wall
 * (N·L 0.859) now EXCEEDS the top (0.512) while the averted wall clamps to 0 — every
 * box gets a bright side + a mid top + a dark side, the raking break an overhead sun
 * cannot make. Because POSITION moved, the frozen shadow map RE-BAKES ONCE at load
 * from the light's live world matrix (MobileCrispBoardPipeline, autoUpdate off — no
 * per-frame cost, no offline step); the ortho frame is WIDENED ±8 → ±12 below to
 * contain the ~2× longer throw. Intensity 2.0 → 2.1 so the lit side still dominates
 * and to recover the up-face exposure the lower sun loses to cosine (top N·L 0.766 →
 * 0.512); intensity changes are shadow-safe (depth-only map).
 *
 * FILL (hemi + ambient): RAISED back toward natural now that depth comes from the
 * sun DIRECTION, not from starved fill — reversing the earlier hard cut that made
 * the shaded sides muddy/dark. Hemi 0.30 → 0.44 (neutral daylight sky over a
 * slightly darker warm ground bounce); ambient 0.12 → 0.20 (neutral). EXPOSURE MATH
 * (three's hemi factor 0.5 for vertical faces, 1.0 up): a SHADED vertical wall (no
 * key) receives hemi 0.44×0.5 + ambient 0.20 + env 0.75 ≈ 1.17 — UP 34% from the old
 * ≈0.87, so the shaded side is now READABLE, not muddy (the direct fix for "too
 * dark"). A board/ground UP-face (key N·L 0.512) receives 2.1×0.512 + hemi 0.44 +
 * ambient 0.20 + env 0.75 ≈ 2.47 (vs the old ≈2.55, ~3% lower — offset by the grade
 * brightness lift), so board TEXT stays as readable/bright as before. The lit-wall
 * (key 2.1×0.859 + fill 1.17 ≈ 2.97) : shaded-wall (1.17) ratio ≈ 2.5:1 — same head
 * ratio as the old flat rig but produced by the lit WALL out-lighting the top and
 * the shaded side LIFTED, not by crushed blacks. PRIMARY user nudge knobs:
 * MOBILE_KEY_INTENSITY (raise for more drama), MOBILE_HEMI_INTENSITY /
 * MOBILE_ENV_INTENSITY (raise to soften the shade back up).
 */
const MOBILE_KEY_COLOR = '#fff4ea'; // neutral warm-white daylight key
// SHADOW-DRAMA: raised 2.1 → 2.3 so lit up-faces pop ~10% (a board/ground up-face goes
// ~2.47 → ~2.51 luma), sharpening the sunlit-vs-shaded read. Shadow-safe (the KEY's
// shadow map is the frozen depth-only one-shot bake). Tunable 2.3–2.5 for more punch.
const MOBILE_KEY_INTENSITY = 2.7;
const MOBILE_KEY_POSITION: [number, number, number] = [7, 5.5, 6]; // lowered Y 11→5.5 for side-light (elev ~31°); re-bakes at load
// HEMISPHERE: neutral daylight sky over a slightly darker WARM ground bounce (so
// undersides read a touch deeper), RAISED to a natural daylight fill so the shaded
// side reads instead of going muddy — depth now comes from the raking sun angle.
const MOBILE_HEMI_SKY = '#cfe0f5';
const MOBILE_HEMI_GROUND = '#6b7488';
const MOBILE_HEMI_INTENSITY = 0.16;
// AMBIENT: NEUTRAL soft floor — lifts pure black so the deepest shade never crushes;
// the raking directional KEY + longer baked shadow supply the darkening, so this
// stays low and colourless. SHADOW-DRAMA: trimmed 0.20 → 0.17 for a deeper (still
// lifted + hued) shadow side — a shaded wall stays ~1.1 luma, well above the ~0.87
// "too dark" floor the last round fixed. Hold 0.20 if any muddiness appears.
const MOBILE_AMBIENT_COLOR = '#aeb8cc';
const MOBILE_AMBIENT_INTENSITY = 0.06;

/**
 * ── MOBILE NIGHT MODE (toggle) ────────────────────────────────────────────────
 * A moody moonlit-night look for the mobile scene: cool dark-blue moonlight, deep
 * navy shadows, and a WARM central glow over the board (the "campfire valley" read)
 * that also keeps the board + city readable. It REUSES the entire day pipeline
 * unchanged — real forest shadows (highp/layer split), matte terrain, SSAO, matte
 * forest — and only RE-LIGHTS / RE-TINTS (sky, fog, lighting rig, grade) + adds one
 * warm non-shadow board light. The moon KEY stays the SOLE shadow caster (same highp
 * shadow pipeline; no new mediump-shadow exposure), so it is iOS-safe.
 *
 * TOGGLE: when MOBILE_NIGHT_MODE is FALSE the day look is BYTE-IDENTICAL to before —
 * every night branch below is a `MOBILE_NIGHT_MODE ? night : day` select that resolves
 * to the untouched day const, the warm light is not mounted, and HdriSkyMobile renders
 * its day (sky.webp) child. Mobile-only; the desktop path is never touched either way.
 * All values are named consts so they can be tuned on-device.
 *
 * DEFERRED (later pass, not built here): emissive city windows, fireflies, bloom on
 * emissives.
 *
 * Typed `boolean` (not literal `true`) so both day and night branches type-check and
 * survive in the bundle for a rebuild-flip A/B, matching MOBILE_FOREST_SHADOWS_ENABLED.
 */
const MOBILE_NIGHT_MODE: boolean = true;

// Moon KEY — stays the SOLE shadow caster (same position + the whole highp/layer-split
// shadow pipeline); night only recolors it cool + dims it, and softens the receive.
const MOBILE_NIGHT_KEY_COLOR = '#9fb4d8'; // cool moonlight
const MOBILE_NIGHT_KEY_INTENSITY = 1.1;
const MOBILE_NIGHT_KEY_SHADOW_INTENSITY = 0.6; // softer receive than day's 0.9
// Hemisphere / ambient — cool, dark night fill (deep navy shadow side).
const MOBILE_NIGHT_HEMI_SKY = '#2a3a5c';
const MOBILE_NIGHT_HEMI_GROUND = '#171c2b';
const MOBILE_NIGHT_HEMI_INTENSITY = 0.22;
const MOBILE_NIGHT_AMBIENT_COLOR = '#1b2338';
const MOBILE_NIGHT_AMBIENT_INTENSITY = 0.12;
// Env / background intensity — dark sky IBL (keep it from washing out the night).
// Bumped 0.15 → 0.25 for the real HDRI (NIGHT_SKY_MODE='hdri'): the tonemapped
// source is darker than the old procedural gradient, so the IBL needs a touch
// more gain to keep the board/city equally lit. Exposed for on-device tuning.
const MOBILE_NIGHT_ENV_INTENSITY = 0.25;
const MOBILE_NIGHT_BG_INTENSITY = 1.0; // the procedural night gradient is already dark

/**
 * ── MOBILE NIGHT SKY SOURCE (toggle) ──────────────────────────────────────────
 * Real night-sky HDRI (tonemapped, real stars + Milky Way baked in) vs. the
 * cheap procedural dark-navy gradient (getProceduralNightSky). 'hdri' loads a
 * pre-generated 2048×1024 equirect webp (scripts/gen-night-sky.mjs, sourced
 * from 8K tonemapped HDRI renders); 'procedural' keeps the EXACT prior
 * CanvasTexture path as a no-asset fallback. Mobile/night only — day and
 * desktop never read this.
 */
const NIGHT_SKY_MODE: 'hdri' | 'procedural' = 'hdri';
// Which pre-generated night-sky equirect to use: '003' = moonlit clean sky,
// '008' = Milky Way band (default — the more dramatic real-sky read).
const NIGHT_SKY_HDRI: '003' | '008' = '008';
const NIGHT_SKY_HDRI_URLS: Record<'003' | '008', string> = {
  '003': '/images/night-sky-003.webp',
  '008': '/images/night-sky-008.webp',
};
const NIGHT_SKY_URL = NIGHT_SKY_HDRI_URLS[NIGHT_SKY_HDRI];
// WARM FOCAL BOARD LIGHT (night-only, NEW) — a warm point light above the board CENTER
// that lights the BOARD + CITY (readability) and falls off into the dark surroundings
// (campfire-valley glow). castShadow=FALSE — the moon is the sole caster; this is pure
// warm fill/ambiance. Physical point light (three r0.169): intensity is candela with
// inverse-square decay, so the number is large; `distance` windows it to fade out beyond
// the board/city into the dark forest. All tuned on-device.
const MOBILE_NIGHT_WARM_COLOR = '#ffd39a'; // warm campfire tone
const MOBILE_NIGHT_WARM_INTENSITY = 70; // candela (decay 2) — moderate glow, tune on-device
const MOBILE_NIGHT_WARM_POSITION: [number, number, number] = [0, 7, 0]; // above board centre
const MOBILE_NIGHT_WARM_DISTANCE = 40; // world units — fades to 0 by here (into the dark)
const MOBILE_NIGHT_WARM_DECAY = 2; // physical inverse-square falloff
// Sub-toggle: cheap warm street-lamp emissive markers around the board (see
// NightStreetLights). Emissive-only (no real light) → ~0 fps. A/B knob.
const MOBILE_NIGHT_STREETLIGHTS = true;
// Fog — recolor to dark blue ONLY (near/far are coupled to FOREST_CULL_DISTANCE +
// density bands + a test, so FOG_FAR/FOG_NEAR are left exactly as day; see the fog note).
const MOBILE_NIGHT_FOG_COLOR = '#0e1830';
// Grade (passed to MobileCrispBoardPipeline) — moody darks; board stays readable. A cool
// tint is intentionally NOT done in the grade (it would need a pipeline change); the cool
// mood comes from the moon + navy sky + blue fog instead.
const MOBILE_NIGHT_EXPOSURE = 0.95;
const MOBILE_NIGHT_CONTRAST = 0.22;
const MOBILE_NIGHT_SATURATION = -0.1;
/**
 * MOBILE-ONLY frozen shadow-map resolution for the KEY sun. The map is baked
 * ONCE at load (autoUpdate off — see MobileCrispBoardPipeline), so it costs a single
 * extra shadow render at load + depth VRAM and ZERO per-frame cost.
 *
 * SOFT-SHADOW TUNING (reference-match): LOWERED 2048 → 1536 to WIDEN the PCF
 * penumbra for soft grounding. Penumbra width is ∝ 1/resolution for the fixed ±12
 * ortho frame, so 1536 (~64 texels/unit) widens PCFSoftShadowMap's penumbra ~33% —
 * clearly softer grounding while staying clean on the long ~31° tower shadows. This
 * is FREE: lowering the map makes the one-time load bake slightly CHEAPER (never more)
 * and there is no per-frame shadow cost (frozen, autoUpdate off). Drop to 1024 for
 * softer; revert 2048 for crisper. The larger 1536 texels are paired with a small
 * shadow-normalBias bump on the KEY light (0.03 → 0.035) as acne safety. Desktop's
 * KEY light keeps its own 1024².
 *
 * FOREST-SHADOW WIDENING (MOBILE_FOREST_SHADOWS_ENABLED): when tree shadows are on the
 * ortho frame widens 12 → 25 (MOBILE_SHADOW_ORTHO_HALF) to cover the near treeline
 * (~±23) around the board, so the map is BUMPED 1536 → 2048 to hold detail over the
 * ~4× larger area. Even so texel density drops 64 → ~41 texels/unit, so the board + city
 * cast shadows read ~36% SOFTER than before — the accepted tradeoff. IF board/city
 * shadows look too soft on-device, this is the crispness knob: raise to 3072 (~61
 * texels/unit at ±25) or narrow MOBILE_SHADOW_ORTHO_HALF (not below ~23 — clips the near
 * treeline). Still a FREE one-shot bake (autoUpdate off) — only ~+7MB one-time depth VRAM,
 * zero/frame. Toggle OFF → 1536 / ±12.
 */
const MOBILE_SHADOW_MAP_SIZE = MOBILE_FOREST_SHADOWS_ENABLED ? 3072 : 1536;

/**
 * MOBILE-ONLY KEY-sun ORTHO shadow-frustum HALF-EXTENT (world units). The frozen shadow
 * camera is [-H, H, H, -H, near, far]; H is the half-width of the world square the map
 * covers.
 *
 * WIDENED 12 → 25 when MOBILE_FOREST_SHADOWS_ENABLED so the surrounding TREE shadows land
 * on the VISIBLE near terrain around the board (the board is 10 units; ±12 barely cleared
 * the board's own long tower shadows, so trees ringing the ~46-unit clearing fell outside
 * it). The INNERMOST treeline ringing the clearing sits at ~±23, so ±25 captures the
 * trees NEAREST the board (the ones the user is looking at) with margin — ±22 would clip
 * them. The far plane also widens (30 → 45) so the low ~31° sun's frustum brackets the
 * ±25 corners without clipping (a ±25 corner at [25,0,-25] is ~35 units from the light —
 * past the old far=30). Toggle OFF → ±12 / far 30 (the pre-feature frame, revert-identical).
 * Tunable: SHRINK toward 18–20 for crisper board/city shadows (fewer trees covered — but
 * do not drop below ~23 or the near treeline clips), GROW for more distant tree shadows
 * (softer everything). Pair with MOBILE_SHADOW_MAP_SIZE.
 */
const MOBILE_SHADOW_ORTHO_HALF = MOBILE_FOREST_SHADOWS_ENABLED ? 25 : 12;
const MOBILE_SHADOW_CAMERA_FAR = MOBILE_FOREST_SHADOWS_ENABLED ? 45 : 30;

/**
 * ── MOBILE ADAPTIVE DPR (mobile only; desktop stays dpr={[1, 1.5]}) ───────────
 * The <Canvas> runs `frameloop="always"` on BOTH desktop and mobile (see below),
 * so physics + every useFrame step run every frame identically. On mobile a
 * <MobileRenderController> swaps the device-pixel-ratio between two values based
 * ONLY on whether the CAMERA is moving (see mobileRender.ts):
 *  - MOBILE_DPR_MOVING — the cheap dpr held while the camera ORBITS / zooms /
 *    pans, so the interaction stays fast and smooth. Token walk, dice roll and
 *    character animation deliberately DO NOT change dpr — only camera movement.
 *  - MOBILE_DPR_STILL — the phone's NATIVE dpr, CAPPED AT 2 (see below). The
 *    renderer's pixel ratio at rest, i.e. the resolution of the FINAL present.
 *    The board must present at native dpr to be crisp, so the renderer runs native
 *    (up to the cap) at rest. The EXPENSIVE scene (forest/city/tokens/sky) does NOT pay for this:
 *    MobileCrispBoardPipeline renders it into a reduced-dpr buffer (MOBILE_SCENE_DPR)
 *    and only the board + composite + grade run at native — so the dominant empty-board
 *    fill (HDRI sky + geometry + postFX-heavy scene) stays at MOBILE_SCENE_DPR, while the board
 *    text is razor-crisp. Also the initial `dpr` prop so the first paint is native.
 * MOBILE_SETTLE_MS is the no-camera-motion debounce before the crisp dpr is
 * restored. Kept short (120ms) so the crisp resolution lands quickly after the
 * user stops moving the camera — paired with a faster OrbitControls damping decay
 * on mobile (see CameraRig.tsx) so the drift tail no longer keeps re-arming this
 * debounce for ~1s after release.
 */
const MOBILE_DPR_MOVING = 1.3;
// MOBILE-ONLY fps/crispness knob. Cap the native present dpr at 2 (was 3): this is
// the multiplier on EVERY native full-screen pass (board raster + composite 6-tap +
// grade), so it is the single biggest fill-rate lever on the mobile path. Sharpen +
// FXAA already run in the grade pass and counter the slight softening of dpr 2, so
// the board stays acceptably crisp. If board-text crispness ever regresses on a
// high-dpr device this is a one-line revert (bump the cap back to 3).
const MOBILE_DPR_STILL = Math.min(
  typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2,
  2,
);
const MOBILE_SETTLE_MS = 120;

/**
 * MOBILE-ONLY crisp-board pipeline tunables (see MobileCrispBoardPipeline).
 * - MOBILE_SCENE_DPR: the FIXED dpr the expensive scene (forest / city / tokens /
 *   HDRI sky) renders at. The board + composite + present run at native dpr; this
 *   keeps the heavy scene at dpr 1.5 so framerate is preserved while the board goes
 *   native-crisp. (At rest the renderer is native; the scene FBO is sized
 *   css × min(nativeDpr, MOBILE_SCENE_DPR).)
 * - MOBILE_BOARD_DEPTH_BIAS: view-space-Z bias biasing the board/scene depth
 *   composite toward the SCENE at the token/house contact (kills contact shimmer).
 * - MOBILE_CITY_DPR: the FIXED dpr the center CITY renders at, in its OWN pass
 *   (the city collapses to this min(nativeDpr, 1.5) at rest, and to the cheap
 *   MOVING dpr while orbiting — see MobileCrispBoardPipeline). Set trivially to
 *   MOBILE_SCENE_DPR (or MOBILE_DPR_STILL) to A/B the split away.
 * - MOBILE_CITY_DEPTH_BIAS: view-space-Z bias biasing the city/board & city/ground
 *   composite toward the CITY at its contact base (the city is the foreground
 *   object there, so it wins near-ties; a tree genuinely in front still occludes it).
 */
// TUNABLE (MOBILE-ONLY): dpr of the expensive scene/forest pass. Dropped 2 → 1.5
// to cut that pass's pixel count by ~44%, directly targeting the low-angle
// 3rd-person forest overdraw that pushes the phone below 30fps. Raise back toward 2
// if distant foliage aliasing becomes objectionable.
const MOBILE_SCENE_DPR = 1.5;
const MOBILE_BOARD_DEPTH_BIAS = 0.03;
const MOBILE_CITY_DPR = 1.5;
const MOBILE_CITY_DEPTH_BIAS = 0.03;

/**
 * ── MOBILE-ONLY SOFT AMBIENT OCCLUSION / SSAO (depth-only N8AO) ────────────────
 * The headline realism unlock: soft, blended contact darkening under trees, rocks,
 * buildings, hill valleys and board-on-ground so the low-poly scene reads GROUNDED
 * instead of flat/floating. Runs INSIDE <MobileCrispBoardPipeline> (isMobile
 * branch): a depth-only N8AOPostPass reconstructs normals from the SCENE FBO's
 * DEPTH (the landscape/forest/mountains — the ~90% of screen the flat look afflicts)
 * — NO NormalPass / full-screen normal render, so no extra geometry pass — and
 * MULTIPLIES the occlusion into the scene colour BEFORE the board/city depth
 * composite and the single grade pass. Desktop is BYTE-IDENTICAL: it keeps its own
 * <N8AO> inside its <EffectComposer> (AO_* consts above); these MOBILE_SSAO_* values
 * are decoupled and consumed ONLY by the mobile pipeline.
 *
 * The device idles ~98fps under an iOS-Safari ~120 cap, so there is headroom for a
 * moderate AO cost; every knob below is a live tunable for on-device A/B.
 *
 * - MOBILE_SSAO_ENABLED: master on/off. false → the AO pass + its target are NOT
 *   built and the per-frame AO render is skipped (byte-for-byte the pre-SSAO path) —
 *   the instant A/B / kill-switch.
 * - MOBILE_SSAO_INTENSITY: AO darkening strength (1.0 = natural). Conservative so it
 *   reads as SOFT grounding, not black halos.
 * - MOBILE_SSAO_RADIUS: sample radius in WORLD units. WIDER than desktop's 0.7 (the
 *   scene is ~10 units across) so AO catches hill valleys + tree/building clusters,
 *   not just tiny crevices. Raise for broader/softer, lower to tighten.
 * - MOBILE_SSAO_DISTANCE_FALLOFF: occlusion fade with view-distance (fraction of
 *   radius); ~1.0 keeps it local and avoids dark halos across depth gaps.
 * - MOBILE_SSAO_HALF_RES: compute AO at HALF res then depth-aware upsample
 *   (resolutionScale 0.5) — the dominant fill knob (¼ the AO-loop pixels). true =
 *   briefed default. iOS NOTE: the half-res path uses an internal float MRT (R32F +
 *   RGBA16F); if it ever misbehaves on-device, flip to false for the MRT-free
 *   full-res fallback (reads only the depth texture the composite already samples).
 * - MOBILE_SSAO_AO_SAMPLES / _DENOISE_SAMPLES / _DENOISE_RADIUS: quality/softness of
 *   the AO loop + bilateral denoise. More denoise = smoother/softer (kept generous
 *   for the "blended" look); fewer AO samples = cheaper.
 * - MOBILE_SSAO_COLOR: occlusion tint, multiplied with the scene colour — a dark cool
 *   navy biases contact shadows COOL to match the cool-shadow grade; '#000000' = neutral.
 */
const MOBILE_SSAO_ENABLED = true;
const MOBILE_SSAO_INTENSITY = 1.0;
const MOBILE_SSAO_RADIUS = 1.5;
const MOBILE_SSAO_DISTANCE_FALLOFF = 1.0;
const MOBILE_SSAO_HALF_RES = true;
const MOBILE_SSAO_AO_SAMPLES = 16;
const MOBILE_SSAO_DENOISE_SAMPLES = 4;
const MOBILE_SSAO_DENOISE_RADIUS = 12;
const MOBILE_SSAO_COLOR = '#0a0f1e';

/**
 * ── MOBILE-ONLY TILT-SHIFT / MINIATURE-DIORAMA (see MobileCrispBoardPipeline) ──
 * A screen-vertical band blur merged into the mobile grade EffectPass: the board +
 * centre city stay razor-sharp while the far terrain/mountains (top of frame) and
 * the extreme near foreground (bottom) blur, reading the scene as a tiny tabletop
 * model. DISABLED BY DEFAULT (MOBILE_TILTSHIFT_ENABLED = false): the miniature-diorama
 * look actively FIGHTS the "high-quality low-poly render" reference goal, and users
 * flagged the blur as "weird". When false the effect is NOT constructed and NOT added
 * to the grade pass (see MobileCrispBoardPipeline), so its half-res Kawase blur + RT +
 * per-frame update() are GONE — a ~1.5-3ms/frame perf WIN, not just neutral. Flip
 * MOBILE_TILTSHIFT_ENABLED to true to bring it back (it was the ONE effect BUDGETED to
 * cost fps, ~10-15fps; scene idles ~84 → stays ≥ 65). The band shape/cost knobs below
 * still feed the effect when re-enabled, so the whole thing stays TUNABLE. MOBILE-ONLY:
 * only <MobileCrispBoardPipeline> (isMobile branch) consumes these; desktop keeps its
 * own <EffectComposer> → byte-identical.
 *
 * Units: framebuffer-space, where the FULL screen height spans 2.0 (bottom −1,
 * centre 0, top +1). fully-sharp core = OFFSET ± (FOCUS_AREA − FEATHER); full blur
 * beyond OFFSET ± FOCUS_AREA.
 * - MOBILE_TILTSHIFT_OFFSET: screen-Y centre of the sharp band. 0 = screen centre
 *   (board centre at the idle dolly-in pose). +0.03..+0.05 to read the near
 *   foreground sharper (band toward far terrain); negative toward the near/city side.
 * - MOBILE_TILTSHIFT_FOCUS_AREA: half-height of the feather-out edge. WIDENED to 0.85
 *   (from 0.6) so the sharp+feather zone spans ±0.85 of the 2.0-tall frame and full
 *   blur is confined to the outer ~15% top/bottom. This is the fix for the review
 *   finding that the free camera (deep zoom-in to minDistance 4.0 ≈ 1.7× the idle
 *   6.9 framing, plus limited vertical pan) could previously push the NEAR/FAR board
 *   rows past the old ±0.6 cutoff into full blur. At 0.85 the board stays inside the
 *   sharp+feather zone across the whole mobile camera envelope; only at the most
 *   extreme zoom-in+pan do its outermost rows reach the SOFT feather (never the hard
 *   full-blur), which reads as depth, not a bug. Lower toward 0.6 for a stronger
 *   diorama ONLY if you also re-tighten the camera clamps; raise toward 1.0 to push
 *   full blur off-screen entirely (mildest, guaranteed-sharp board).
 * - MOBILE_TILTSHIFT_FEATHER: softness of the focus-area edge ramp.
 * - MOBILE_TILTSHIFT_RESOLUTION_SCALE: the dominant cost knob — the internal blur RT
 *   is this × the pass's native size per axis (0.5 ⇒ ¼ of the pixels). Lower is BOTH
 *   cheaper AND a softer/larger-reading blur; escalate 0.5 → 0.4 → 0.35 if over the
 *   fps budget.
 * - MOBILE_TILTSHIFT_KERNEL_SIZE: Kawase kernel (KernelSize enum). MEDIUM start; drop
 *   to SMALL first if over budget, raise to LARGE for a stronger diorama if under.
 * MEASURE on-device via RenderStatsReadout at the idle pose (expect ~84 → confirm
 * ≥ 65); A/B by temporarily setting FOCUS_AREA = 2.0 (whole screen sharp = blur off).
 */
// MASTER on/off for the mobile tilt-shift. false = effect dropped from the grade pass
// (perf WIN + removes the "weird" blur). Flip to true to restore the diorama band using
// the OFFSET/FOCUS_AREA/FEATHER/RESOLUTION_SCALE/KERNEL_SIZE knobs below.
const MOBILE_TILTSHIFT_ENABLED = false;
const MOBILE_TILTSHIFT_OFFSET = 0.0;
const MOBILE_TILTSHIFT_FOCUS_AREA = 0.85;
const MOBILE_TILTSHIFT_FEATHER = 0.35;
const MOBILE_TILTSHIFT_RESOLUTION_SCALE = 0.5;
const MOBILE_TILTSHIFT_KERNEL_SIZE = KernelSize.MEDIUM;

/**
 * ── MOBILE-ONLY DISTANCE FOG (atmospheric far-haze) ───────────────────────────
 * A cheap per-fragment linear fog that fades the far terrain/foliage into an
 * atmospheric haze so the distant forest reads as depth (and so the forest ring
 * cull in ForestEnvironment can drop far chunks whose fogged-out edge is already
 * invisible — see FOREST_CULL_DISTANCE there). MOBILE ONLY: the `<fog>` element
 * below is gated on `isMobile`, so on desktop `scene.fog` stays null and the
 * desktop render is byte-identical.
 *
 * WHY LINEAR `THREE.Fog` (not `FogExp2`): linear fog reaches fogFactor = 1.0
 * EXACTLY at FOG_FAR, giving the forest ring cull a deterministic "fully-hazed"
 * cutoff distance to hide its cut edge behind. Exp2 is asymptotic (never fully
 * opaque), so there would be no distance at which a culled chunk is provably
 * invisible.
 *
 * APPLIES AUTOMATICALLY to every fog-enabled MeshStandardMaterial in the SCENE
 * pass — forest fade + opaque variants, city, and the forest ground/foliage —
 * because `material.fog` defaults to true and three compiles `USE_FOG` in when
 * `scene.fog` is set. The forest's onBeforeCompile patches (applyForestFade,
 * injectMobileMediump) and the board saturation patch never touch the
 * `fog_pars_*`/`fog_vertex`/`fog_fragment` chunks, so fog still injects.
 *
 * DOES NOT fog the BOARD: BoardTiles sets edge/top `material.fog = false`, so the
 * board stays crisp + unfogged even though it renders in a pass where scene.fog
 * is still live. `scene.fog` is NEVER nulled per-pass (that would thrash the
 * shader-program cache); the board simply opts out at the material level.
 *
 * COLOR (reference-match ATMOSPHERIC PERSPECTIVE lever): light desaturated
 * cool-sage-grey haze (#c9d0cb). The old #dbe8f0 was a leftover matched to the
 * now-DEAD ProceduralSky (SKY_MID #e4f0f7 — no longer imported); it was too light
 * and too BLUE for the real sky.webp actually assigned to scene.background/
 * environment on mobile. Sampled sky.webp's horizon band (v≈0.5) is #b6c1ae grading
 * to #8ca6a9 lower-horizon — a muted green-grey/teal, NOT blue. #c9d0cb is slightly
 * lighter than that horizon terrain (the aerial-lightening cue) and sits in the sky's
 * real green-grey horizon family, so the far treeline melts into the ACTUAL sky and
 * the ring-cull cut edge (already fog=1.0) stays invisible. Atmospheric perspective
 * strengthens WITHOUT moving near/far because (i) fog now matches the true horizon so
 * the dissolve is seamless and (ii) the palette mute further desaturates the fogged
 * distance. On-device range #bfc8c4 (denser) .. #d2d8d4 (lighter); nudge blue toward
 * #c4cfce if the sage reads too green. MOBILE ONLY (the <fog> below is isMobile-gated),
 * so desktop scene.fog stays null → byte-identical.
 * NEAR/FAR (world units): board/city/near treeline (fogDepth ~10-20) stay clear;
 * the deep forest is fully hazed by FOG_FAR. Kept at 24/52 — the forest ring-cull
 * (FOREST_CULL_DISTANCE ≈ FOG_FAR×1.27) and ForestEnvironment's density-band math
 * are tuned to these exact numbers (forestChunking.test.ts hardcodes them) and rely
 * on LINEAR fog reaching fogFactor=1.0 EXACTLY at FOG_FAR, so DO NOT move them and do
 * NOT switch to FogExp2 (asymptotic — removes the deterministic cutoff). Only the
 * color changes.
 *
 * UPDATE (atmospheric-perspective pass): nudged COLOR further toward the cooler
 * grey-blue end of the on-device range called out above (#c9d0cb → #c4ccd4) for a
 * hazier, more cohesive horizon read. NEAR/FAR are intentionally UNCHANGED (still
 * 24/52) — see the hard coupling above: FOREST_CULL_DISTANCE (ForestEnvironment.tsx,
 * = 66 = FOG_FAR × 1.27, NOT re-derived from FOG_FAR) and DENSITY_BAND_DISTS
 * ([36, 48, 58], also hand-tuned against FOG_FAR=52) both assume this exact FOG_FAR.
 * Moving FOG_FAR out to 72 without retuning those two constants in lockstep would
 * make the forest ring-cull and density-thinning bands fire well before the chunks
 * are fog-opaque (e.g. at FOG_FAR=72 the current cull ring's nearest fragment would
 * only reach ~63% fog opacity, not 100%), i.e. chunks/foliage popping or thinning
 * visibly instead of dissolving into haze — the opposite of this pass's goal. That
 * retune is out of scope here; flagged for the orchestrator rather than guessed.
 */
const FOG_COLOR = '#c4ccd4';
const FOG_NEAR = 24;
const FOG_FAR = 52;

/**
 * DESKTOP sky/env. Manually applies the equirectangular sky.webp as
 * scene.environment (and optionally scene.background) so Three.js actually picks
 * it up. drei's <Environment files=...> path resolves ambiguously for LDR webp
 * and leaves scene.background null; this component is deterministic. Loads
 * sky.webp via useTexture (suspends). Byte-identical to the pre-split component —
 * desktop is HARD-FROZEN.
 */
function HdriSkyDesktop() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const tex = useTexture('/images/sky.webp');
  useEffect(() => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    // Crisper sky: trilinear mip filtering + max anisotropy kills the shimmer
    // and pixelation at grazing angles / when the sky fills large screen areas.
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = gl.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    scene.environment = tex;
    scene.environmentIntensity = ENV_INTENSITY;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- SHOW_HDRI_BACKGROUND is a documented build-time toggle (see header); keep the branch so it can be flipped without edits
    if (SHOW_HDRI_BACKGROUND) {
      scene.background = tex;
      scene.backgroundIntensity = BG_INTENSITY;
    }
    // Under frameloop="always" the imperatively-set scene.environment/background
    // paints on the next frame automatically — no render poke needed.
    return () => {
      scene.environment = null;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- SHOW_HDRI_BACKGROUND is a documented build-time toggle (see header)
      if (SHOW_HDRI_BACKGROUND) scene.background = null;
    };
  }, [tex, scene, gl]);
  return null;
}

/**
 * MOBILE sky/env — REAL equirect daylight HDRI. Loads the SAME shared
 * /images/sky.webp desktop already uses (read-only reuse — the file and
 * HdriSkyDesktop's code path are untouched, so this stays compliant with the
 * mobile-asset-variant discipline: no shared/desktop asset is modified) and assigns
 * it to BOTH scene.background (visible sky) AND scene.environment (IBL). This
 * REPLACES the old flat 16×512 procedural gradient: a real daylight equirect gives
 * directional sky IBL + believable reflection variation instead of a uniform wash —
 * the biggest fix for the flat/game-y mobile look. Because scene.environment is NOT
 * layer gated, the board + city passes inherit it identically in the 3-pass mobile
 * composite. Texture setup mirrors HdriSkyDesktop (EquirectangularReflectionMapping,
 * SRGBColorSpace, trilinear mips + max anisotropy). Suspends via useTexture exactly
 * like desktop — the existing outer <Suspense> around <HdriSky> already covers it.
 * VRAM cost only (~a few MB for the 2048×1024 webp + mipmaps, already resident for
 * desktop's identical load); NO new pass/RT/PMREM-at-runtime — materials already
 * sample scene.environment for IBL, so this is a texture SWAP with the same
 * per-fragment sample count. Desktop keeps sky.webp untouched.
 */
function HdriSkyMobileDay() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const tex = useTexture('/images/sky.webp');
  useEffect(() => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    // Crisper sky: trilinear mip filtering + max anisotropy (mirrors desktop).
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = gl.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    scene.environment = tex;
    scene.environmentIntensity = MOBILE_ENV_INTENSITY;
    scene.background = tex;
    scene.backgroundIntensity = MOBILE_BG_INTENSITY;
    // Under frameloop="always" the imperatively-set scene.environment/background
    // paints on the next frame automatically — no render poke needed.
    return () => {
      scene.environment = null;
      scene.background = null;
    };
  }, [tex, scene, gl]);
  return null;
}

/**
 * MOBILE NIGHT sky/env — REAL night-sky HDRI branch (NIGHT_SKY_MODE='hdri').
 * Loads the pre-generated 2048×1024 equirect webp for NIGHT_SKY_HDRI
 * (scripts/gen-night-sky.mjs — real stars + Milky Way baked in, tonemapped)
 * via useTexture and assigns it to BOTH scene.background (visible night sky)
 * and scene.environment (IBL at MOBILE_NIGHT_ENV_INTENSITY, same knob the
 * procedural path used — the moon/warm-light rig still drives the look).
 * Texture setup mirrors HdriSkyMobileDay (EquirectangularReflectionMapping,
 * SRGBColorSpace, trilinear mips + max anisotropy) so the real stars stay
 * crisp instead of shimmering. The background is drawn fog-free (three does
 * not fog scene.background), so the stars/Milky Way render unobscured — that
 * is the intended "real sky" look.
 */
function HdriSkyMobileNightHdri() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const tex = useTexture(NIGHT_SKY_URL);
  useEffect(() => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = gl.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    scene.environment = tex;
    scene.environmentIntensity = MOBILE_NIGHT_ENV_INTENSITY;
    scene.background = tex;
    scene.backgroundIntensity = MOBILE_NIGHT_BG_INTENSITY;
    return () => {
      scene.environment = null;
      scene.background = null;
    };
  }, [tex, scene, gl]);
  return null;
}

/**
 * MOBILE NIGHT sky/env — PROCEDURAL fallback branch (NIGHT_SKY_MODE='procedural').
 * Byte-identical to the pre-HDRI-swap component: swaps the day equirect for a cheap
 * PROCEDURAL dark-navy night gradient (see getProceduralNightSky), assigned to BOTH
 * scene.background (visible dark sky) and scene.environment (a DARK cool IBL at
 * MOBILE_NIGHT_ENV_INTENSITY so the moon/warm-light rig drives the look). NO asset, no
 * useTexture, no Suspense, no KTX2 — the module-cached CanvasTexture is built on first
 * use and reused. Kept as the no-asset fallback (see NIGHT_SKY_MODE).
 */
function HdriSkyMobileNightProcedural() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const tex = getProceduralNightSky();
    scene.environment = tex;
    scene.environmentIntensity = MOBILE_NIGHT_ENV_INTENSITY;
    scene.background = tex;
    scene.backgroundIntensity = MOBILE_NIGHT_BG_INTENSITY;
    return () => {
      scene.environment = null;
      scene.background = null;
    };
  }, [scene]);
  return null;
}

/**
 * MOBILE NIGHT sky selector (MOBILE_NIGHT_MODE) — picks the real-HDRI branch or the
 * procedural fallback on the compile-time NIGHT_SKY_MODE flag. Split into sibling
 * components (vs. branching inside one) so neither child's hooks are ever
 * conditionally skipped (rules-of-hooks safe) — mirrors HdriSkyMobile's Day/Night
 * split and HdriSky's Mobile/Desktop split. The 'hdri' branch is wrapped in its OWN
 * <Suspense fallback={null}> (mirrors CityAO's isolation, see CityDressing.tsx) so a
 * slow/failed night-sky texture load can never blank the rest of the scene — it only
 * suspends its own leaf, leaving the board/forest/city (separate Suspense
 * boundaries) rendering normally.
 */
function HdriSkyMobileNight() {
  if (NIGHT_SKY_MODE === 'hdri') {
    return (
      <Suspense fallback={null}>
        <HdriSkyMobileNightHdri />
      </Suspense>
    );
  }
  return <HdriSkyMobileNightProcedural />;
}

/**
 * MOBILE sky selector — day (sky.webp equirect) vs night (real HDRI equirect by
 * default, or the procedural navy gradient fallback — see NIGHT_SKY_MODE) on the
 * compile-time MOBILE_NIGHT_MODE flag. Split so the day child's useTexture hook is
 * never conditionally called. When MOBILE_NIGHT_MODE is false this is byte-identical to
 * the previous HdriSkyMobile (renders the day child only).
 */
function HdriSkyMobile() {
  return MOBILE_NIGHT_MODE ? <HdriSkyMobileNight /> : <HdriSkyMobileDay />;
}

/**
 * Parent selector — renders exactly ONE of the two sibling sky components based
 * on isMobile so each hook (both now useTexture on the SAME /images/sky.webp) is
 * called unconditionally within its component (rules-of-hooks safe across resize /
 * orientation flips). The branches differ only in intensities (MOBILE_*), never in
 * the shared asset or desktop's code path. Mirrors the BoardTiles WebGL/KTX2 split.
 */
function HdriSky() {
  const isMobile = useIsMobile();
  return isMobile ? <HdriSkyMobile /> : <HdriSkyDesktop />;
}

/**
 * DEV-only culling badge — displays ON/OFF state of backface culling toggle.
 * Listens for 'mockopoly:culling' custom events and renders a fixed badge.
 */
function CullingBadge() {
  const [off, setOff] = useState(false);

  useEffect(() => {
    const handler = (e: unknown) => {
      const evt = e as CustomEvent<{ off: boolean }>;
      setOff(evt.detail.off);
    };
    window.addEventListener('mockopoly:culling', handler);
    return () => window.removeEventListener('mockopoly:culling', handler);
  }, []);

  if (!import.meta.env.DEV) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 150,
        left: 8,
        zIndex: 60,
        pointerEvents: 'none',
        padding: '6px 12px',
        borderRadius: '4px',
        backgroundColor: off ? '#a12a2a' : '#1f7a3f',
        color: '#ffffff',
        fontFamily: 'monospace',
        fontSize: '12px',
        fontWeight: 'bold',
        whiteSpace: 'nowrap',
      }}
    >
      {off ? 'CULLING: OFF' : 'CULLING: ON'}
    </div>
  );
}

/**
 * DEV-only culling audit component.
 * Press "c" in dev mode to log material side counts and expose scene/gl to window.
 * Press "v" in dev mode to toggle backface culling on/off (DoubleSide ↔ original).
 * Renders null; passive keydown listener only.
 */
let cullingOff = false;

function CullingAudit() {
  const { scene, gl } = useThree();

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'c' || e.key === 'C') {
        // Culling audit: log material side counts and expose scene/gl.
        const counts = { Front: 0, Double: 0, Back: 0 };
        let meshes = 0;

        scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          const mat = mesh.material;
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive check for malformed geometry
          if (!mat) return;

          meshes += 1;
          (Array.isArray(mat) ? mat : [mat]).forEach((material) => {
            const side = material.side;
            if (side === THREE.FrontSide) {
              counts.Front += 1;
            } else if (side === THREE.BackSide) {
              counts.Back += 1;
            } else {
              counts.Double += 1;
            }
          });
        });

        console.log(
          '[culling audit] materials — FrontSide (backface culling ON):',
          counts.Front,
          '| DoubleSide (culling OFF):',
          counts.Double,
          '| BackSide:',
          counts.Back,
          '| meshes:',
          meshes
        );
        console.log('[render info]', JSON.parse(JSON.stringify(gl.info.render)));
        (window as unknown as { __scene?: unknown }).__scene = scene;
        (window as unknown as { __gl?: unknown }).__gl = gl;
        console.log('exposed window.__scene and window.__gl');
      } else if (e.key === 'v' || e.key === 'V') {
        // Toggle backface culling on/off.
        if (!cullingOff) {
          // Turn culling OFF — set all materials to DoubleSide.
          scene.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            const mat = mesh.material;
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive check for malformed geometry
            if (!mat) return;

            (Array.isArray(mat) ? mat : [mat]).forEach((material: THREE.Material) => {
              // Store original side once in userData.
              // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- userData is dynamically set
              if (!material.userData.__origSide) {
                material.userData.__origSide = material.side;
              }
              material.side = THREE.DoubleSide;
            });
          });
          cullingOff = true;
          console.log('[culling] OFF — all DoubleSide (backface culling disabled)');
        } else {
          // Turn culling back ON — restore original sides.
          scene.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            const mat = mesh.material;
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive check for malformed geometry
            if (!mat) return;

            (Array.isArray(mat) ? mat : [mat]).forEach((material: THREE.Material) => {
              const origSide = (material.userData.__origSide as THREE.Side | undefined) ?? THREE.FrontSide;
              material.side = origSide;
            });
          });
          cullingOff = false;
          console.log('[culling] ON — restored original sides');
        }
        console.log('[render info]', JSON.parse(JSON.stringify(gl.info.render)));
        // Emit culling state change to DOM for the badge overlay.
        window.dispatchEvent(new CustomEvent<{ off: boolean }>('mockopoly:culling', { detail: { off: cullingOff } }));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [scene, gl]);

  return null;
}

export function GameScene() {
  // Container for the drei Stats panel — positioned below CameraDebugOverlay
  // (which sits at top:56) so the two don't overlap.
  const statsParentRef = useRef<HTMLDivElement>(null);
  // Mobile in-game view must be clean: all dev/debug overlays are suppressed on
  // phones (the FPS Stats, CullingBadge, CullingAudit). Desktop is unchanged.
  const isMobile = useIsMobile();

  return (
    <>
    {/* Fixed container that hosts the stats.js DOM panel. Must be a sibling of
        Canvas (not a child) so it sits in normal DOM flow outside the WebGL layer.
        Uses safe-area-inset-top to clear notches on landscape mobile. */}
    <div
      ref={statsParentRef}
      style={{
        position: 'fixed',
        top: 'max(8px, env(safe-area-inset-top))',
        left: 'max(8px, env(safe-area-inset-left) + 8px)',
        zIndex: 60,
        pointerEvents: 'none',
      }}
    />
    {/* DEV-only culling state badge — placed below FPS stats panel. Hidden on
        mobile so the in-game view stays clean. */}
    {!isMobile && <CullingBadge />}
    <Canvas
      style={{ position: 'fixed', inset: 0 }}
      // Reverted to original nice framing. Board content is rotated via BOARD_ROTATION
      // group instead of moving the camera — camera props only apply on mount and
      // are HMR-inert; rotating the board content is reliable and frame-accurate.
      camera={{ position: [0, 8.5, 12], fov: 50 }}
      // Shadows ON for desktop; OFF on mobile. Dropping the whole shadow render
      // pass is a big mobile win (see the KEY light + adaptive-dpr notes).
      shadows={!isMobile}
      // Always-render on BOTH desktop and mobile: every frame steps Rapier physics
      // + all useFrame loops, so the dice roll (physics-driven) behaves identically
      // to desktop. Mobile stays sustainable via adaptive dpr (below), not by
      // gating frames.
      frameloop="always"
      // MOBILE starts at the crisp native dpr (capped at 2 for thermal headroom
      // under always-render); the controller swaps to MOBILE_DPR_MOVING while the
      // CAMERA moves and back on settle. Desktop unchanged: dpr={[1, 1.5]}.
      dpr={isMobile ? MOBILE_DPR_STILL : [1, 1.5]}
      performance={{ min: 0.5 }}
      gl={{ powerPreference: 'high-performance', antialias: false, alpha: false }}
    >
      {/*
        Flat sky fallback — only used when the HDRI sky is NOT shown as the
        background. When SHOW_HDRI_BACKGROUND is true the Environment paints the
        scene background with the equirect sky instead.
      */}
      {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- SHOW_HDRI_BACKGROUND is a documented build-time toggle (see header) */}
      {!SHOW_HDRI_BACKGROUND && <color attach="background" args={['#cbe8f5']} />}
      {/* MOBILE-ONLY distance fog (see FOG_* consts). Declared here, early in the
          scene tree, so scene.fog exists before ShaderWarmup's compileAsync and the
          first frame — every fog-enabled material links with USE_FOG on the first
          compile (no first-frame recompile hitch). Linear THREE.Fog so fog=1.0 lands
          exactly at FOG_FAR (deterministic cutoff for the forest ring cull). Only
          the SCENE pass consumes it; the board opts out via material.fog=false. On
          desktop this is not mounted → scene.fog stays null → byte-identical. */}
      {isMobile && (
        <fog
          attach="fog"
          args={[MOBILE_NIGHT_MODE ? MOBILE_NIGHT_FOG_COLOR : FOG_COLOR, FOG_NEAR, FOG_FAR]}
        />
      )}
      {/* Soft shadow injection (must be early in the scene, no assets).
          Desktop only: SoftShadows (drei PCSS) costs a per-fragment sample loop
          on every shadow-receiving pixel. On mobile we skip it so Canvas
          `shadows` falls back to the cheaper built-in PCFSoftShadowMap —
          shadows stay ON (they add depth), just rendered more cheaply. */}
      {!isMobile && <SoftShadows size={12} samples={8} />}
      {/* DEV-only culling audit — press "c" to log material side counts.
          Skipped on mobile (no keyboard; keeps the mobile scene graph lean). */}
      {!isMobile && <CullingAudit />}
      {/* MOBILE-ONLY adaptive-dpr controller. Registers the dpr bus and wires the
          canvas pointer/wheel CAMERA-motion listeners that drive the moving↔still
          dpr swap. NEVER mounted on desktop, so desktop stays byte-identical. */}
      {isMobile && (
        <MobileRenderController
          dprMoving={MOBILE_DPR_MOVING}
          dprStill={MOBILE_DPR_STILL}
          settleMs={MOBILE_SETTLE_MS}
        />
      )}
      {/* DEV-only draw-call/triangle readout (mobile only) — shows live WebGL stats
          to verify frustum culling. Rotate camera to watch counts drop as off-screen
          chunks are culled. Tree-shaken from production. */}
      {import.meta.env.DEV && isMobile && <RenderStatsReadout />}
      {/* Sky/ground hemisphere fill. DESKTOP: cool sky / olive ground, trimmed
          0.35 → 0.25 so AO + the rig shape the scene instead of a flat wash.
          MOBILE twin: neutral daylight sky over a slightly darker warm ground
          bounce, RAISED 0.30 → 0.44 to a natural daylight fill so the shaded side
          reads — the raking KEY sun ANGLE does the shaping, not starved fill. */}
      {!isMobile && <hemisphereLight args={['#cbe8f5', '#8a9a5b', HEMI_INTENSITY]} />}
      {isMobile && (
        <hemisphereLight
          args={[
            MOBILE_NIGHT_MODE ? MOBILE_NIGHT_HEMI_SKY : MOBILE_HEMI_SKY,
            MOBILE_NIGHT_MODE ? MOBILE_NIGHT_HEMI_GROUND : MOBILE_HEMI_GROUND,
            MOBILE_NIGHT_MODE ? MOBILE_NIGHT_HEMI_INTENSITY : MOBILE_HEMI_INTENSITY,
          ]}
        />
      )}
      {/* Ambient floor. DESKTOP: 0.15 neutral — AO now darkens crevices the flat
          ambient was washing out; this just lifts pure black. MOBILE twin: a
          NEUTRAL soft floor RAISED 0.12 → 0.20 — lifts the deepest shade to a
          readable mid-tone; the raking directional KEY + longer baked shadow supply
          the darkening, so depth comes from direction not from crushed darks. */}
      {!isMobile && <ambientLight intensity={AMBIENT_INTENSITY} />}
      {isMobile && (
        <ambientLight
          color={MOBILE_NIGHT_MODE ? MOBILE_NIGHT_AMBIENT_COLOR : MOBILE_AMBIENT_COLOR}
          intensity={MOBILE_NIGHT_MODE ? MOBILE_NIGHT_AMBIENT_INTENSITY : MOBILE_AMBIENT_INTENSITY}
        />
      )}
      {/* KEY (the sun). DESKTOP: warm, the ONLY shadow caster; position + ortho
          shadow-camera bounds kept exactly as before. castShadow is now a bare
          constant (true) — identical on desktop since this element renders ONLY
          there. Desktop keeps shadows + SoftShadows exactly. */}
      {!isMobile && (
        <directionalLight
          color={KEY_COLOR}
          position={KEY_POSITION}
          intensity={KEY_INTENSITY}
          castShadow
          shadow-mapSize={[1024, 1024]}
        >
          <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
        </directionalLight>
      )}
      {/* MOBILE KEY twin — a LOWERED ~31° neutral warm-white raking sun (intensity
          2.1) so the boxy city walls get a bright side + a dark side and stop reading
          flat. It is the mobile shadow CASTER: its map is BAKED ONCE (frozen) by
          MobileCrispBoardPipeline (renderer autoUpdate off), so castShadow + a 1536²
          map cost a single shadow render at load and nothing per frame. POSITION
          moved (Y 11→5.5), so the frozen map RE-BAKES ONCE at load from the light's
          live world matrix — no offline step, no per-frame cost. The lower sun throws
          LONGER shadows (height × cot31° ≈ height × 1.68, toward [-7,·,-6], ~2× the
          old ≈50°), so the ortho frame is WIDENED to [-12,12,12,-12, 0.5, 30]: a tall
          city tower's shadow tip reaches ~(-8.8,-8.3) world — outside the old ±8, so
          ±12 contains it with margin. Far plane 30 still brackets the light (it moved
          CLOSER, dist √115≈10.74) ± the ±12 frame; near 0.5 clears the nearest caster.
          shadow-normalBias raised 0.02→0.035 to kill the extra grazing-angle acne the
          lower incidence adds — now paired with the softer 1536² map, whose larger
          texels need a touch more normal offset (bias stays -0.0004 — normalBias is
          the correct lever, deepening depth-bias would risk contact detachment).
          SHADOW-DRAMA VALUE: shadow-intensity={0.9} sets the receive to 90% strength (a
          receive-time mix(1.0, shadow, intensity) in the shadow chunk, fully compatible
          with the frozen/autoUpdate-off map and FREE), RAISED from the over-softened
          0.75 last round so the board slab + city tower cast shadows GROUND clearly and
          add the reference's depth/mood. NOT crushed-black: the shaded surface still
          gets hemi(0.44×0.5) + ambient(0.17) + env(1.0) fill (~1.1 luma), so 0.90 reads
          as a deep-but-COLORED occlusion, and the 10% key bleed keeps a hair of
          softness (go 1.0 for max — still non-black via fill). Tunable 0.88–0.95. EDGE
          softness: PCFSoftShadowMap penumbra, bias −0.0004, normalBias 0.035. The ortho
          frame + map size come from MOBILE_SHADOW_ORTHO_HALF / MOBILE_SHADOW_MAP_SIZE
          (±25 / 2048² when forest shadows are on so near tree shadows land on the
          visible ground, else the ±12 / 1536² pre-feature frame). Desktop's KEY (above)
          is untouched → byte-identical. */}
      {isMobile && (
        <directionalLight
          color={MOBILE_NIGHT_MODE ? MOBILE_NIGHT_KEY_COLOR : MOBILE_KEY_COLOR}
          position={MOBILE_KEY_POSITION}
          intensity={MOBILE_NIGHT_MODE ? MOBILE_NIGHT_KEY_INTENSITY : MOBILE_KEY_INTENSITY}
          castShadow
          shadow-mapSize={[MOBILE_SHADOW_MAP_SIZE, MOBILE_SHADOW_MAP_SIZE]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.05}
          shadow-intensity={MOBILE_NIGHT_MODE ? MOBILE_NIGHT_KEY_SHADOW_INTENSITY : 0.9}
        >
          <orthographicCamera
            attach="shadow-camera"
            args={[
              -MOBILE_SHADOW_ORTHO_HALF,
              MOBILE_SHADOW_ORTHO_HALF,
              MOBILE_SHADOW_ORTHO_HALF,
              -MOBILE_SHADOW_ORTHO_HALF,
              0.5,
              MOBILE_SHADOW_CAMERA_FAR,
            ]}
          />
        </directionalLight>
      )}
      {/* WARM FOCAL BOARD LIGHT (mobile NIGHT only) — a warm point light above the board
          CENTER that keeps the board + city readable and glows the near terrain, falling
          off into the dark surroundings (the campfire-valley read). castShadow=FALSE: the
          moon KEY is the SOLE shadow caster, so the frozen shadow bake is unchanged and no
          second caster/mediump-shadow exposure is added. The mobile pipeline additively
          enables BOARD/CITY/GROUND layers on every light, so this reaches those passes. */}
      {isMobile && MOBILE_NIGHT_MODE && (
        <pointLight
          color={MOBILE_NIGHT_WARM_COLOR}
          position={MOBILE_NIGHT_WARM_POSITION}
          intensity={MOBILE_NIGHT_WARM_INTENSITY}
          distance={MOBILE_NIGHT_WARM_DISTANCE}
          decay={MOBILE_NIGHT_WARM_DECAY}
          castShadow={false}
        />
      )}
      {/* FILL: cool, low, opposite-ish angle — softens the shadow side without
          flattening the form. No shadow (perf + avoids double shadows). Dropped on
          mobile to reduce per-fragment light loops. */}
      {!isMobile && (
        <directionalLight
          color={FILL_COLOR}
          position={FILL_POSITION}
          intensity={FILL_INTENSITY}
          castShadow={false}
        />
      )}
      {/* RIM / BACK: cool-bright, high and behind — edge-lights the tops of
          trees/buildings/tokens for separation from the sky. No shadow. Dropped on
          mobile to reduce per-fragment light loops. */}
      {!isMobile && (
        <directionalLight
          color={RIM_COLOR}
          position={RIM_POSITION}
          intensity={RIM_INTENSITY}
          castShadow={false}
        />
      )}
      {/*
        Sky/env — HdriSky is a parent selector (isMobile) that mounts one of two
        siblings. DESKTOP (HdriSkyDesktop): useTexture loads /images/sky.webp
        (suspends), sets EquirectangularReflectionMapping + SRGBColorSpace, then
        assigns scene.environment (ENV_INTENSITY IBL) and, when
        SHOW_HDRI_BACKGROUND is true, scene.background (BG_INTENSITY) — deterministic
        vs. drei <Environment files=...>. MOBILE (HdriSkyMobile): loads the SAME
        /images/sky.webp (read-only reuse of the shared asset; desktop's path
        untouched) and assigns it to both scene.background and scene.environment
        (MOBILE_*_INTENSITY) — a real daylight equirect for directional sky IBL +
        real reflections instead of the old flat gradient. Both branches suspend via
        useTexture, so the outer Suspense covers either.
      */}
      <Suspense fallback={null}>
        <HdriSky />
      </Suspense>
      {/* OrbitControls + gentle auto-focus toward active player's tile. */}
      <CameraRig />
      {/*
        BOARD_ROTATION group — rotates ALL board content together about Y so GO
        physically moves from bottom-left to bottom-right. ForestEnvironment stays
        OUTSIDE this group so the surrounding nature stays fixed in the clearing.

        Token alignment: PlayerTokens drives positions via tileToWorld() in local
        space. Inside this rotated parent, both the printed board texture AND the
        tileToWorld positions rotate identically → tokens remain on their correct
        printed tiles. No changes needed to positions.ts or PlayerTokens.
      */}
      <group rotation={[0, BOARD_ROTATION, 0]}>
        {/* Dice3D and BoardClickTargets load no assets — fine without Suspense. */}
        <Dice3D />
        <BoardClickTargets />
        <Suspense fallback={null}>
          {/* BoardTiles, PlayerTokens, Buildings, CityDressing all suspend
              (useTexture / useGLTF) — must stay inside a Suspense boundary. */}
          <BoardTiles />
          <PlayerTokens />
          <Buildings />
          {/* CityDressing (city.glb) is the low-poly city in the board center. */}
          <CityDressing isMobile={isMobile} night={isMobile && MOBILE_NIGHT_MODE} />
          {/* MOBILE NIGHT-ONLY: cheap warm street-lamp glow markers around the board
              perimeter (emissive-only, no real light). Day + desktop never mount it. */}
          {isMobile && MOBILE_NIGHT_MODE && MOBILE_NIGHT_STREETLIGHTS && <NightStreetLights />}
        </Suspense>
      </group>
      <Suspense fallback={null}>
        {/* ForestEnvironment (forest.glb) surrounds the board — the diorama
            ground/treeline. Kept OUTSIDE the rotation group so the forest
            stays fixed as the board turns within its clearing. */}
        <ForestEnvironment isMobile={isMobile} />
      </Suspense>
      {/* Shader precompile warmup — compiles every scene material at LOAD (once
          all async assets have settled) so first-appearance shader links don't
          hitch the main thread. Invisible; compiles programs only. */}
      <ShaderWarmup />
      {isMobile ? (
        /*
          MOBILE crisp-board pipeline (replaces the mobile <EffectComposer>).
          Renders the board texture at NATIVE dpr (razor-crisp text) in its own
          pass, composites it by depth over the reduced-dpr forest/city/tokens/sky
          scene, and applies the realistic/neutral mobile grade — FXAA -> Sharpen
          (over the raw linear-HDR composite) -> ACES_FILMIC ToneMapping ->
          HueSaturation -> BrightnessContrast -> WarmGrade (NEUTRAL split-tone seam)
          -> sRGB — ONCE over the composited linear image, so board and scene are
          graded identically. No vignette (stylization dropped for the PBR look).
          The heavy scene stays at MOBILE_SCENE_DPR (1.5) for
          framerate; only the board (a cheap opaque raster) + composite + grade run
          at native dpr. Forest edges and tokens/houses correctly occlude the board
          (shared camera depth), with a view-Z bias at the token/board contact to
          kill shimmer. See MobileCrispBoardPipeline. Desktop keeps its own
          single-pass composer below (byte-identical). The grade knobs are the
          MOBILE_* values (decoupled from the frozen desktop SATURATION / BRIGHTNESS
          / CONTRAST), applied by a hand-built EffectPass.
        */
        <MobileCrispBoardPipeline
          saturation={MOBILE_NIGHT_MODE ? MOBILE_NIGHT_SATURATION : MOBILE_SATURATION}
          brightness={MOBILE_BRIGHTNESS}
          contrast={MOBILE_NIGHT_MODE ? MOBILE_NIGHT_CONTRAST : MOBILE_CONTRAST}
          exposure={MOBILE_NIGHT_MODE ? MOBILE_NIGHT_EXPOSURE : MOBILE_EXPOSURE}
          fxaaSubpixelQuality={MOBILE_FXAA_SUBPIXEL_QUALITY}
          sceneDpr={MOBILE_SCENE_DPR}
          cityDpr={MOBILE_CITY_DPR}
          depthBias={MOBILE_BOARD_DEPTH_BIAS}
          cityDepthBias={MOBILE_CITY_DEPTH_BIAS}
          ssaoEnabled={MOBILE_SSAO_ENABLED}
          ssaoIntensity={MOBILE_SSAO_INTENSITY}
          ssaoRadius={MOBILE_SSAO_RADIUS}
          ssaoDistanceFalloff={MOBILE_SSAO_DISTANCE_FALLOFF}
          ssaoHalfRes={MOBILE_SSAO_HALF_RES}
          ssaoAoSamples={MOBILE_SSAO_AO_SAMPLES}
          ssaoDenoiseSamples={MOBILE_SSAO_DENOISE_SAMPLES}
          ssaoDenoiseRadius={MOBILE_SSAO_DENOISE_RADIUS}
          ssaoColor={MOBILE_SSAO_COLOR}
          tiltShiftEnabled={MOBILE_TILTSHIFT_ENABLED}
          tiltShiftOffset={MOBILE_TILTSHIFT_OFFSET}
          tiltShiftFocusArea={MOBILE_TILTSHIFT_FOCUS_AREA}
          tiltShiftFeather={MOBILE_TILTSHIFT_FEATHER}
          tiltShiftResolutionScale={MOBILE_TILTSHIFT_RESOLUTION_SCALE}
          tiltShiftKernelSize={MOBILE_TILTSHIFT_KERNEL_SIZE}
        />
      ) : (
        <EffectComposer multisampling={0} stencilBuffer={false}>
          {/*
            Order matters: N8AO -> Bloom -> ToneMapping -> global color grade ->
            SMAA. AO runs FIRST so contact/crevice darkening is baked into the
            beauty pass before Bloom reads luminance and before the tone-map +
            grade. Grading then runs on the tone-mapped LDR image so
            saturation/contrast make colors POP instead of amplifying HDR values
            tone mapping later clamps. SMAA runs LAST (post-grade) to smooth
            final edges.

            multisampling={0} + stencilBuffer={false}: MSAA is intentionally
            OFF here. With multisampling>0 the composer renders to a
            multisampled target with a combined depth-stencil attachment, and
            N8AO's depth read during that MSAA resolve blit collides with it —
            GL_INVALID_OPERATION: glBlitFramebuffer (read/write depth-stencil
            same image). Dropping MSAA removes that resolve blit entirely.
            depthBuffer stays default (true) since N8AO needs depth. SMAA below
            replaces MSAA for edge anti-aliasing (and is cheaper than 2x MSAA).
          */}
          <N8AO
            aoRadius={AO_RADIUS}
            distanceFalloff={AO_DISTANCE_FALLOFF}
            intensity={AO_INTENSITY}
            quality={AO_QUALITY}
            halfRes={AO_HALF_RES}
          />
          <Bloom intensity={0.35} luminanceThreshold={0.9} luminanceSmoothing={0.3} mipmapBlur />
          <ToneMapping />
          {/* Main "game look" saturation knob (0 = unchanged, +0.28 ≈ +28% pop). */}
          <HueSaturation saturation={SATURATION} />
          {/* Brightness/contrast trim (both 0 = unchanged); slight contrast punch. */}
          <BrightnessContrast brightness={BRIGHTNESS} contrast={CONTRAST} />
          {/* Edge AA replacement for the dropped MSAA (see note above). */}
          <SMAA />
        </EffectComposer>
      )}
      {/* FPS counter — DEV-only perf readout (never ships to production).
          Shown on mobile too so devs can check mobile framerate during HMR dev.
          Mounted into statsParentRef (the fixed div sibling above) with safe-area
          positioning to clear notches. */}
      {import.meta.env.DEV && <Stats parent={statsParentRef} className="fps-stats" />}
    </Canvas>
    </>
  );
}
