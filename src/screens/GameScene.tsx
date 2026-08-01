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
import { BOARD_ROTATION } from '../board/positions';
import { getProceduralSky } from '../board/ProceduralSky';
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
 * MOBILE-ONLY sky/env intensities (see HdriSkyMobile + ProceduralSky). The mobile
 * branch REPLACES sky.webp with the procedural equirect for BOTH scene.background
 * AND scene.environment (IBL), so the whole mobile scene stays coherently lit with
 * no extra light rig. Env is TRIMMED to 0.62 (near desktop's 0.6 ballpark) so the
 * flat global IBL wash no longer flattens the scene — LESS indirect deepens the
 * KEY-baked shadows AND the city aoMap (both are relative to indirect), giving the
 * moody-cinematic contrast more room to READ while the board stays lit.
 * MOBILE_ENV_INTENSITY is a PRIMARY user nudge knob (trim first if the scene reads
 * hot). Desktop keeps ENV_INTENSITY/BG_INTENSITY on sky.webp, untouched.
 */
const MOBILE_ENV_INTENSITY = 0.62;
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
 * moody-cinematic look can be tuned without touching the frozen desktop composer.
 * Passed to <MobileCrispBoardPipeline> instead of SATURATION/BRIGHTNESS/CONTRAST.
 * Moody-cinematic: SATURATION 0.22 (richer, not garish pop), BRIGHTNESS +0.04 (a
 * small high-key lift offsetting the ACES + vignette darkening — the PRIMARY
 * readability trim; drop toward 0.0 if too bright), and CONTRAST +0.12 (deeper
 * cinematic contrast — flips the old lifted-airy blacks to depth; postprocessing
 * BrightnessContrast divides by 1-contrast). Paired with ACES_FILMIC tone, the
 * teal-orange split, the vignette and the warm-key/cool-fill rig. Desktop
 * <HueSaturation>/<BrightnessContrast> still read SATURATION/BRIGHTNESS/CONTRAST →
 * byte-identical.
 */
const MOBILE_SATURATION = 0.22;
const MOBILE_BRIGHTNESS = 0.04;
const MOBILE_CONTRAST = 0.12;

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
 * ── MOBILE-ONLY WARM-KEY / COOL-FILL CINEMATIC LIGHT RIG ─────────────────────
 * A HIGH warm golden sun (KEY) vs a COOL-teal hemisphere ground bounce + a COOL
 * ambient floor drives the teal-orange drama: lit faces read warm, shadow faces
 * read cool-teal. FILL/RIM stay desktop-only (already dropped on mobile). These
 * twins replace the desktop hemisphere/ambient/KEY on mobile; desktop keeps its
 * KEY / HEMI / AMBIENT consts above, byte-identical.
 *
 * KEY (the sun): warm golden, positioned HIGH for short soft shadows. POSITION is
 * UNCHANGED [7,11,6] (horizontal dist √85 ≈ 9.22, elevation ≈ 50°) so the frozen
 * shadow bake stays valid (the ortho ±8 frame + bias/normalBias are tuned to this
 * angle; shadow maps store depth only → colour/intensity changes are shadow-safe).
 * Intensity bumped 1.5 → 1.7 for a deeper key-to-fill ratio (drama).
 *
 * FILL (hemi + ambient): COOLED and TRIMMED so it stops flattening — the ground
 * bounce fills the shadow-side undersides, so cooling it is what tints the shadow
 * faces teal. EXPOSURE: key 1.7 : (hemi 0.50 + ambient 0.24) ≈ 2.3:1 → deeper,
 * cooler shadow sides than the old ~1.8:1 while the board top still receives
 * KEY + hemi-sky + ambient + IBL so text stays readable. PRIMARY user nudge knobs:
 * MOBILE_ENV_INTENSITY, MOBILE_KEY_INTENSITY, MOBILE_HEMI_INTENSITY.
 */
const MOBILE_KEY_COLOR = '#ffd6a0'; // warm golden key
const MOBILE_KEY_INTENSITY = 1.7;
const MOBILE_KEY_POSITION: [number, number, number] = [7, 11, 6]; // UNCHANGED (frozen shadow bake)
// HEMISPHERE: cool daylight sky over a COOL desaturated ground bounce. The cool
// ground bounce is what tints the shadow-side undersides teal (reinforcing the
// split-tone shadows + cool city rim). Trimmed so the fill stops flattening.
const MOBILE_HEMI_SKY = '#cfe6f5';
const MOBILE_HEMI_GROUND = '#a8b4bc';
const MOBILE_HEMI_INTENSITY = 0.5;
// AMBIENT: COOL fill, trimmed for deeper shadows so shadow sides read cool-teal
// (not lifted-neutral) alongside the split-tone grade.
const MOBILE_AMBIENT_COLOR = '#dbe6ee';
const MOBILE_AMBIENT_INTENSITY = 0.24;
/**
 * MOBILE-ONLY frozen shadow-map resolution for the KEY sun. The map is baked
 * ONCE at load (autoUpdate off — see MobileCrispBoardPipeline), so 2048² costs a
 * single extra shadow render at load + ~16 MB depth VRAM and ZERO per-frame cost.
 * The high ~50° sun throws SHORT shadows, and the ortho frame is now tightened to
 * ±8 (see the shadow-camera below), so 2048 gives ~128 texels/unit (up from ~73
 * over the old ±14) → crisper short edges. Because the frame shrank, 1024 (~64
 * texels/unit, ≈ the old 2048/±14 density) is now a viable load-time VRAM
 * fallback on a low-end device — but there is no framerate reason to drop it.
 * Desktop's KEY light keeps its own 1024².
 */
const MOBILE_SHADOW_MAP_SIZE = 2048;

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
 * COLOR: light cool-neutral haze (#dbe8f0) that sits coherently against the new
 * pale-blue sky horizon (ProceduralSky SKY_MID #e4f0f7), so fogged far terrain
 * melts into a cool aerial-perspective haze — the daylight-reference look — and
 * the ring-cull cut edge (already fog=1.0) is invisible. Removes the old amber
 * cast (the golden-hour look is superseded). MOBILE ONLY (the <fog> below is
 * isMobile-gated), so desktop scene.fog stays null → byte-identical.
 * NEAR/FAR (world units): board/city/near treeline (fogDepth ~10-20) stay clear;
 * the deep forest is fully hazed by FOG_FAR. Kept at 24/52 — the forest ring-cull
 * (FOREST_CULL_DISTANCE ≈ FOG_FAR×1.27) and ForestEnvironment's density-band math
 * are tuned to these exact numbers, so DO NOT move them (only the color changes;
 * the art brief's "far-only haze" is already satisfied at near=24 — board, city,
 * tokens and near treeline stay fully clear and only the far ring hazes).
 */
const FOG_COLOR = '#dbe8f0';
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
 * MOBILE sky/env — bright daylight, ASSET-FREE. Loads NO texture (no Suspense);
 * instead it assigns the module-singleton procedural bright-daylight equirect
 * (ProceduralSky) to BOTH scene.background (visible sky) AND scene.environment
 * (IBL). Using the daylight equirect as the environment lights ALL
 * ambient/reflection with a coherent high-key daylight with zero extra light rig,
 * and — because scene.environment is NOT layer gated — the board + city passes
 * inherit it identically in the 3-pass mobile composite. Replaces sky.webp on
 * mobile only; desktop keeps sky.webp untouched.
 */
function HdriSkyMobile() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const grad = getProceduralSky();
    scene.environment = grad;
    scene.environmentIntensity = MOBILE_ENV_INTENSITY;
    scene.background = grad;
    scene.backgroundIntensity = MOBILE_BG_INTENSITY;
    // Under frameloop="always" the imperatively-set scene.environment/background
    // paints on the next frame automatically — no render poke needed.
    return () => {
      scene.environment = null;
      scene.background = null;
    };
  }, [scene]);
  return null;
}

