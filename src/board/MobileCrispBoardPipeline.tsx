import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import {
  EffectPass,
  ToneMappingEffect,
  ToneMappingMode,
  HueSaturationEffect,
  BrightnessContrastEffect,
  FXAAEffect,
  TiltShiftEffect,
} from 'postprocessing';
import { FullScreenQuad } from 'three-stdlib';
// DEPTH-ONLY SSAO (MOBILE-ONLY). N8AOPostPass reconstructs normals from DEPTH
// alone — no NormalPass / full-screen normal render, i.e. no extra full-screen
// geometry pass, which is exactly the fill cost this pipeline must avoid. It is
// driven imperatively here (setDepthTexture + render) against the SCENE FBO's
// depth. Desktop is untouched: it uses the <N8AO> REACT wrapper inside its own
// <EffectComposer> (see GameScene.tsx, !isMobile branch) — a separate entry point.
import { N8AOPostPass } from 'n8ao';
import { SharpenEffectImpl } from '../screens/SharpenEffect';
import { WarmGradeEffectImpl } from '../screens/WarmGradeEffect';
import { PreExposureEffectImpl } from '../screens/PreExposureEffect';
import { useGameStore } from '../state/gameStore';
import { BOARD_LAYER, CITY_LAYER, FOREST_GROUND_LAYER, MOBILE_FOREST_SHADOWS_ENABLED } from './positions';
import { thermalSceneDprCap } from './mobileRender';

/**
 * ── MOBILE NIGHT SKY AT NATIVE DPR (NIGHT-ONLY, TOGGLE) ──────────────────────
 * When true (and the scene is in mobile NIGHT mode with an equirect
 * scene.background), the night HDRI sky is NO LONGER drawn into the reduced-dpr
 * scene FBO (≈1.5×, blurry). Instead pass 1 renders the forest/ground/tokens
 * into a TRANSPARENT scene FBO (sky pixels carry far-plane depth) and the
 * COMPOSITE pass — which runs at NATIVE dpr — reconstructs each pixel's world
 * view-ray from the inverse view-projection and samples the equirect night HDRI
 * DIRECTLY as its backmost base (crisp, camera-responsive, bypassing three's
 * 1024-face equirect→cube background resample). The forest/board/city tiers then
 * depth-composite OVER that native sky exactly as before.
 *
 * The equirect mapping (equirectUv: u = atan(dir.z,dir.x)/2π + 0.5,
 * v = asin(dir.y)/π + 0.5) is COPIED verbatim from three's common.glsl.js so the
 * visible sky aligns bit-for-bit (modulo the dropped cube resample) with three's
 * own background AND the IBL (scene.environment, same equirect, same convention).
 *
 * FALLBACK: flip to false → EXACT pre-feature behavior (sky drawn into the
 * reduced-dpr scene FBO). DAY and DESKTOP never touch this path regardless.
 */
// Typed `boolean` (not the literal `true`) so the FALLBACK path documented above stays a
// live, type-checked branch for a rebuild flip — as the literal, the two `&&` arms in the
// night-native arming block are "always truthy" and the pre-feature sky path reads as
// dead code. Same pattern as MOBILE_FOREST_SHADOWS_ENABLED in positions.ts.
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- the `boolean` annotation is deliberate; see above
const MOBILE_NIGHT_SKY_NATIVE: boolean = true;

// Scratch matrix for the per-frame inverse view-projection fed to the composite's
// native-sky view-ray reconstruction. Module-scoped (the pipeline is a singleton).
const _skyInvViewProj = new THREE.Matrix4();

/**
 * ── MOBILE BLOOM REMOVED (perf) ──────────────────────────────────────────────
 * The mobile grade pass previously merged a subtle BloomEffect. Although a
 * non-convolution effect adds no *standalone* EffectPass, BloomEffect's internal
 * mipmap-blur RT ignores resolutionScale and renders at native present dpr — i.e.
 * ~1.5-2 wasted full-screen passes for a very subtle glow. It is dropped on the
 * fill-bound mobile path. The sun-glow already lives baked in the procedural sky
 * texture, so the only visible loss is the faint emissive city-window glow —
 * acceptable. (Desktop keeps its own EffectComposer bloom, untouched.)
 */

/**
 * ── MOBILE CRISP-BOARD PIPELINE (MOBILE ONLY) ────────────────────────────────
 *
 * Replaces the mobile <EffectComposer>. It renders the board texture at NATIVE
 * device-pixel-ratio (razor-crisp text) and the center city at a reduced dpr (~1.5)
 * while keeping the rest of the expensive scene (forest / tokens / ground / HDRI
 * sky) at dpr 2 for framerate, then depth-composites the THREE tiers and applies
 * the SAME colour grade the mobile composer used — once, over the composited
 * linear-HDR image, so every tier is graded identically.
 *
 * WHY THREE PASSES: a single FBO has ONE resolution, so a per-object resolution
 * (native board, dpr-1.5 city, dpr-2 rest) REQUIRES a per-object PASS — each tier
 * renders into its own render target at its own dpr, and a depth composite merges
 * them for arbitrary (fully free-orbit) camera poses.
 *
 * WHY NOT A COMPOSER EFFECT: a single postprocessing EffectComposer runs every
 * pass at ONE resolution, so a composite added as its last effect would re-sample
 * the board back down to the composer's dpr — not crisp. The board being crisp
 * REQUIRES the final present to happen at native dpr, which needs a small custom
 * render orchestration (this component) rather than a declarative composer.
 *
 * FRAME GRAPH (per frame, in a useFrame at renderPriority 1 so R3F's auto-render
 * is suppressed and this is the only thing that presents):
 *   1. SCENE pass  — camera.layers = {0} (board + city EXCLUDED) → sceneFBO
 *                    [css × min(dpr,sceneDpr), HalfFloat LINEAR + DepthTexture]
 *   2. BOARD pass  — camera.layers = {BOARD_LAYER} (board ONLY), sky suppressed
 *                    → boardFBO [css × dpr (native), HalfFloat LINEAR + DepthTexture]
 *   3. CITY pass   — camera.layers = {CITY_LAYER} (city ONLY), sky suppressed
 *                    → cityFBO [css × min(dpr,cityDpr), HalfFloat LINEAR + DepthTexture]
 *   4. COMPOSITE   — depth-merge city over board over scene (native) → compositeFBO
 *   5. GRADE       — the reused mobile grade EffectPass over compositeFBO → canvas
 *                    (native): FXAA → Sharpen (over the RAW linear-HDR composite, so
 *                    their neighbour taps and centre share one colour space) →
 *                    PreExposure (linear-HDR midtone lift, still pre-tonemap) →
 *                    ACES_FILMIC ToneMapping → HueSaturation → BrightnessContrast →
 *                    WarmGrade (NEUTRAL/identity split-tone seam) → sRGB, encoded
 *                    once. (No vignette — the realistic look drops all stylization.)
 *
 * All passes share the SAME scene + camera, so the board AND city inherit the SAME
 * lights (this component additively enables BOTH BOARD_LAYER and CITY_LAYER on every
 * light — lights are layer gated too) and the SAME scene.environment (HDRI IBL, not
 * layer gated) → they are lit IDENTICALLY to the single-pass render. NOT separate
 * un-lit scenes. scene.fog is not layer gated either, so the city stays fogged.
 *
 * MOVING vs STILL: everything keys off the live renderer pixel ratio. At rest the
 * renderer is at native dpr (crisp board); while the camera moves the adaptive-dpr
 * controller drops the renderer to the cheap MOVING dpr, so the board + composite +
 * grade all fall to that dpr too (crispness only matters at rest) — orbits stay fast.
 *
 * Desktop never mounts this (it keeps its own single-pass <EffectComposer>).
 */