/**
 * Parent selector — renders exactly ONE of the two sibling sky components based
 * on isMobile so each hook (useTexture on desktop, none on mobile) is called
 * unconditionally within its component (rules-of-hooks safe across resize /
 * orientation flips). Mirrors the BoardTiles WebGL/KTX2 split.
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
      {isMobile && <fog attach="fog" args={[FOG_COLOR, FOG_NEAR, FOG_FAR]} />}
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
          MOBILE twin: cool sky over a COOL desaturated ground bounce (cinematic;
          the cool bounce tints the shadow-side undersides teal). */}
      {!isMobile && <hemisphereLight args={['#cbe8f5', '#8a9a5b', HEMI_INTENSITY]} />}
      {isMobile && (
        <hemisphereLight args={[MOBILE_HEMI_SKY, MOBILE_HEMI_GROUND, MOBILE_HEMI_INTENSITY]} />
      )}
      {/* Ambient floor. DESKTOP: 0.15 neutral — AO now darkens crevices the flat
          ambient was washing out; this just lifts pure black. MOBILE twin: a
          COOL fill, trimmed for deeper shadows so shadow sides read cool-teal
          (not lifted-neutral) alongside the split-tone grade. */}
      {!isMobile && <ambientLight intensity={AMBIENT_INTENSITY} />}
      {isMobile && (
        <ambientLight color={MOBILE_AMBIENT_COLOR} intensity={MOBILE_AMBIENT_INTENSITY} />
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
      {/* MOBILE KEY twin — a HIGH ~50° warm golden sun for short soft
          shadows. It is the mobile shadow CASTER: its map is BAKED ONCE (frozen)
          by MobileCrispBoardPipeline (renderer autoUpdate off), so castShadow + a
          2048² map cost a single shadow render at load and nothing per frame. The
          high sun throws SHORT shadows (height × cot50° ≈ height × 0.84, toward
          [-7,·,-6]), so the ortho frame is tightened to [-8,8,8,-8, 0.5, 30]:
          board (±5) + city + buildings + the short throw stay inside ±8 with
          margin, and the tighter frame lifts texel density to ~128/unit for
          crisp short edges. Far plane 30 brackets the light (dist √206≈14.35 from
          origin) ± the ±8 frame. bias/normalBias guard acne (less needed now the
          sun is less grazing). Desktop's KEY (above) is untouched → byte-identical. */}
      {isMobile && (
        <directionalLight
          color={MOBILE_KEY_COLOR}
          position={MOBILE_KEY_POSITION}
          intensity={MOBILE_KEY_INTENSITY}
          castShadow
          shadow-mapSize={[MOBILE_SHADOW_MAP_SIZE, MOBILE_SHADOW_MAP_SIZE]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
        >
          <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.5, 30]} />
        </directionalLight>
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
        vs. drei <Environment files=...>. MOBILE (HdriSkyMobile): loads NO texture;
        assigns the procedural warm-gradient equirect (ProceduralSky) to both
        scene.background and scene.environment (MOBILE_*_INTENSITY) for the
        bright-daylight look with zero new asset. The outer Suspense is inert for the
        mobile branch (it never suspends).
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
          <CityDressing isMobile={isMobile} />
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
          scene, and applies the moody-cinematic mobile grade — FXAA -> Sharpen
          (over the raw linear-HDR composite) -> ACES_FILMIC ToneMapping ->
          HueSaturation -> BrightnessContrast -> WarmGrade (teal-orange split) ->
          Vignette -> sRGB — ONCE over the composited linear image, so board and
          scene are graded identically.
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
          saturation={MOBILE_SATURATION}
          brightness={MOBILE_BRIGHTNESS}
          contrast={MOBILE_CONTRAST}
          fxaaSubpixelQuality={MOBILE_FXAA_SUBPIXEL_QUALITY}
          sceneDpr={MOBILE_SCENE_DPR}
          cityDpr={MOBILE_CITY_DPR}
          depthBias={MOBILE_BOARD_DEPTH_BIAS}
          cityDepthBias={MOBILE_CITY_DEPTH_BIAS}
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