interface MobileCrispBoardPipelineProps {
  /**
   * Mobile NIGHT mode (GameScene MOBILE_NIGHT_MODE). Together with the module-level
   * MOBILE_NIGHT_SKY_NATIVE toggle and an equirect scene.background, this arms the
   * native-dpr sky path (sky drawn crisp in the composite instead of the reduced-dpr
   * scene FBO). false (DAY) leaves the pipeline byte-identical to before.
   */
  nightMode: boolean;
  /**
   * Mobile NIGHT sky SOURCE (GameScene NIGHT_SKY_MODE). 'procedural' (default) draws
   * the crisp per-pixel procedural night sky in the composite (no texture, no OOM);
   * 'hdri' samples the equirect night HDRI bound as scene.background (the 34a08a6
   * path). Only consulted when nightMode && MOBILE_NIGHT_SKY_NATIVE; DAY/desktop
   * ignore it. In 'procedural' mode scene.background is null (env-only IBL), so the
   * native-sky path is armed from THIS prop rather than a background texture.
   */
  skyMode: 'procedural' | 'hdri';
  /** HueSaturation `saturation` — same value the mobile composer used. */
  saturation: number;
  /** BrightnessContrast `brightness` — same value the mobile composer used. */
  brightness: number;
  /** BrightnessContrast `contrast` — same value the mobile composer used. */
  contrast: number;
  /**
   * PreExposure `uExposure` — a linear-HDR MULTIPLY applied PRE-tonemap (between
   * Sharpen and the ACES ToneMapping) to lift midtones out of the too-dark ACES
   * compression; 1.0 = unchanged. See PreExposureEffect. MOBILE-ONLY.
   */
  exposure: number;
  /** FXAA `subpixelQuality` — same value the mobile composer used. */
  fxaaSubpixelQuality: number;
  /**
   * Fixed dpr for the EXPENSIVE scene pass (forest / city / tokens / sky). The
   * scene FBO is sized css × min(liveDpr, sceneDpr); the board + composite +
   * present use the full (native) liveDpr. Decoupling these is what lets the board
   * be native-crisp while the scene stays cheap.
   */
  sceneDpr: number;
  /**
   * Fixed dpr for the CITY pass (the low-poly center city). The city FBO is sized
   * css × min(liveDpr, cityDpr); at rest liveDpr is native so the city renders at
   * cityDpr (≈1.5), and while orbiting liveDpr drops to the cheap MOVING dpr so the
   * city collapses with the rest of the scene (crispness only matters at rest).
   * Splitting the city into its own pass is what lets it carry its own resolution.
   */
  cityDpr: number;
  /**
   * View-space-Z bias (world-ish units) so a token/house base — which sits ON the
   * board surface (zBoard ≈ zScene at the contact) — resolves to the SCENE, not the
   * board, killing z-fight shimmer at the contact. The board wins a pixel only if it
   * is nearer than the scene by more than this. Tune on-device: too small → contact
   * shimmer; too large → the board visibly recedes behind low geometry.
   */
  depthBias: number;
  /**
   * View-space-Z bias for the CITY tie-break, OPPOSITE in direction to depthBias.
   * The city is physically the foreground object sitting ON the board/ground, so it
   * WINS near-ties against whatever occupies the pixel (scene or board) — it wins if
   * its view-Z is within cityBias of the current surface. A tree genuinely IN FRONT
   * still occludes it (its view-Z is clearly nearer). Keep small (~0.02–0.03): too
   * large and the city punches through near-front foliage within that margin; too
   * small and the 1.5-vs-native contact shimmer returns.
   */
  cityDepthBias: number;
  /**
   * ── SOFT AMBIENT OCCLUSION / SSAO (MOBILE-ONLY, DEPTH-ONLY N8AO) ────────────
   * MASTER on/off (MOBILE_SSAO_ENABLED). When false the N8AOPostPass is NOT
   * constructed, its extra colour target is NOT allocated, and the per-frame AO
   * render is skipped — the pipeline is byte-for-byte the pre-SSAO path (a pure
   * perf/A-B kill-switch). When true, the AO is computed from the SCENE FBO's DEPTH
   * (the landscape / forest / mountains / hills — the 90% of screen), multiplied
   * over the scene colour into its own linear-HDR target, and that AO-darkened scene
   * colour becomes the composite's `sceneColor` base — so contact darkening lands
   * under trees, rocks, hill valleys and board-on-ground BEFORE the board + city
   * tiers are depth-composited on top and BEFORE the single grade pass. Board/city
   * are separate FBOs (their own depth) so they are NOT self-occluded here — the
   * landscape AO is the headline unlock; per-tier AO would need a merged-depth MRT
   * (the same fill cost that ruled out DoF, see the grade-pass note).
   */
  ssaoEnabled: boolean;
  /** N8AO `intensity` — AO darkening strength (1.0 = natural; higher = deeper). */
  ssaoIntensity: number;
  /**
   * N8AO `aoRadius` — occlusion sample radius in WORLD units. The board/scene is
   * ~10 units across; ~1.5 is deliberately WIDER than desktop's 0.7 so the AO reads
   * as SOFT blended grounding in hill valleys + under tree/building clusters, not
   * just tiny crevices. Raise for broader/softer occlusion, lower to tighten.
   */
  ssaoRadius: number;
  /**
   * N8AO `distanceFalloff` — how quickly occlusion fades with view-space distance
   * (fraction of radius). ~1.0 keeps AO local and avoids dark halos across depth gaps.
   */
  ssaoDistanceFalloff: number;
  /**
   * N8AO `halfRes` — compute AO at HALF resolution then depth-aware upsample
   * (resolutionScale 0.5): the dominant fill knob (¼ the AO-loop pixels). true is the
   * briefed default. NOTE (iOS): the half-res path uses an internal MRT with an R32F +
   * RGBA16F attachment (float render targets); if that ever fails on-device, flip to
   * false for the MRT-FREE full-res fallback (normals reconstructed in-shader, reads
   * only the depth texture the composite already samples — no float RTs, no MRT).
   */
  ssaoHalfRes: boolean;
  /** N8AO `aoSamples` — AO samples/pixel (quality vs cost). 16 = balanced. */
  ssaoAoSamples: number;
  /** N8AO `denoiseSamples` — bilateral denoise taps; more = smoother/softer AO. */
  ssaoDenoiseSamples: number;
  /** N8AO `denoiseRadius` — bilateral denoise radius (px); widens the soft blur. */
  ssaoDenoiseRadius: number;
  /**
   * N8AO `color` (hex) — occlusion tint, MULTIPLIED with the scene colour
   * (colorMultiply). A slightly cool/dark navy biases contact shadows COOL to match
   * the cool-shadow grade direction; '#000000' = neutral (darken toward black).
   */
  ssaoColor: string;
  /**
   * ── TILT-SHIFT / MINIATURE-DIORAMA (MOBILE-ONLY) ───────────────────────────
   * MASTER on/off (MOBILE_TILTSHIFT_ENABLED). When false the TiltShiftEffect is NOT
   * constructed and NOT added to the grade EffectPass, so the half-res Kawase blur, its
   * RT and its per-frame update() are entirely absent — a ~1.5-3ms/frame perf WIN and no
   * "weird" defocus. When true the band is built from the knobs below. All tilt-shift
   * knobs still flow through regardless so the effect stays fully tunable on re-enable.
   */
  tiltShiftEnabled: boolean;
  /**
   * TiltShiftEffect `offset` — screen-Y CENTRE of the razor-sharp band, in
   * framebuffer units where the FULL screen height spans 2.0 (bottom −1, centre 0,
   * top +1). 0.0 = band centred on screen-Y. POSITIVE nudges the sharp band toward
   * the TOP (far terrain), negative toward the near/city side. See the FOCUS BAND
   * note on the effect construction below.
   */
  tiltShiftOffset: number;
  /**
   * TiltShift `focusArea` — half-height (in the same 2.0-per-screen units) of the
   * FEATHER-out edge: full blur begins beyond `offset ± focusArea`, the fully-sharp
   * core is `offset ± (focusArea − feather)`. Kept GENEROUS (0.85) so the entire
   * board + centre city stays inside the sharp+feather zone across the whole mobile
   * camera envelope while the distant mountains (top) and extreme near ground
   * (bottom) blur — the miniature read.
   *
   * FREE-CAMERA CAVEAT (review fix): this band is SCREEN-SPACE, not world-locked, so
   * it is NOT true that a free-camera move can only ever weaken the blur. Under the
   * old ±0.6 cutoff, a deep zoom-in (to minDistance 4.0 ≈ 1.7× the idle 6.9 framing)
   * or a vertical pan could push the NEAR/FAR board rows past ±0.6 into full blur —
   * the board itself softening. Widening to 0.85 shrinks full blur to the outer ~15%
   * top/bottom, which the clamped mobile camera (maxPolarAngle 1.35, minDistance 4.0,
   * MIN_TARGET_Y −0.3) cannot drive the board into; at the most extreme zoom-in+pan
   * the outermost board rows reach only the SOFT feather (reads as depth), never the
   * hard full-blur. Lower → stronger diorama but the board can re-enter full blur;
   * raise toward 1.0 → full blur pushed off-screen (mildest, guaranteed sharp).
   */
  tiltShiftFocusArea: number;
  /** TiltShift `feather` — softness (same units) of the focus-area edge ramp. */
  tiltShiftFeather: number;
  /**
   * TiltShift blur RT `resolutionScale` — the internal Kawase blur renders at
   * `resolutionScale` × the pass's native size PER AXIS (0.5 ⇒ a QUARTER of the
   * pixels). The dominant fps knob: lower is BOTH cheaper AND a softer/larger-reading
   * blur. Escalate 0.5 → 0.4 → 0.35 if over budget.
   */
  tiltShiftResolutionScale: number;
  /**
   * TiltShift Kawase `kernelSize` — the `KernelSize` enum value (numeric). Bigger =
   * wider blur radius AND more iterations (more cost). MEDIUM start; drop to SMALL
   * first if over budget, raise to LARGE for a stronger diorama if under budget.
   */
  tiltShiftKernelSize: number;
}

// Full-screen composite. Vertex maps the FullScreenQuad's PlaneGeometry(2,2)
// positions (already in [-1,1]) straight to clip space; no matrices needed.
const compositeVertexShader = /* glsl */ `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const compositeFragmentShader = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D sceneColor;
uniform highp sampler2D sceneDepth;
uniform sampler2D boardColor;
uniform highp sampler2D boardDepth;
uniform sampler2D cityColor;
uniform highp sampler2D cityDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform float depthBias;
uniform float cityBias;
// ── NIGHT-NATIVE SKY (uNightSky == 1 only) ─────────────────────────────────
// uSky: the equirect night HDRI (SRGB internal format → hardware-decoded to
// linear on sample, matching the linear-HDR composite space). uSkyIntensity:
// scene.backgroundIntensity (matches three's background multiply). uInvViewProj:
// inverse(projection * view) to reconstruct the world view-ray per pixel.
// When uNightSky == 0 (DAY / desktop / toggle-off) NONE of this is read — uSky is
// bound to a valid fallback texture and the branch is skipped: byte-identical.
uniform float uNightSky;
uniform sampler2D uSky;
uniform float uSkyIntensity;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
// ── PROCEDURAL NIGHT SKY (uProcedural == 1 && uNightSky == 1) ────────────────
// When 1, the sky base is generated PER-PIXEL from dir (no texture fetch) —
// crisp at any dpr, zero VRAM. uSky is NOT read in this branch (it stays bound to
// a valid fallback texture). When 0 the equirect HDRI (uSky) is sampled instead
// (the 34a08a6 native-HDRI path). Both are gated behind uNightSky.
uniform float uProcedural;
in vec2 vUv;
out vec4 fragColor;

// three's equirectUv (common.glsl.js) VERBATIM — matches scene.background AND the
// IBL so the native sky aligns with the environment lighting.
const float RECIPROCAL_PI = 0.3183098861837907;
const float RECIPROCAL_PI2 = 0.15915494309189535;
vec2 equirectUv(in vec3 dir) {
  float u = atan(dir.z, dir.x) * RECIPROCAL_PI2 + 0.5;
  float v = asin(clamp(dir.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5;
  return vec2(u, v);
}

// three's perspectiveDepthToViewZ: non-linear [0,1] depth -> negative view-space Z.
// All passes share the same camera, so these are directly comparable; a NEARER
// surface yields a LARGER (less-negative) value. Converting to view-Z makes the bias
// uniform in world space across the whole depth range.
float viewZ(float depth) {
  return (cameraNear * cameraFar) / ((cameraFar - cameraNear) * depth - cameraFar);
}

// ═══════════════════════════════════════════════════════════════════════════
// PROCEDURAL NIGHT SKY — ASTROPHOTOGRAPHY REWRITE
//
// A believable night sky built PER-PIXEL from the world view-ray alone: a deep navy
// gradient with horizon airglow, a filamentary warm-cream MILKY WAY band carved by
// dark red-brown dust lanes, and a pixel-locked star field (dense fine field +
// sparse hero stars with soft halos, power-law brightness, warm/neutral/blue-white
// colour spread, atmospheric extinction toward the horizon). No texture, ~0 VRAM,
// crisp at any dpr → also eliminates the 8K-background OOM crash class.
//
// ── WHAT THE PREVIOUS VERSION GOT WRONG (do not reintroduce) ───────────────
//  1. STARS ON A 3D LATTICE. It sampled 'floor(dir * density)' — a 3D cube lattice
//     cut by the UNIT SPHERE. Wherever the sphere grazes a cell tangentially the
//     "distance-to-point < radius" test stays true across a large solid angle, so a
//     single star smeared into a 40–80px soft SQUARE / slanted parallelogram, and
//     star angular size varied by >10× with view direction. FIX: a 2D lattice on an
//     EQUI-ANGULAR CUBE FACE (see faceQ) with the star footprint measured against
//     the PIXEL's own angular size — so every star is the same 1–2 device-px dot
//     regardless of view direction or zoom, which is also exactly what a real,
//     optically-unresolved point source does.
//  2. MILKY WAY AT ~16° FEATURE SIZE. 'fbm(dir * 3.5)', 3 octaves of 3D noise,
//     inside ONE fat σ=0.22 gaussian, tinted flat grey (0.32,0.34,0.40) → grey
//     smoke, and at 0.35 linear it graded to a 184/255 grey WASH. FIX: 2D FBM in the
//     band's OWN (longitude, distance-from-plane) frame, strongly ANISOTROPIC so
//     filaments and dust lanes run ALONG the band, a NARROW bright core ridge inside
//     a WIDE faint halo, and warm-cream / blue-white / red-brown tints.
//
// ── LINEAR SPACE + THE NIGHT GRADE (READ THIS BEFORE TUNING) ───────────────
// Everything returned here is LINEAR radiance (composite FBO is HalfFloat /
// NoColorSpace). The grade pass then applies PreExposure(0.95) → ACES_FILMIC →
// HueSaturation(−0.1) → BrightnessContrast(contrast +0.22, applied in sRGB space) →
// sRGB encode. That chain is BLACK-CRUSHING: +0.22 contrast maps sRGB 0.11 → 0, so
// any linear radiance below ~0.029 lands at PURE BLACK, and 0.94 already clips to
// white — the whole sky has to live inside linear [0.03, 1.0] (plus HDR star cores
// above it, for the ACES shoulder). Anchors measured through the REAL chain:
//     linear 0.029 →   0/255     linear 0.100 →  71/255
//     linear 0.040 →  15/255     linear 0.160 → 112/255
//     linear 0.055 →  33/255     linear 0.350 → 184/255
//     linear 0.080 →  54/255     linear 1.400 → 255/255
// This is why the base-sky values below look "too bright" for a night sky in
// isolation: at the old 0.004–0.032 the entire base sky was mathematically BLACK.
//
// ── PRECISION (iOS) ───────────────────────────────────────────────────────
// This shader declares 'precision highp float' at the top of the file, so every
// float — and every hash below — is fp32 on iOS. That is LOAD-BEARING: these
// fract-chain hashes visibly quantise (and the star lattice collapses into bands) at
// mediump/fp16, and stray mediump is exactly what gets shaders silently rejected by
// the iOS/Metal compiler. Belt and braces: every hash declares its working locals
// 'highp' EXPLICITLY so the numerics survive even if this block is ever pasted into
// a shader with a different default precision. Hash ARGUMENTS are also bounded by
// construction (star cell indices ≤ ~1400, noise domain ≤ ~600 — see the face-offset
// consts) so the final 'fract' never runs out of mantissa. Nothing here uses a
// large-magnitude 'sin(dot(p,k)) * 43758.5453' hash (the classic iOS casualty).
//
// ── TUNABLES (art knobs — tune on device) ──────────────────────────────────
// ┌─ BASE SKY (linear radiance) ─────────────────────────────────────────────
const vec3  SKY_ZENITH_COL   = vec3(0.0300, 0.0360, 0.0520); // deep navy overhead → rgb(4,10,24)
const vec3  SKY_HORIZON_COL  = vec3(0.0440, 0.0495, 0.0620); // lifted + less saturated low
const float SKY_GRAD_LO      = -0.08; // dir.y at which the HORIZON colour is fully reached
const float SKY_GRAD_HI      =  0.60; // dir.y at which the ZENITH colour is fully reached
// AIRGLOW — a faint warm sliver hugging the horizon (real airglow + light pollution).
// Cheap (1 exp) and it is most of what stops the gradient reading as a flat wash.
const vec3  AIRGLOW_COL      = vec3(0.0140, 0.0112, 0.0052); // warm; ADDED on top of the gradient
const float AIRGLOW_HEIGHT   = 0.09;  // e-fold height in dir.y (~5° — keep it low and thin)
const float AIRGLOW_FADE_LO  = -0.05; // fades out below the horizon line …
const float AIRGLOW_FADE_HI  =  0.01; // … and is full just above it
// ┌─ MILKY WAY BAND ────────────────────────────────────────────────────────
// A GREAT CIRCLE: s = dot(dir, BAND_NORMAL) is the signed sine of the angular
// distance from the band plane (s = 0 IS the core ridge).
//
// BAND_NORMAL.y IS cos(the band's peak elevation) — exactly, because the band's high
// point is normalize(+Y − n·n.y). THAT IS THE KNOB THAT MATTERS, because the mobile
// camera can only ever SEE a low strip of sky: MOBILE_MAX_POLAR_ANGLE 1.52 with
// MOBILE_MIN_CAM_Y 1.0 puts the view axis ~3–10° BELOW horizontal, so with fov 50 the
// visible sky runs from the horizon to only ~+22° (≈+29° in the frame corners). The
// old normal (0.1495, 0.2492, 0.9568) had .y = 0.249 → a band peaking at 76°, i.e.
// crossing the horizon at a near-VERTICAL 76° and never showing its core inside the
// visible strip. 0.788 → the band peaks at 38° elevation and sweeps DIAGONALLY across
// the upper frame — the classic landscape-astro "Milky Way rising" read, visible over
// a wide range of orbit azimuths. Rotate the horizontal part (x,z) to move WHICH
// azimuth it rises from; keep |y| well below 1 (at |y| → 1 the band lies flat on the
// horizon and the +Y-based band frame below degenerates).
const vec3  BAND_NORMAL      = vec3(0.3080, 0.7880, 0.5330); // .y = cos(38°) → peaks at 38° el
const float BAND_INTENSITY   = 1.00;  // master band multiplier (fastest A/B knob)
const float BAND_CORE_SIGMA  = 0.055; // NARROW bright ridge (FWHM ≈ 7.4° ≈ 135 device px)
const float BAND_HALO_SIGMA  = 0.180; // WIDE faint halo around it (FWHM ≈ 23°)
const float BAND_CORE_GAIN   = 0.135; // peak core radiance → ~120/255 through the grade
const float BAND_HALO_GAIN   = 0.026; // peak halo radiance → a subtle cool lift
const float BAND_DUST_GAIN   = 0.050; // red-brown glow ADDED inside the dust lanes
const vec3  BAND_CORE_COL    = vec3(1.00, 0.82, 0.56); // warm cream / pale gold core
const vec3  BAND_EDGE_COL    = vec3(0.55, 0.72, 1.00); // cooler blue-white at the edges
const vec3  BAND_DUST_COL    = vec3(1.00, 0.42, 0.15); // dark red-brown dust
// ANISOTROPIC noise frequencies, as (ALONG the band, ACROSS the band). The across
// value being ~4× the along value is what makes structure read as FILAMENTS parallel
// to the band instead of round blobs — the single biggest visual lever here.
const vec2  BAND_CLOUD_FREQ  = vec2(2.2, 8.0);  // mid-freq mottled cloud (≈475×130 px cells)
const vec2  BAND_DUST_FREQ   = vec2(2.6, 16.0); // dust lanes: long, thin, band-parallel
const float BAND_CLOUD_LO    = 0.28;  // cloud → clump ramp (start). Raise for more gaps.
const float BAND_CLOUD_HI    = 0.80;  // cloud → clump ramp (end)
const float BAND_CLOUD_DEPTH = 0.88;  // how far the clump ramp can dim the core (1 = to 0)
const float BAND_HALO_DEPTH  = 0.45;  // same, for the wide halo (kept gentler)
const float BAND_DUST_LO     = 0.46;  // dust-lane carve ramp (start)
const float BAND_DUST_HI     = 0.74;  // dust-lane carve ramp (end)
const float BAND_DUST_STR    = 0.92;  // how hard a lane cuts the core (1 = fully)
const float BAND_EXT_FLOOR   = 0.25;  // band brightness AT the horizon vs. above it
#define     BAND_OCTAVES       3      // cloud FBM octaves — PRIMARY sky ALU knob (2..4)
#define     BAND_DUST_OCTAVES  2      // dust FBM octaves — secondary ALU knob (1..3)
// ┌─ STARS ─────────────────────────────────────────────────────────────────
// DENSITY is in cells per equi-angular cube-face unit (1 face unit = π/4 rad), so
// on-screen cell size ≈ (π/4) / (DENSITY · radiansPerPixel). At fov 50°, 390 css ×
// dpr 2.5 ≈ 975 px tall → ~9.6e-4 rad/px → a 72-cell face gives ~11 device-px cells
// (≈1900 visible stars). KEEP THESE INTEGRAL: a whole number of cells per face means
// the cube-face seams land exactly on cell boundaries, so no cell straddles a seam
// and no star is ever half-drawn. Also keep cells ≳ 6 px: the star footprint is
// clamped to the cell (see starLayer) and would start being cropped below that.
const float STAR_DENSITY     = 72.0;  // fine-field cells per face unit (higher = finer/denser)
const float STAR_PROB        = 0.32;  // fraction of cells holding a star (thins the field)
const float STAR_BAND_MULT   = 1.90;  // density multiplier ON the band (unresolved-star haze)
const float STAR_POW         = 9.00;  // brightness power law — HIGHER = far fewer bright stars
const float STAR_MAG_FLOOR   = 0.030; // faintest star radiance fraction (the faint dusting)
const float STAR_GAIN        = 1.15;  // brightest fine-star radiance (>1 ⇒ ACES rolls it off)
const float STAR_R_MIN_PX    = 1.15;  // PSF radius (DEVICE PX) of the faintest stars
const float STAR_R_MAX_PX    = 1.90;  // PSF radius (DEVICE PX) of the brightest ones
const float STAR_JITTER      = 0.52;  // sub-cell placement spread (0 = dead centre, 1 = edges)
const vec3  STAR_COL_MID     = vec3(0.92, 0.96, 1.00); // the neutral majority
const vec3  STAR_COL_WARM    = vec3(1.00, 0.70, 0.42); // warm/amber minority
const vec3  STAR_COL_BLUE    = vec3(0.58, 0.76, 1.00); // blue-white minority
const float STAR_WARM_FRAC   = 0.30;  // colour-index below this ramps into WARM
const float STAR_BLUE_FRAC   = 0.74;  // colour-index above this ramps into BLUE
// HERO stars — their own, much coarser lattice (so their halo has room inside its
// cell), HDR-bright cores + a soft compact halo.
const float HERO_DENSITY     = 13.0;  // ~60 heroes over the visible sky
const float HERO_PROB        = 0.26;
const float HERO_POW         = 1.30;  // shallow → heroes are genuinely bright
const float HERO_MAG_FLOOR   = 0.18;
const float HERO_GAIN        = 2.20;  // >1 ⇒ blown to white by ACES, as a bright star should
const float HERO_R_MIN_PX    = 1.40;
const float HERO_R_MAX_PX    = 2.40;
const float HERO_JITTER      = 0.60;
const float HERO_HALO        = 0.045; // halo peak as a fraction of the core (0 = no halo)
const float HERO_HALO_SCALE  = 5.00;  // halo radius = this × core radius (clamped to the cell)
// ATMOSPHERIC EXTINCTION — stars (and, more gently, the band) fade out toward and
// below the horizon instead of marching at full brightness into the ground line.
// Kept TIGHT to the horizon on purpose: the visible sky only reaches ~+22° (see
// BAND_NORMAL), so a wide ramp would extinguish the entire star field.
const float STAR_EXT_LO      = -0.015; // dir.y where stars are fully extinguished
const float STAR_EXT_HI      =  0.130; // dir.y where they reach full brightness (~7.5°)
// Per-face lattice offsets. Integral and spaced WIDER than the per-face cell span
// (±DENSITY) so no two faces — and neither layer — can ever share a cell index, while
// staying small enough to keep the hashes numerically clean (see PRECISION above).
const vec2  STAR_FACE_OFF    = vec2(163.0, 101.0); // × faceId; span ±72 ⇒ disjoint
const vec2  HERO_FACE_OFF    = vec2(31.0, 23.0);   // × faceId; span ±13 ⇒ disjoint
const vec2  HERO_FACE_BASE   = vec2(1201.0, 853.0); // lifts heroes clear of the fine lattice
const float FOUR_OVER_PI     = 1.2732395447351628;
const float EAC_K            = 0.3476; // equi-angular face warp strength (see faceQ)

// 2D→1D hash → [0,1) (Dave Hoskins-style: cheap, no texture tap, no big constants).
float hash21(vec2 p) {
  highp vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// 2D→4D hash. ONE tap yields a star's existence / sub-cell x,y / brightness, and a
// 5th (colour) value is remixed from those below — so a whole star costs one hash.
vec4 hash42(vec2 p) {
  highp vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
// 2D value noise (bilinear over 4 hashed corners). HALF the taps of the 3D value
// noise this replaces (4 vs 8) — which is what pays for the extra band octaves.
float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// FBM → normalised ~[0,1]. 'oct' is always one of the BAND_*_OCTAVES defines at the
// call sites, so this unrolls; those defines are the sky's primary ALU knobs.
float fbm2(vec2 p, int oct) {
  float a = 0.5;
  float s = 0.0;
  float norm = 0.0;
  for (int i = 0; i < oct; i++) {
    s += a * vnoise2(p);
    norm += a;
    p = p * 2.03 + vec2(17.3, 5.9);
    a *= 0.5;
  }
  return s / norm;
}
// (4/π)·atan(x) for |x| ≤ 1, as a 4-ALU polynomial (max error ~0.4%). Turns the
// gnomonic cube-face coordinate into an EQUI-ANGULAR one: cell angular size becomes
// (near-)constant over the face instead of varying 5.2× between face centre and cube
// corner, which would otherwise show up as a cube-shaped star-DENSITY pattern. A real
// atan() would cost a transcendental for accuracy this does not need.
float eac(float x) {
  return x + EAC_K * x * (1.0 - abs(x));
}
// Direction → equi-angular CUBE FACE coords, returned as (u, v, faceId) with u,v in
// [-1,1]. The dominant axis picks the face; the other two components divided by it
// give the gnomonic face coords; eac() then equalises them. This is the fix for the
// "huge soft squares" defect: a 2D lattice on a cube face has uniform-ish angular
// cell size and NO pole singularity, unlike a 3D lattice cut by the unit sphere.
vec3 faceQ(vec3 dir) {
  vec3 ad = abs(dir);
  vec2 q;
  float fid;
  if (ad.x >= ad.y && ad.x >= ad.z) {
    q = dir.zy / ad.x;
    fid = dir.x < 0.0 ? 1.0 : 0.0;
  } else if (ad.y >= ad.z) {
    q = dir.xz / ad.y;
    fid = dir.y < 0.0 ? 3.0 : 2.0;
  } else {
    q = dir.xy / ad.z;
    fid = dir.z < 0.0 ? 5.0 : 4.0;
  }
  return vec3(eac(q.x), eac(q.y), fid);
}
// One star layer on the cube face. Samples ONLY the cell containing fq: the star is
// jittered inside the cell's middle and its radius is CLAMPED to the remaining
// margin, so the whole PSF provably stays inside its own cell → 1 hash tap, no
// neighbour lookups, and no star can ever be clipped by a cell (or face) boundary.
//
// 'pixFace' is the pixel's angular footprint expressed in face units, so the PSF
// radius is specified in DEVICE PIXELS (STAR_R_*_PX): a star is the same small dot
// whatever the view direction or zoom — which is both what an unresolved point
// source physically does and the reason this never aliases, shimmers or drops out.
// The kernel is the compact quartic (1−t²)², C¹ and zero at its edge, so it is
// inherently anti-aliased against that footprint without a fixed smoothstep radius.
vec3 starLayer(vec2 fq, float density, vec2 faceOff, float pixFace, float prob,
               float pw, float magFloor, float gain, float rMinPx, float rMaxPx,
               float jitter, float haloAmt, float haloScale) {
  vec2 gp = fq * density + faceOff;
  vec2 cell = floor(gp);
  vec4 h = hash42(cell);
  if (h.x >= prob) return vec3(0.0); // most cells are empty; cells span many pixels
  float mag = mix(magFloor, 1.0, pow(h.w, pw)); // power-law: many faint, few bright
  float radMax = 0.5 - 0.5 * jitter;            // margin left by the jitter, in cell units
  float rad = min(pixFace * density * mix(rMinPx, rMaxPx, mag), radMax);
  vec2 sp = 0.5 + (h.yz - 0.5) * jitter;
  float d = length(gp - cell - sp);
  float t = min(d / rad, 1.0);
  float core = 1.0 - t * t;
  core *= core;
  // Soft halo (hero layer only — haloAmt is a literal 0.0 at the fine-field call
  // site, so this whole block folds away there). Cubed for a softer knee, and its
  // radius is clamped to the same cell margin so it cannot leak a square edge.
  float ht = min(d / min(rad * haloScale, radMax), 1.0);
  float hs = 1.0 - ht * ht;
  hs = hs * hs * hs;
  // Colour: a 5th random remixed from the hash. Most stars stay near STAR_COL_MID,
  // with a warm minority below STAR_WARM_FRAC and a blue one above STAR_BLUE_FRAC.
  // (Both ramps are written edge0 < edge1 — GLSL leaves smoothstep UNDEFINED for a
  // reversed pair, so the warm side is '1 - smoothstep', not 'smoothstep(hi, 0, x)'.)
  float ct = fract(h.y * 31.7 + h.z * 17.3 + h.x * 7.1);
  vec3 tint = mix(STAR_COL_MID, STAR_COL_WARM, 1.0 - smoothstep(0.0, STAR_WARM_FRAC, ct));
  tint = mix(tint, STAR_COL_BLUE, smoothstep(STAR_BLUE_FRAC, 1.0, ct));
  return tint * (gain * mag * (core + haloAmt * hs));
}
// 'pixAng' is the pixel's angular footprint in radians (see main(): it is derived
// from the view-ray derivatives in UNIFORM control flow, which is what makes it
// legal). It is the only thing the star field needs to stay pixel-crisp.
vec3 proceduralNightSky(vec3 dir, float pixAng) {
  // ── BASE: navy gradient + a thin warm airglow hugging the horizon ─────────
  vec3 col = mix(SKY_HORIZON_COL, SKY_ZENITH_COL, smoothstep(SKY_GRAD_LO, SKY_GRAD_HI, dir.y));
  float airglow = exp(-max(dir.y, 0.0) / AIRGLOW_HEIGHT)
                * smoothstep(AIRGLOW_FADE_LO, AIRGLOW_FADE_HI, dir.y);
  col += AIRGLOW_COL * airglow;

  // ── MILKY WAY ────────────────────────────────────────────────────────────
  // Band-local frame. s = signed sine of the angular distance from the band plane
  // (s = 0 is the core ridge); the longitude is measured from t1 = the band's HIGHEST
  // point (the projection of +Y onto the band plane). Measuring from the high point
  // deliberately parks atan()'s ±π branch cut — the one seam in the noise domain — on
  // the band's NADIR, far below the horizon where extinction has already taken the
  // band to zero, so the seam is never visible. All four consts fold at compile time
  // (constant arguments), so the frame costs nothing at runtime and BAND_NORMAL stays
  // the single knob. The +1e-6 keeps atan(0,0) (dir exactly ‖ BAND_NORMAL, where the
  // band is zero anyway) out of undefined territory so no NaN can propagate.
  vec3 bn = normalize(BAND_NORMAL);
  vec3 t1 = normalize(vec3(0.0, 1.0, 0.0) - bn * bn.y);
  vec3 t2 = cross(bn, t1);
  float s = dot(dir, bn);
  float lon = atan(dot(dir, t2), dot(dir, t1) + 1e-6);
  // 2D FBM in that frame, ANISOTROPIC (freq.x along the band ≪ freq.y across it), so
  // structure reads as band-parallel filaments — 4 taps/octave instead of 8.
  vec2 q = vec2(lon, s);
  float cloud = fbm2(q * BAND_CLOUD_FREQ + vec2(4.3, 1.7), BAND_OCTAVES);
  float dust = fbm2(q * BAND_DUST_FREQ + vec2(19.1, 7.4), BAND_DUST_OCTAVES);
  // Envelope: a NARROW bright core ridge sitting inside a WIDE faint halo (the old
  // version had one fat gaussian, which is why it read as smoke rather than a band).
  float sc = s / BAND_CORE_SIGMA;
  float sh = s / BAND_HALO_SIGMA;
  float coreE = exp(-0.5 * sc * sc);
  float haloE = exp(-0.5 * sh * sh);
  // Mid-freq cloud clumps the core along the band; high-freq dust carves lanes out of
  // it AND adds its own dark red-brown glow, so a lane reads as DUST (warm, opaque,
  // still brighter than empty sky) instead of a hole punched in the band.
  float clump = mix(1.0 - BAND_CLOUD_DEPTH, 1.0, smoothstep(BAND_CLOUD_LO, BAND_CLOUD_HI, cloud));
  float lane = smoothstep(BAND_DUST_LO, BAND_DUST_HI, dust);
  float coreA = coreE * clump * (1.0 - BAND_DUST_STR * lane);
  float haloA = haloE * mix(1.0 - BAND_HALO_DEPTH, 1.0, cloud);
  // Extinction: shared ramp for stars (full) and the band (floored, so the band
  // still reaches the treeline instead of ending in mid-air).
  float ext = smoothstep(STAR_EXT_LO, STAR_EXT_HI, dir.y);
  vec3 band = BAND_CORE_COL * (coreA * BAND_CORE_GAIN)
            + BAND_EDGE_COL * (haloA * BAND_HALO_GAIN)
            + BAND_DUST_COL * (lane * coreE * BAND_DUST_GAIN);
  col += band * (BAND_INTENSITY * mix(BAND_EXT_FLOOR, 1.0, ext));

  // ── STARS: fine field + sparse heroes, both on the cube-face lattice ──────
  // One faceQ per pixel is shared by both layers (each just multiplies by its own
  // density and lattice offset). 1 face unit = π/4 rad by construction, so the pixel
  // footprint converts with a single multiply. The fine field is denser ON the band
  // (STAR_BAND_MULT) — the unresolved-star haze that makes a real band glow.
  vec3 fq = faceQ(dir);
  float pixFace = pixAng * FOUR_OVER_PI;
  float boost = mix(1.0, STAR_BAND_MULT, haloE);
  vec3 stars = starLayer(fq.xy, STAR_DENSITY, fq.z * STAR_FACE_OFF, pixFace,
                         STAR_PROB * boost, STAR_POW, STAR_MAG_FLOOR, STAR_GAIN,
                         STAR_R_MIN_PX, STAR_R_MAX_PX, STAR_JITTER, 0.0, 1.0);
  stars += starLayer(fq.xy, HERO_DENSITY, fq.z * HERO_FACE_OFF + HERO_FACE_BASE, pixFace,
                     HERO_PROB, HERO_POW, HERO_MAG_FLOOR, HERO_GAIN,
                     HERO_R_MIN_PX, HERO_R_MAX_PX, HERO_JITTER, HERO_HALO, HERO_HALO_SCALE);
  col += stars * ext;
  return col;
}
// ═══════════════════════════════════════════════════════════════════════════

void main() {
  // BASE: the scene tier. DAY/desktop: the scene FBO has full coverage (HDRI sky
  // fills the background) so it is the fallback everywhere. COLOR bilinear (smooth
  // upscale); DEPTH NEAREST (DepthTexture default) so the dpr2->native upscale never
  // invents an intermediate depth across a silhouette -> no halo.
  float sd = texture(sceneDepth, vUv).x;
  vec3 outC = texture(sceneColor, vUv).rgb;
  // NIGHT-NATIVE: the scene FBO was rendered sky-LESS (cleared transparent), so
  // empty pixels carry the far-plane depth (sd == 1.0). There the crisp native sky
  // is the base: reconstruct the world view-ray (far-plane NDC point through the
  // inverse view-projection, minus the camera) and sample the equirect. Detection
  // is DEPTH-based (not scene alpha) so it is unaffected by the SSAO pass, which
  // rewrites sceneColor into a separate buffer while sceneDepth stays the true depth.
  //
  // TWO NESTED BRANCHES, DELIBERATELY. The OUTER test is on a UNIFORM (uNightSky), so
  // every fragment of a 2×2 quad takes it together — which is precisely what makes the
  // dFdx/dFdy below WELL-DEFINED. They measure the pixel's angular footprint (the
  // procedural star field needs it to keep stars a fixed size in DEVICE PIXELS), and
  // derivatives are only defined in uniform control flow: taken inside the per-pixel
  // DEPTH test they would be garbage on every sky/geometry silhouette, where a quad
  // straddles that test. So the ray + footprint are computed first, and the depth test
  // (INNER, per-pixel) only decides whether the result is used. Derivatives of 'dir'
  // (not of the cube-face coords) are taken because 'dir' is smooth EVERYWHERE — face
  // coords jump at the cube seams, which would spike the footprint into a bright blob
  // along a seam. Note the footprint tracks the LIVE composite resolution, so while
  // the adaptive-dpr controller drops dpr during an orbit stars stay ~1.5 px (i.e.
  // momentarily larger in CSS px) rather than aliasing away — the right trade.
  // DAY / desktop (uNightSky == 0) skip the whole block: byte-identical to before.
  if (uNightSky > 0.5) {
    vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dir = normalize(wp.xyz / wp.w - uCamPos);
    float pixAng = max(max(length(dFdx(dir)), length(dFdy(dir))), 1e-7);
    if (sd >= 0.999999) {
      // PROCEDURAL (default): per-pixel sky from dir — crisp, no texture. HDRI:
      // sample the equirect night HDRI verbatim (the 34a08a6 path). Same LINEAR
      // output × uSkyIntensity so both grade identically downstream.
      vec3 sky = uProcedural > 0.5
        ? proceduralNightSky(dir, pixAng)
        : texture(uSky, equirectUv(dir)).rgb;
      outC = sky * uSkyIntensity;
    }
  }
  float zS  = viewZ(sd);
  float outZ = zS;

  // BOARD (native, sparse). rawB==1.0 => board wrote nothing (cleared to far).
  // Board wins over scene ONLY if strictly nearer by depthBias -> a token/house
  // base sitting ON the board (zB~=zS) resolves to the scene, killing contact shimmer.
  float rawB = texture(boardDepth, vUv).x;
  if (rawB < 1.0) {
    float zB = viewZ(rawB);
    if (zB > zS + depthBias) { outC = texture(boardColor, vUv).rgb; outZ = zB; }
  }

  // CITY (dpr1.5, sparse). rawC==1.0 => no city here. City is physically ON TOP of
  // board/ground, so it wins NEAR-TIES against whatever currently occupies the
  // pixel (scene OR board) via cityBias in its favor; a clearly-nearer scene
  // surface (forest tree in FRONT) still occludes it because then outZ >> zC and the
  // test fails. Depth NEAREST for the same anti-halo reason as the scene tier.
  float rawC = texture(cityDepth, vUv).x;
  if (rawC < 1.0) {
    float zC = viewZ(rawC);
    if (zC > outZ - cityBias) { outC = texture(cityColor, vUv).rgb; }
  }
  fragColor = vec4(outC, 1.0);
}
`;

// How long (ms, wall-clock since the load-gate first opens) the per-frame
// shadow-caster traversal keeps re-checking for a caster-count change before
// it settles down. Generous window for CityDressing's async glb mount/clone
// race (see the caster-signature comment in the bake block below) — after
// this a build action (buildingSig effect) is the only thing that re-arms it.
const CASTER_SIG_WINDOW_MS = 8000;

/** Linear-HDR render target; pass a DepthTexture to also capture depth. */
function makeTarget(depth: THREE.DepthTexture | null): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: depth !== null,
    stencilBuffer: false,
    depthTexture: depth ?? undefined,
  });
}

export function MobileCrispBoardPipeline({
  nightMode,
  saturation,
  brightness,
  contrast,
  exposure,
  fxaaSubpixelQuality,
  sceneDpr,
  cityDpr,
  depthBias,
  cityDepthBias,
  ssaoEnabled,
  ssaoIntensity,
  ssaoRadius,
  ssaoDistanceFalloff,
  ssaoHalfRes,
  ssaoAoSamples,
  ssaoDenoiseSamples,
  ssaoDenoiseRadius,
  ssaoColor,
  tiltShiftEnabled,
  tiltShiftOffset,
  tiltShiftFocusArea,
  tiltShiftFeather,
  tiltShiftResolutionScale,
  tiltShiftKernelSize,
  skyMode,
}: MobileCrispBoardPipelineProps): null {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const get = useThree((s) => s.get);

  // ── STATIC SHADOW BAKE readiness + guard ──────────────────────────────────
  // Same load gate ShaderWarmup uses (drei useProgress, backed by
  // THREE.DefaultLoadingManager): fire the one-shot bake only once ALL in-flight
  // async loads have settled (`active === false`) and at least one asset loaded
  // (`total > 0`), i.e. board/city/forest/buildings/tokens are all mounted.
  const progressActive = useProgress((s) => s.active);
  const progressTotal = useProgress((s) => s.total);
  // Flips true after the frozen shadow map has been baked; reset to false to
  // force a single re-bake (see the building-signature effect below + cleanup).
  const baked = useRef(false);
  // Shadow-CASTER signature (count of every castShadow===true mesh in the
  // scene) as of the last successful bake, and how long we've been checking
  // it — see the caster-signature re-bake trigger in the useFrame below. -1
  // is "never checked" so the very first post-load-gate frame always differs.
  const lastCasterSig = useRef(-1);
  const casterCheckElapsed = useRef(0);

  // RE-BAKE HOOK — buildings (houses/hotels) are the one semi-dynamic caster;
  // they appear/disappear mid-game. A stable string signature of every
  // property's house/hotel/mortgage state re-runs the effect only when a build
  // action actually changes what is on the board. Zustand compares the selector
  // result by value (strings are primitives), so unrelated GAME_STATE_UPDATEs
  // (money, position, toasts) do NOT churn it.
  const buildingSig = useGameStore((s) => {
    const props = s.state?.properties;
    if (!props) return '';
    let sig = '';
    for (const p of props) {
      sig += `${p.spaceIndex}:${p.houses}:${p.hasHotel ? 1 : 0}:${p.isMortgaged ? 1 : 0};`;
    }
    return sig;
  });
  useEffect(() => {
    // Skip the initial run — the first bake is driven by the load gate, not here.
    // Once baked, a building-signature change clears the guard so the NEXT frame
    // re-bakes the frozen map with the new houses/hotels captured (cheap: fires
    // only on a build action). If deferred, newly-built houses simply carry no
    // baked shadow until the next bake — acceptable, but this wires it.
    if (!baked.current) return;
    baked.current = false;
  }, [buildingSig]);

  // Build the FBOs, the composite material/quad, and the grade EffectPass once.
  // No WebGL calls happen at construction (only on first use / in initialize), so
  // this is safe to run during render. Grade knobs are build-time constants, so
  // listing them as deps effectively still builds once.
  const rig = useMemo(() => {
    const sceneDepthTex = new THREE.DepthTexture(2, 2, THREE.UnsignedIntType);
    const boardDepthTex = new THREE.DepthTexture(2, 2, THREE.UnsignedIntType);
    // City FBO — same format/type as the scene FBO (HalfFloat LINEAR + NEAREST
    // UnsignedInt DepthTexture), sized css × min(dpr, cityDpr) at bind time.
    const cityDepthTex = new THREE.DepthTexture(2, 2, THREE.UnsignedIntType);
    const sceneFBO = makeTarget(sceneDepthTex);
    const boardFBO = makeTarget(boardDepthTex);
    const cityFBO = makeTarget(cityDepthTex);
    const compositeFBO = makeTarget(null);

    // ── SOFT SSAO (MOBILE-ONLY, DEPTH-ONLY) ──────────────────────────────────
    // Built ONLY when enabled (null slot otherwise → zero cost / zero VRAM). The
    // AO reads the SCENE FBO's colour + DEPTH and writes the AO-MULTIPLIED scene
    // colour into aoSceneFBO (its own linear-HDR target — a separate buffer is
    // mandatory: N8AO reads sceneFBO.texture while writing, so writing back into
    // sceneFBO would be a read/write feedback on the same attachment). The
    // composite then uses aoSceneFBO as its `sceneColor` base (see below).
    //
    // gammaCorrection is left at its default (autosetGamma), and renderToScreen is
    // forced false → N8AO emits LINEAR (no sRGB OETF), matching this pipeline's
    // NoColorSpace HalfFloat buffers, so the AO'd scene stays in the same linear-HDR
    // space the composite + single grade pass expect (ACES/grade run once, downstream).
    // renderMode 0 (Combined) + colorMultiply true → occlusion multiplies the scene
    // colour (preserving texture in shadow) toward the cool `color` tint.
    //
    // NORMALS: N8AO reconstructs them from DEPTH — no NormalPass / full-screen normal
    // render — so this adds no extra geometry pass; the only new fill is the AO sample
    // loop (half-res when ssaoHalfRes) + denoise + one composite over the scene buffer.
    const aoSceneFBO = ssaoEnabled ? makeTarget(null) : null;
    let aoPass: N8AOPostPass | null = null;
    if (ssaoEnabled) {
      aoPass = new N8AOPostPass(scene, camera);
      aoPass.renderToScreen = false;
      const cfg = aoPass.configuration;
      cfg.aoSamples = ssaoAoSamples;
      cfg.denoiseSamples = ssaoDenoiseSamples;
      cfg.denoiseRadius = ssaoDenoiseRadius;
      cfg.aoRadius = ssaoRadius;
      cfg.distanceFalloff = ssaoDistanceFalloff;
      cfg.intensity = ssaoIntensity;
      cfg.screenSpaceRadius = false; // aoRadius is in WORLD units
      cfg.colorMultiply = true; // multiply occlusion into the scene colour
      cfg.color = new THREE.Color(ssaoColor); // cool/dark shadow tint
      cfg.halfRes = ssaoHalfRes; // resolutionScale 0.5 (MRT float path when true)
      cfg.depthAwareUpsampling = true;
      cfg.transparencyAware = false;
    }

    const compositeMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: compositeVertexShader,
      fragmentShader: compositeFragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        // Texture objects are stable across WebGLRenderTarget.setSize (only the GPU
        // storage is reallocated), so these references stay valid after a resize.
        // SSAO: when enabled, the scene BASE is the AO-darkened scene colour
        // (aoSceneFBO), otherwise the raw scene FBO — a build-time swap, so the
        // composite shader itself is unchanged (sceneDepth stays the scene depth).
        sceneColor: { value: (aoSceneFBO ?? sceneFBO).texture },
        sceneDepth: { value: sceneDepthTex },
        boardColor: { value: boardFBO.texture },
        boardDepth: { value: boardDepthTex },
        cityColor: { value: cityFBO.texture },
        cityDepth: { value: cityDepthTex },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        depthBias: { value: depthBias },
        cityBias: { value: cityDepthBias },
        // NIGHT-NATIVE SKY (set per-frame in useFrame). uNightSky 0 = OFF (day/
        // desktop/toggle-off) → the sky branch is skipped, byte-identical. uSky is
        // seeded with a VALID fallback texture (the scene FBO) so the sampler is
        // always bound even when unused.
        uNightSky: { value: 0 },
        // uProcedural 0 = sample the equirect HDRI (uSky); 1 = per-pixel procedural
        // sky (uSky unused). Set per-frame from NIGHT_SKY_MODE via the skyMode prop.
        uProcedural: { value: 0 },
        uSky: { value: sceneFBO.texture },
        uSkyIntensity: { value: 1 },
        uInvViewProj: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
      },
    });
    const quad = new FullScreenQuad(compositeMat);

    // Grade EffectPass — all non-convolution effects, so they MERGE into ONE
    // pass over the linear-HDR composite. sRGB OETF is applied once by
    // EffectMaterial.encodeOutput (on by default). Chain shape (order matters — see
    // the FXAA/Sharpen-FIRST rationale on the EffectPass below): FXAA + Sharpen run
    // FIRST over the RAW linear-HDR composite, THEN the ACES_FILMIC ToneMapping →
    // HueSaturation → BrightnessContrast trio, then the NEUTRAL split-tone seam
    // (WarmGrade — identity at its current realistic values, still merged so it can
    // be re-tuned without plumbing). NO vignette: the realistic look drops all
    // stylization. (Bloom was removed from this pass for fill-rate — see note above.)
    //
    // ToneMapping is ACES_FILMIC — the film-standard filmic tonemap (a REALISTIC
    // reference curve, kept). It is the sole tonemap: the renderer stays
    // NoToneMapping (set in the layout effect below) and the composite FBO is linear
    // HalfFloat/NoColorSpace, so ACES runs once on the linear-HDR composite. The
    // grade downstream shapes the tone-mapped LDR toward a natural, neutral look.
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const hueSat = new HueSaturationEffect({ saturation });
    const brightnessContrast = new BrightnessContrastEffect({ brightness, contrast });
    // Split-tone — NEUTRAL/identity at its current realistic values (see
    // WarmGradeEffect: all tints [1,1,1], strengths 0 → passthrough). Kept in the
    // chain as a merged, tunable seam; placed after the tone/hue/BC trio so it
    // would key off the final LDR luma if ever re-enabled.
    const warmGrade = new WarmGradeEffectImpl();
    const fxaa = new FXAAEffect({});
    // subpixelQuality is a define-backed setter (the R3F <FXAA subpixelQuality>
    // wrapper sets it the same way, via applyProps) — set BEFORE the pass builds
    // its merged shader in initialize().
    fxaa.subpixelQuality = fxaaSubpixelQuality;
    const sharpen = new SharpenEffectImpl();
    // Pre-exposure — a linear-HDR MULTIPLY inserted BETWEEN sharpen and the ACES
    // tonemap (see below + PreExposureEffect). It lifts linear midtones out of the
    // too-dark ACES compression; ACES then rolls the boosted highlights off near
    // white. Non-convolution Effect → merges into this same pass (zero new pass/RT).
    const preExposure = new PreExposureEffectImpl({ exposure });
    // ── TILT-SHIFT / MINIATURE-DIORAMA (MOBILE-ONLY) ──────────────────────────
    // Screen-vertical band blur (Kawase, NO depth buffer needed): a razor-sharp
    // horizontal band across the board with blur ramping up into the sky/mountains
    // (far) and down into the extreme near foreground — the classic "tiny tabletop
    // model" read at the default dolly-in pose (target = board centre → board
    // projects at screen-Y centre).
    //
    // WHY TiltShift and NOT DepthOfFieldEffect: DoF is declared
    // `attributes: EffectAttribute.DEPTH` and needs a per-fragment depth matching the
    // COLOUR it defocuses. This grade pass runs over `compositeFBO` = makeTarget(null)
    // — NO depth — and the three depth textures that DO exist are PER-TIER (the scene
    // depth EXCLUDES board+city), so there is no single depth matching the composited
    // colour. Wiring DoF would need a merged depth MRT during the composite plus its
    // internal CoC + near/far bokeh + mask sub-passes (~2-3× the fill) — the ">20fps"
    // overrun the brief forbids. TiltShift has NO `attributes` (defaults to
    // EffectAttribute.NONE) so it MERGES into this pass (no standalone convolution
    // sub-pass); its only new GPU work is one half-res Kawase blur into its OWN RT in
    // update(), and `mainImage` adds just one texture fetch + a mix. Cost is bounded
    // by resolutionScale (0.5 ⇒ ¼ pixels) and kernelSize (MEDIUM) → ~1.5-3ms on an
    // A15-class phone: the budgeted ~10-15fps hit that stays comfortably ≥ 65fps.
    //
    // FOCUS BAND (framebuffer units, full screen height = 2.0): rotation 0 (the
    // board's long axis is ~horizontal on screen at ~44° elevation); offset centres
    // the band; fully-sharp core = offset ± (focusArea − feather), full blur beyond
    // offset ± focusArea. With focusArea 0.85 / feather 0.35 the middle ~50% of
    // screen height (±0.5) is razor sharp, feathers out to ±0.85, and only the outer
    // ~15% top (sky/mountains) and bottom (extreme near ground) reach full blur — so
    // the whole board + centre city sit inside the sharp+feather zone at the idle
    // framing.
    //
    // REVIEW FIX — this band is SCREEN-SPACE, so it is NOT true (as an earlier note
    // claimed) that a free-camera move can only ever WEAKEN the blur. Under the old
    // ±0.6 cutoff a deep zoom-in (to minDistance 4.0 ≈ 1.7× the idle 6.9 framing) or
    // a vertical pan (MIN_TARGET_Y −0.3) could push the NEAR/FAR board rows past ±0.6
    // into full blur — the board itself softening. Widening to 0.85 confines full
    // blur to the outer ~15%, which the CLAMPED mobile camera (maxPolarAngle 1.35,
    // minDistance 4.0, MIN_TARGET_Y −0.3, MIN_CAM_Y 1.0) cannot drive a board row
    // into: at the most extreme reachable zoom-in+pan the outermost rows reach only
    // the SOFT feather (reads as depth), never the hard full-blur. A world-locked
    // band (projecting the board's screen-Y extent each frame to drive offset/
    // focusArea) would make this exact instead of enveloped, but adds per-frame
    // projection + degenerate-pose (w≤0/NaN) guarding to a pipeline the brief
    // requires stay blank-screen-proof; the widened static band is the bounded,
    // zero-new-failure-surface fix and needs no per-frame work.
    // GATED on tiltShiftEnabled (MOBILE_TILTSHIFT_ENABLED). When false the effect is
    // not constructed at all → no half-res Kawase blur pass, no RT, no per-frame
    // update() — a perf WIN, and the null slot is dropped from the pass below.
    const tiltShift = tiltShiftEnabled
      ? new TiltShiftEffect({
          offset: tiltShiftOffset,
          rotation: 0,
          focusArea: tiltShiftFocusArea,
          feather: tiltShiftFeather,
          kernelSize: tiltShiftKernelSize,
          resolutionScale: tiltShiftResolutionScale,
        })
      : null;
    // EFFECT ORDER — FXAA + SHARPEN FIRST, then tonemap + grade. WHY: in a merged
    // postprocessing EffectPass every effect shares ONE `inputBuffer` uniform = the
    // pass input (this linear-HDR composite FBO), so FXAA's edge samples and
    // Sharpen's 4 neighbour taps ALWAYS read that RAW buffer — a merged effect can
    // never sample a later effect's threaded colour. If FXAA/Sharpen ran AFTER the
    // grade (as they used to), their CENTRE (`inputColor` = the tonemapped+graded
    // LDR `color0`) and their neighbour taps (raw linear HDR) would live in
    // DIFFERENT colour spaces: Sharpen's unsharp mask would subtract an HDR value
    // from an LDR one — a frame-wide DC offset that lifts blacks / dulls highlights
    // and washes the ACES grade out — and FXAA would splice ungraded raw-HDR edge
    // pixels into the graded image (haloed, blown-out silhouette/text edges).
    // Running them FIRST makes centre and taps the SAME raw composite, and the
    // AA'd/sharpened result then flows through ACES + the full grade like every
    // other pixel — graded ONCE, uniformly. (Desktop fixes the identical problem
    // with a separate SMAA CONVOLUTION sub-pass, which reads the already-graded
    // buffer; the mobile path must stay a SINGLE pass for fill-rate, so it reorders
    // within the one pass instead of adding a pass/RT.) Sharpen floors its output at
    // 0 but NO LONGER clips the top (see SharpenEffect) so the >1 highlights survive
    // for ACES downstream.
    //
    // TILT-SHIFT SLOT (load-bearing) — AFTER sharpen, BEFORE preExposure. Like
    // FXAA/Sharpen, TiltShift blurs the pass INPUT (the RAW linear-HDR composite FBO)
    // into its internal RT and its mainImage does `mix(blurredMap, inputColor, mask)`
    // — so the blurred `map` is ALWAYS raw-linear-HDR composite space. Placing it here
    // makes `inputColor` at this slot ALSO raw-linear-HDR (after Sharpen keeps the
    // unsharp detail in the sharp band, before PreExposure/ACES), so BOTH the sharp
    // centre and the blurred map share ONE colour space. The mixed (partly defocused)
    // linear-HDR result then flows ONCE through PreExposure → ACES ToneMapping →
    // HueSat → BC → WarmGrade and is sRGB-encoded ONCE by EffectMaterial.encodeOutput
    // at pass end — no double-tonemap (renderer stays NoToneMapping; ACES is the sole
    // tonemap), and the defocus happens in LINEAR light pre-tonemap where physically-
    // correct blur/highlight-bleed belongs. TiltShift declares NO `attributes`
    // (EffectAttribute.NONE, like FXAA here) so it MERGES — no extra convolution
    // sub-pass — and is initialize()d/setSize()d/dispose()d by this same gradePass.
    // ENABLE PATH: `tiltShift` is null unless MOBILE_TILTSHIFT_ENABLED, so the
    // conditional spread drops the slot entirely when disabled (default) — the merged
    // grade shader is built WITHOUT the tilt-shift mix and its blur RT never exists.
    // Set MOBILE_TILTSHIFT_ENABLED = true to splice the band blur back into the chain.
    const gradePass = new EffectPass(
      camera,
      fxaa,
      sharpen,
      ...(tiltShift ? [tiltShift] : []),
      preExposure,
      toneMapping,
      hueSat,
      brightnessContrast,
      warmGrade,
    );
    // Present straight to the canvas at native dpr (outputBuffer ignored).
    gradePass.renderToScreen = true;

    return {
      sceneFBO,
      boardFBO,
      cityFBO,
      compositeFBO,
      aoSceneFBO,
      aoPass,
      sceneDepthTex,
      boardDepthTex,
      cityDepthTex,
      compositeMat,
      quad,
      gradePass,
    };
  }, [
    camera,
    scene,
    saturation,
    brightness,
    contrast,
    exposure,
    fxaaSubpixelQuality,
    depthBias,
    cityDepthBias,
    ssaoEnabled,
    ssaoIntensity,
    ssaoRadius,
    ssaoDistanceFalloff,
    ssaoHalfRes,
    ssaoAoSamples,
    ssaoDenoiseSamples,
    ssaoDenoiseRadius,
    ssaoColor,
    tiltShiftEnabled,
    tiltShiftOffset,
    tiltShiftFocusArea,
    tiltShiftFeather,
    tiltShiftResolutionScale,
    tiltShiftKernelSize,
  ]);

  // Last native pixel size the grade pass was sized to (its FXAA/Sharpen texelSize).
  const lastNative = useRef({ w: 0, h: 0 });

  // One-time GL setup + teardown, keyed to the rig so a rebuild re-initializes.
  // useLayoutEffect (not passive) so it runs BEFORE the first frame: R3F's useFrame
  // subscribes in a layout effect, so the grade pass must already be initialize()d
  // and the lights already on BOARD_LAYER when the loop first fires (mirrors how the
  // postprocessing composer sets its passes up in a layout effect). It:
  //  - initializes the grade pass (builds its merged shader for HalfFloat buffers),
  //  - forces NoToneMapping on the renderer (the ToneMapping EFFECT tonemaps, exactly
  //    as the composer did — the board-saturation patch then still runs on linear),
  //  - additively enables BOARD_LAYER on every light for identical board lighting,
  //  - disposes all GPU resources + restores renderer/light state on unmount (e.g. a
  //    resize that flips back to desktop).
  useLayoutEffect(() => {
    const alpha = gl.getContext().getContextAttributes()?.alpha ?? false;
    rig.gradePass.initialize(gl, alpha, THREE.HalfFloatType);

    // SSAO: feed the AO the SCENE FBO's DEPTH once. The DepthTexture object is
    // stable across setSize (only its GPU storage reallocates), so this reference
    // stays valid for the pipeline's life — no need to re-set on resize.
    if (rig.aoPass) rig.aoPass.setDepthTexture(rig.sceneDepthTex);

    const prevToneMapping = gl.toneMapping;
    gl.toneMapping = THREE.NoToneMapping;

    // ── STATIC SHADOWS: put the renderer in FROZEN shadow-map mode ────────────
    // Sets ONLY the frozen-mode invariants here (type + autoUpdate); the enabled
    // flag is NOT forced true globally — it is scoped PER PASS in the useFrame
    // below (FALSE for the forest/scene pass, TRUE for the board + city passes).
    //
    // WHY enabled is NOT global-true: three gates USE_SHADOWMAP purely on
    // `renderer.shadowMap.enabled && shadows.length > 0` (WebGLPrograms) — NOT on
    // object.receiveShadow — so a global enabled=true injected the shadow struct/
    // sampler + RGBA depth-unpack (~6e-8) constants into EVERY MeshStandardMaterial
    // program, INCLUDING the forest's mediump fade program, whose mixed-precision
    // shadow GLSL the iOS/Metal compiler rejects → the whole forest compiled empty
    // and vanished. Baseline FALSE here means ShaderWarmup's load-gated
    // compileAsync warms the forest's USE_SHADOWMAP-UNDEFINED display program (the
    // exact pre-regression program that rendered correctly) and NEVER the rejected
    // shadow-receive variant. The board/city receive-shadow programs link on their
    // first (enabled=true) pass — a one-time cost, and those materials are highp so
    // they compile fine.
    //
    // autoUpdate=false is the crux of the per-pass toggle being SAFE: it makes the
    // board + city passes' enabled=true gl.render calls hit the early-return inside
    // shadowMap.render (autoUpdate===false && needsUpdate===false), so the ONE map
    // baked in the useFrame below is reused every frame — never re-rendered, never
    // cleared, no per-frame recompile. PCFSoftShadowMap gives a cheaply-feathered
    // edge on RECEIVE (desktop's PCSS SoftShadows is deliberately not used on
    // mobile). Cleanup restores every flag so a resize back to desktop hands R3F a
    // clean renderer.
    const prevShadowEnabled = gl.shadowMap.enabled;
    const prevShadowType = gl.shadowMap.type;
    const prevShadowAutoUpdate = gl.shadowMap.autoUpdate;
    const prevShadowNeedsUpdate = gl.shadowMap.needsUpdate;
    gl.shadowMap.enabled = false;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = false;

    // Additively enable BOTH the board and city layers on every light (a light is
    // only collected if `light.layers.test(camera.layers)`, so without this the
    // board pass AND the city pass would be unlit/black). `.layers` lives on
    // Object3D, so we track Object3D and detect lights via the optional `isLight`
    // flag (Partial → `true | undefined`). Enabling on EVERY light is correct and
    // future-proof: the mobile-active lights (hemisphere / ambient / KEY) all need
    // to reach the board + city; FILL/RIM are desktop-only so the traverse simply
    // won't find them on mobile — no special-casing needed.
    // FOREST_GROUND_LAYER is enabled here too (when MOBILE_FOREST_SHADOWS_ENABLED) so
    // the KEY/hemi/ambient lights are collected in the GROUND shadow sub-pass — a light
    // is only gathered if `light.layers.test(camera.layers)`, and that sub-pass sets
    // camera.layers to FOREST_GROUND_LAYER, so without this the terrain ground would
    // render UNLIT (black) and receive no shadow. Cleanup disables all three.
    const litLights: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const isLight = (o as Partial<THREE.Light>).isLight === true;
      if (!isLight) return;
      let touched = false;
      if (!o.layers.isEnabled(BOARD_LAYER)) {
        o.layers.enable(BOARD_LAYER);
        touched = true;
      }
      if (!o.layers.isEnabled(CITY_LAYER)) {
        o.layers.enable(CITY_LAYER);
        touched = true;
      }
      if (MOBILE_FOREST_SHADOWS_ENABLED && !o.layers.isEnabled(FOREST_GROUND_LAYER)) {
        o.layers.enable(FOREST_GROUND_LAYER);
        touched = true;
      }
      if (touched) litLights.push(o);
    });

    return () => {
      gl.toneMapping = prevToneMapping;
      // Restore the renderer's shadow flags (a resize back to desktop must hand
      // R3F an untouched renderer) and force a re-bake if this pipeline remounts.
      gl.shadowMap.enabled = prevShadowEnabled;
      gl.shadowMap.type = prevShadowType;
      gl.shadowMap.autoUpdate = prevShadowAutoUpdate;
      gl.shadowMap.needsUpdate = prevShadowNeedsUpdate;
      baked.current = false;
      lastCasterSig.current = -1;
      casterCheckElapsed.current = 0;
      for (const light of litLights) {
        light.layers.disable(BOARD_LAYER);
        light.layers.disable(CITY_LAYER);
        if (MOBILE_FOREST_SHADOWS_ENABLED) light.layers.disable(FOREST_GROUND_LAYER);
      }
      lastNative.current = { w: 0, h: 0 };
      rig.sceneFBO.dispose();
      rig.boardFBO.dispose();
      rig.cityFBO.dispose();
      rig.compositeFBO.dispose();
      rig.aoSceneFBO?.dispose();
      rig.aoPass?.dispose();
      rig.sceneDepthTex.dispose();
      rig.boardDepthTex.dispose();
      rig.cityDepthTex.dispose();
      rig.compositeMat.dispose();
      rig.quad.dispose();
      rig.gradePass.dispose();
    };
  }, [gl, scene, rig]);

  // renderPriority 1 → R3F skips its own auto-render; this owns the whole frame.
  useFrame((_, delta) => {
    const { size } = get();
    const dpr = gl.getPixelRatio();
    const nativeW = Math.max(1, Math.round(size.width * dpr));
    const nativeH = Math.max(1, Math.round(size.height * dpr));
    // THERMAL STEP-DOWN: the scene/city dpr PROPS are the tier-0 ceiling; the
    // live thermal tier can lower them further (see mobileRender.ts /
    // thermalDpr.ts). Read per frame rather than plumbed as a prop deliberately —
    // this block already re-derives every FBO size from the live ratio and
    // re-allocates only on an actual change, so a tier step needs no React
    // re-render, no Canvas reconfigure and no resource rebuild. At tier 0
    // thermalSceneDprCap() is the identity function, so this line is
    // byte-identical to `Math.min(dpr, sceneDpr)` on first load and on desktop.
    const sDpr = Math.min(dpr, thermalSceneDprCap(sceneDpr));
    const sceneW = Math.max(1, Math.round(size.width * sDpr));
    const sceneH = Math.max(1, Math.round(size.height * sDpr));
    const cDpr = Math.min(dpr, thermalSceneDprCap(cityDpr));
    const cityW = Math.max(1, Math.round(size.width * cDpr));
    const cityH = Math.max(1, Math.round(size.height * cDpr));

    // Resize only when the pixel size actually changes (dpr swap on camera-motion
    // start/end, or a viewport resize). setSize reallocates lazily and three
    // re-syncs the attached depth texture to the new size on the next bind.
    if (rig.sceneFBO.width !== sceneW || rig.sceneFBO.height !== sceneH) {
      rig.sceneFBO.setSize(sceneW, sceneH);
    }
    // SSAO target + pass track the SCENE resolution (they read/write scene-space
    // buffers), so the AO'd scene colour stays 1:1 with sceneDepth for the
    // composite. aoPass.setSize reallocates its internal AO/denoise/output targets
    // (and, when halfRes, the half-res MRT) — cheap, fires only on an actual resize.
    if (rig.aoSceneFBO && rig.aoPass && (rig.aoSceneFBO.width !== sceneW || rig.aoSceneFBO.height !== sceneH)) {
      rig.aoSceneFBO.setSize(sceneW, sceneH);
      rig.aoPass.setSize(sceneW, sceneH);
    }
    if (rig.boardFBO.width !== nativeW || rig.boardFBO.height !== nativeH) {
      rig.boardFBO.setSize(nativeW, nativeH);
    }
    if (rig.cityFBO.width !== cityW || rig.cityFBO.height !== cityH) {
      rig.cityFBO.setSize(cityW, cityH);
    }
    if (rig.compositeFBO.width !== nativeW || rig.compositeFBO.height !== nativeH) {
      rig.compositeFBO.setSize(nativeW, nativeH);
    }
    if (lastNative.current.w !== nativeW || lastNative.current.h !== nativeH) {
      rig.gradePass.setSize(nativeW, nativeH);
      lastNative.current = { w: nativeW, h: nativeH };
    }

    const cam = camera as THREE.PerspectiveCamera;
    rig.compositeMat.uniforms.cameraNear.value = cam.near;
    rig.compositeMat.uniforms.cameraFar.value = cam.far;

    const prevAutoClear = gl.autoClear;
    const prevBackground = scene.background;
    gl.autoClear = true;

    // ── NIGHT-NATIVE SKY ARM ───────────────────────────────────────────────
    // Engage the native-dpr sky ONLY when: mobile NIGHT mode + the toggle + the
    // current scene.background IS the equirect night HDRI (a THREE.Texture with
    // EquirectangularReflectionMapping — both the HDRI and procedural night skies
    // use it). Any other case (DAY sky, a Color/CubeTexture background, the sky not
    // yet loaded) → useNativeSky stays false → the EXACT pre-feature path (sky drawn
    // into the reduced-dpr scene FBO), so DAY and the toggle-off fallback are safe.
    // PROCEDURAL: armed purely on nightMode + toggle + skyMode (scene.background is
    // null in this mode — the sky is drawn per-pixel in the composite, not from a
    // texture). HDRI: armed only when scene.background IS the equirect night HDRI.
    const bgTex = prevBackground as THREE.Texture | null;
    const proceduralNight = nightMode && MOBILE_NIGHT_SKY_NATIVE && skyMode === 'procedural';
    const hdriTex =
      nightMode &&
      MOBILE_NIGHT_SKY_NATIVE &&
      skyMode === 'hdri' &&
      bgTex != null &&
      (bgTex as Partial<THREE.Texture>).isTexture === true &&
      bgTex.mapping === THREE.EquirectangularReflectionMapping
        ? bgTex
        : null;
    const useNativeSky = proceduralNight || hdriTex !== null;
    if (useNativeSky) {
      rig.compositeMat.uniforms.uNightSky.value = 1;
      // three multiplies the background by scene.backgroundIntensity in linear space
      // (WebGLBackground) — match it so the procedural/HDRI sky brightness is
      // consistent with the old FBO sky. In procedural mode scene.background is null
      // but backgroundIntensity is still set (MOBILE_NIGHT_BG_INTENSITY) as the knob.
      // No `?? 1` fallback: three's Scene constructor initialises backgroundIntensity to
      // 1 and types it as a required `number`, so it is never null/undefined here.
      rig.compositeMat.uniforms.uSkyIntensity.value = scene.backgroundIntensity;
      if (proceduralNight) {
        rig.compositeMat.uniforms.uProcedural.value = 1;
        // uSky unused by the procedural branch; keep it bound to a valid texture.
        rig.compositeMat.uniforms.uSky.value = rig.sceneFBO.texture;
      } else {
        rig.compositeMat.uniforms.uProcedural.value = 0;
        rig.compositeMat.uniforms.uSky.value = hdriTex;
      }
    } else {
      rig.compositeMat.uniforms.uNightSky.value = 0;
      rig.compositeMat.uniforms.uProcedural.value = 0;
      // Keep the sampler bound to a valid 2D texture even when unused.
      rig.compositeMat.uniforms.uSky.value = rig.sceneFBO.texture;
    }

    // ── SHADOW-CASTER SIGNATURE ────────────────────────────────────────────
    // The bake below USED to be gated purely on `!baked.current` — a
    // permanent one-shot latch that fires exactly once, on the first frame
    // the drei load-gate reports `active:false`. That gate tracks
    // useLoader's async network fetches; it does NOT track CityDressing's
    // building meshes actually ATTACHING `castShadow=true` in the scene
    // graph, which happens a beat later (glb parse completes off that same
    // load-gate + a further material CLONE for the mobile mediump swap) —
    // so the very first bake frequently froze the shadow map with ZERO city
    // geometry in it, permanently losing the building-shaped shadow on the
    // board (autoUpdate=false means the frozen map is never re-rendered
    // after that). Counting every `castShadow===true` mesh in the scene
    // each frame and re-baking whenever that count changes re-fires the
    // SAME bake the instant the city's casters attach, then goes quiet once
    // the count stops moving — a cheap few-hundred-object traverse, bounded
    // to a short settle window (CASTER_SIG_WINDOW_MS) after the load gate
    // opens so it doesn't scan the whole scene forever over a long session.
    // A build action (buildingSig effect above, via `baked.current = false`)
    // always forces one more check regardless of the window.
    let casterSig = lastCasterSig.current;
    if (!progressActive && progressTotal > 0) {
      casterCheckElapsed.current += delta * 1000;
      if (!baked.current || casterCheckElapsed.current <= CASTER_SIG_WINDOW_MS) {
        casterSig = 0;
        scene.traverse((o) => {
          // `castShadow` lives on Object3D (not Mesh) and is always a boolean, so the
          // old `(o as THREE.Mesh).castShadow === true` never narrowed anything and
          // never filtered to meshes — this counts the exact same set of objects.
          if (o.castShadow) casterSig++;
        });
      }
    }

    // ── STATIC SHADOW BAKE ─────────────────────────────────────────────────
    // Fires once assets have settled (load gate above), again whenever the
    // caster signature changes (the city-mount race above), and again
    // whenever the building signature changes (baked reset in the effect).
    // enabled=true + needsUpdate=true drives exactly one shadowMap.render
    // this frame; it auto-resets needsUpdate to false and restores the
    // render target inside shadowMap.render, so every subsequent frame
    // reuses the frozen map.
    //
    // enableAll() enables camera-layer bits 0,1,2,3 so the caster layer-test inside
    // shadowMap.render (`object.layers.test(camera.layers)`) passes for casters on
    // ALL display layers at once — board slab (BOARD_LAYER), city (CITY_LAYER),
    // buildings + forest trees/rocks (layer 0), and the ground layer (which never
    // casts) are all reachable in the KEY light's single frozen depth map. Tokens are
    // excluded via castShadow=false (blob decals instead).
    //
    // FOREST TREE/ROCK SHADOWS (MOBILE_FOREST_SHADOWS_ENABLED): the trees + rocks now
    // castShadow=true (see ForestEnvironment), and the caster-signature trigger above
    // re-fires this bake the instant those chunks mount (the castShadow count jumps).
    //
    // The bake MUST be driven by a real `gl.render(scene, camera)` (with enabled=true +
    // needsUpdate=true set FIRST), NOT a bare `gl.shadowMap.render(...)`. shadowMap.render
    // is NOT a supported standalone entry point: its caster draws call renderBufferDirect
    // → setProgram, which dereferences three's MODULE-SCOPED `currentRenderState` (built
    // only inside renderer.render() and reset to null at every top-level render end). At
    // the top of useFrame currentRenderState===null → `Cannot read 'state' of null` throws
    // before `baked.current` latches → it re-fires + re-throws every frame → 0-tris frozen
    // canvas. gl.render sets currentRenderState up, runs three's INTERNAL shadow sub-pass
    // first (captures every castShadow caster via MeshDepthMaterial), THEN a throwaway
    // beauty pass into sceneFBO (overwritten by the real 1a/1b passes this same frame).
    //
    // FOREST VISIBLE so the internal shadow sub-pass actually captures the tree/rock
    // casters — that is the whole point. (Layer-exclusion can't help: the shadow sub-pass
    // gates casters on the MAIN `camera.layers` — three r0.169 WebGLShadowMap.renderObject,
    // `object.layers.test(camera.layers)` — not the light's shadow-camera layers, so
    // hiding the mediump foliage from the main camera would also drop it as a caster.)
    // scene.updateMatrixWorld(true) first so freshly-mounted, group-SCALED forest chunks
    // bake at their REAL world transform: their local matrix is identity and the transform
    // lives only in matrixWorld, which lags a frame (the exact reason the LOD loop has a
    // "matrixWorld not ready yet" guard) — a stale/identity matrixWorld would place trees
    // at origin/un-scaled, OUTSIDE the ±ortho frustum → renderObject skips them → the
    // frozen map freezes EMPTY forever (autoUpdate off). gl.render refreshes matrices
    // anyway, but the explicit call guarantees it even if matrixWorldAutoUpdate is off.
    //
    // iOS LANDMINE (accepted): the throwaway beauty pass compiles the forest's mediump
    // foliage material UNDER shadow-GLSL injection → that program is iOS-rejected
    // (invisible geometry, NOT a JS crash). But it is a DISTINCT program-cache entry (the
    // shadow params are part of three's built-in key, appended to our
    // customProgramCacheKey), and the REAL display never uses it: the real 1b foliage pass
    // runs shadowMap.enabled=false → the numShadows=0 / no-USE_SHADOWMAP key → the working
    // shadow-OFF program. So the broken program is UNUSED + harmless; the forest renders
    // correctly in 1b. (Cleaner layer-exclusion was ruled out above — it loses the casters.)
    //
    // TOGGLE OFF (revert path): the pre-feature THROWAWAY-BEAUTY bake with the forest
    // HIDDEN — board/city/buildings cast, forest does not, forest mediump beauty never
    // compiles under enabled=true. Byte-identical to the current shipped behavior.
    if (!progressActive && progressTotal > 0 && (!baked.current || casterSig !== lastCasterSig.current)) {
      const prevMask = camera.layers.mask;
      camera.layers.enableAll();
      gl.shadowMap.enabled = true;
      gl.shadowMap.needsUpdate = true;
      if (MOBILE_FOREST_SHADOWS_ENABLED) {
        // Real gl.render bake, forest VISIBLE → three's internal shadow sub-pass captures
        // the tree/rock casters. Throwaway sceneFBO beauty is overwritten by 1a/1b below.
        scene.updateMatrixWorld(true);
        gl.setRenderTarget(rig.sceneFBO);
        gl.render(scene, camera);
      } else {
        // Throwaway beauty bake (forest hidden) — pre-feature behavior.
        const forest = scene.getObjectByName('forest-environment');
        const forestPrevVisible = forest?.visible ?? true;
        if (forest) forest.visible = false;
        gl.setRenderTarget(rig.sceneFBO);
        gl.render(scene, camera);
        if (forest) forest.visible = forestPrevVisible;
      }
      camera.layers.mask = prevMask;
      lastCasterSig.current = casterSig;
      baked.current = true;
    }

    // 1. SCENE pass(es) → sceneFBO at scene dpr (board + city EXCLUDED).
    //
    // MOBILE_FOREST_SHADOWS_ENABLED — TWO sub-passes so the terrain GROUND RECEIVES
    // real tree/board/city shadows without EVER compiling a mediump material under
    // shadow injection (the iOS invisible-forest bug):
    //   1a GROUND sub-pass — FOREST_GROUND_LAYER only, shadowMap.enabled=TRUE. Clears
    //      sceneFBO, draws the HDRI sky (background is not layer-gated so it renders
    //      here at the cheap scene dpr, exactly as the old single pass) + the HIGHP
    //      terrain ground sampling the FROZEN shadow map → tree/board/city shadows land
    //      on the clearing floor. ONLY highp materials draw under enabled=true. autoUpdate
    //      + needsUpdate are false → shadowMap.render early-returns (frozen map reused,
    //      never re-baked); setupLights still uploads the frozen map + matrix so the
    //      ground receives (same mechanism as the board/city passes). The KEY/hemi/
    //      ambient lights reach layer 3 (enabled in the layout effect) so it is lit.
    //   1b REST sub-pass — layer 0 (mediump foliage/rocks + tokens/buildings),
    //      shadowMap.enabled=FALSE, so every layer-0 material selects the pre-regression
    //      USE_SHADOWMAP-UNDEFINED program the iOS/Metal compiler accepts (no shadow
    //      struct/sampler, no mediump-underflowing depth-unpack constants). autoClear=
    //      false + background=null PRESERVES the ground+sky COLOR and DEPTH from 1a
    //      (three skips the clear and draws no sky box when background is null and
    //      autoClear is false), so foliage depth-sorts against the ground and the sky
    //      is NOT re-drawn (no double sky fill, no depth wipe). Restore background +
    //      autoClear for the board/city passes below.
    //
    // TOGGLE OFF (revert): the single pre-feature scene pass — layer 0, shadows off,
    // sky kept — byte-identical to the current shipped behavior.
    // NIGHT-NATIVE: draw pass 1 WITHOUT the sky into a TRANSPARENT scene FBO so
    // empty pixels carry far-plane depth (the composite places the crisp native sky
    // there). setClearAlpha(0) only changes the clear alpha (colour untouched);
    // restored right after the scene pass so the board/city/composite/canvas clears
    // are unaffected. When !useNativeSky this block is inert → pre-feature behavior.
    const prevClearAlpha = gl.getClearAlpha();
    if (useNativeSky) {
      scene.background = null;
      gl.setClearAlpha(0);
    }
    if (MOBILE_FOREST_SHADOWS_ENABLED) {
      gl.shadowMap.enabled = true;
      camera.layers.set(FOREST_GROUND_LAYER);
      gl.setRenderTarget(rig.sceneFBO);
      gl.render(scene, camera);

      gl.shadowMap.enabled = false;
      scene.background = null;
      gl.autoClear = false;
      camera.layers.set(0);
      gl.render(scene, camera);
      gl.autoClear = true;
      scene.background = prevBackground;
    } else {
      gl.shadowMap.enabled = false;
      camera.layers.set(0);
      gl.setRenderTarget(rig.sceneFBO);
      gl.render(scene, camera);
    }
    if (useNativeSky) {
      gl.setClearAlpha(prevClearAlpha);
      scene.background = prevBackground;
    }

    // 1c. SSAO — depth-only ambient occlusion over the SCENE tier. Reconstructs
    //     normals from the scene DEPTH (no NormalPass), samples occlusion at
    //     ssaoRadius world-units (half-res when ssaoHalfRes), denoises, and
    //     MULTIPLIES the AO into the scene colour → aoSceneFBO, which is the
    //     composite's `sceneColor` base (wired at build). Reads sceneFBO.texture +
    //     sceneDepthTex and writes a SEPARATE target (no read/write feedback).
    //     shadowMap.enabled is FALSE here (left false by the scene pass — the single
    //     pass, or sub-pass 1b when forest shadows are on) and only full-screen quads
    //     run — no camera.layers / shadow / background state is touched, so the
    //     per-pass shadow scoping (pass 2/3 set enabled=true) is unaffected. Sky
    //     pixels carry far-plane depth → no occluder found + fog-attenuated → the
    //     HDRI sky is left unchanged (no dark halo). Skipped entirely when SSAO off.
    if (rig.aoPass && rig.aoSceneFBO) {
      rig.aoPass.render(gl, rig.sceneFBO, rig.aoSceneFBO);
    }

    // 2. BOARD pass — ONLY the board layer, at native dpr. shadowMap.enabled = TRUE
    //    (kept true through the CITY pass below) so the board + city SAMPLE the
    //    frozen baked map and keep their short soft daylight shadows. Because autoUpdate is
    //    false AND needsUpdate is false (reset after the one-shot bake),
    //    shadowMap.render early-returns — enabling here NEVER re-renders or clears
    //    the frozen map. Suppress the HDRI sky background so this stays a cheap
    //    opaque raster (the board slab) instead of a full-screen equirect fill at
    //    native res. Depth clears to 1.0 → the composite reads boardDepth == 1.0 as
    //    "no board here". scene.environment (IBL) is untouched, so the board is lit
    //    identically.
    gl.shadowMap.enabled = true;
    scene.background = null;
    camera.layers.set(BOARD_LAYER);
    gl.setRenderTarget(rig.boardFBO);
    gl.render(scene, camera);

    // 3. CITY pass — ONLY the city layer, at dpr 1.5. shadowMap.enabled stays TRUE
    //    (set above) so the city also samples the frozen baked map. Keep the sky
    //    suppressed (a sparse layer; depth clears to 1.0 outside the city
    //    footprint). scene.fog stays live so the city is fogged exactly as before,
    //    and scene.environment (IBL) is untouched so its lighting is identical.
    gl.shadowMap.enabled = true;
    camera.layers.set(CITY_LAYER);
    gl.setRenderTarget(rig.cityFBO);
    gl.render(scene, camera);

    // Restore the sky background AFTER both sparse passes, and the default layer
    // for the composite quad + everything else (the FullScreenQuad renders on 0).
    scene.background = prevBackground;
    camera.layers.set(0);

    // NIGHT-NATIVE: feed the composite the inverse view-projection + camera world
    // position for the per-pixel view-ray sky reconstruction. Computed HERE (after
    // the scene/board/city gl.render calls have refreshed cam.matrixWorldInverse for
    // this frame's pose) so the reconstructed sky matches exactly what those passes
    // rendered. Skipped when useNativeSky is false (uNightSky already 0).
    if (useNativeSky) {
      // three types every `uniforms` entry as `IUniform<any>`, so `.value` comes back as
      // `any`. These two are the only uniforms this path MUTATES IN PLACE (rather than
      // assigning a fresh value), so they are the only ones that need their real type
      // restated — they are built as a Matrix4 / Vector3 in the composite uniforms block
      // above, and re-stating that here keeps the copy/getWorldPosition calls checked.
      const uInvViewProj = rig.compositeMat.uniforms.uInvViewProj as THREE.IUniform<THREE.Matrix4>;
      const uCamPos = rig.compositeMat.uniforms.uCamPos as THREE.IUniform<THREE.Vector3>;
      _skyInvViewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
      uInvViewProj.value.copy(_skyInvViewProj);
      cam.getWorldPosition(uCamPos.value);
    }

    // 4. COMPOSITE — 3-way depth merge (city over board over scene) into a native
    //    linear-HDR buffer.
    gl.setRenderTarget(rig.compositeFBO);
    rig.quad.render(gl);

    // 5. GRADE + PRESENT — the merged mobile grade chain, sRGB-encoded once,
    //    straight to the canvas at native dpr.
    rig.gradePass.render(gl, rig.compositeFBO, null, delta);

    gl.setRenderTarget(null);
    gl.autoClear = prevAutoClear;
  }, 1);

  return null;
}
