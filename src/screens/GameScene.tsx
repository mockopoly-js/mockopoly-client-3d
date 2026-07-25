import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import {
  EffectComposer,
  N8AO,
  Bloom,
  ToneMapping,
  HueSaturation,
  BrightnessContrast,
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
import { BOARD_ROTATION } from '../board/positions';

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
 * Manually applies an equirectangular sky texture as scene.environment
 * (and optionally scene.background) so Three.js actually picks it up.
 * drei's <Environment files=...> path resolves ambiguously for LDR webp and
 * leaves scene.background null; this component is deterministic.
 */
function HdriSky() {
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
    return () => {
      scene.environment = null;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- SHOW_HDRI_BACKGROUND is a documented build-time toggle (see header)
      if (SHOW_HDRI_BACKGROUND) scene.background = null;
    };
  }, [tex, scene, gl]);
  return null;
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

  return (
    <>
    {/* Fixed container that hosts the stats.js DOM panel. Must be a sibling of
        Canvas (not a child) so it sits in normal DOM flow outside the WebGL layer.
        top:104px places it below the CameraDebugOverlay (top:56 + ~4 lines ≈ 96px). */}
    <div
      ref={statsParentRef}
      style={{
        position: 'fixed',
        top: 104,
        left: 8,
        zIndex: 60,
        pointerEvents: 'none',
      }}
    />
    <Canvas
      style={{ position: 'fixed', inset: 0 }}
      // Reverted to original nice framing. Board content is rotated via BOARD_ROTATION
      // group instead of moving the camera — camera props only apply on mount and
      // are HMR-inert; rotating the board content is reliable and frame-accurate.
      camera={{ position: [0, 8.5, 12], fov: 50 }}
      shadows
      dpr={[1, 1.5]}
      performance={{ min: 0.5 }}
      gl={{ powerPreference: 'high-performance', antialias: false }}
    >
      {/*
        Flat sky fallback — only used when the HDRI sky is NOT shown as the
        background. When SHOW_HDRI_BACKGROUND is true the Environment paints the
        scene background with the equirect sky instead.
      */}
      {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- SHOW_HDRI_BACKGROUND is a documented build-time toggle (see header) */}
      {!SHOW_HDRI_BACKGROUND && <color attach="background" args={['#cbe8f5']} />}
      {/* Soft shadow injection (must be early in the scene, no assets). */}
      <SoftShadows size={12} samples={8} />
      {/* DEV-only culling audit — press "c" to log material side counts. */}
      <CullingAudit />
      {/* Sky/ground hemisphere fill — tints unlit sides; trimmed 0.35 → 0.25 so
          AO + the rig shape the scene instead of a flat wash. */}
      <hemisphereLight args={['#cbe8f5', '#8a9a5b', HEMI_INTENSITY]} />
      {/* Ambient trimmed 0.4 → 0.15 — AO now darkens crevices the flat ambient
          was washing out; this just lifts pure black. */}
      <ambientLight intensity={AMBIENT_INTENSITY} />
      {/* KEY (the sun): warm, the ONLY shadow caster. Position, 1024² shadow map
          and ortho shadow-camera bounds kept exactly as the previous light. */}
      <directionalLight
        color={KEY_COLOR}
        position={KEY_POSITION}
        intensity={KEY_INTENSITY}
        castShadow
        shadow-mapSize={[1024, 1024]}
      >
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
      </directionalLight>
      {/* FILL: cool, low, opposite-ish angle — softens the shadow side without
          flattening the form. No shadow (perf + avoids double shadows). */}
      <directionalLight
        color={FILL_COLOR}
        position={FILL_POSITION}
        intensity={FILL_INTENSITY}
        castShadow={false}
      />
      {/* RIM / BACK: cool-bright, high and behind — edge-lights the tops of
          trees/buildings/tokens for separation from the sky. No shadow. */}
      <directionalLight
        color={RIM_COLOR}
        position={RIM_POSITION}
        intensity={RIM_INTENSITY}
        castShadow={false}
      />
      {/*
        HDRI sky — HdriSky uses useTexture (suspends while loading) to load
        /images/sky.webp, sets EquirectangularReflectionMapping + SRGBColorSpace,
        then assigns scene.environment (ENV_INTENSITY IBL) and, when
        SHOW_HDRI_BACKGROUND is true, scene.background (BG_INTENSITY). This is
        deterministic vs. drei <Environment files=...> which left scene.background
        null for LDR webp paths.
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
          <CityDressing />
        </Suspense>
      </group>
      <Suspense fallback={null}>
        {/* ForestEnvironment (forest.glb) surrounds the board — the diorama
            ground/treeline. Kept OUTSIDE the rotation group so the forest
            stays fixed as the board turns within its clearing. */}
        <ForestEnvironment />
      </Suspense>
      <EffectComposer multisampling={2}>
        {/*
          Order matters: N8AO -> Bloom -> ToneMapping -> global color grade. AO
          runs FIRST so contact/crevice darkening is baked into the beauty pass
          before Bloom reads luminance and before the tone-map + grade. Grading
          then runs on the tone-mapped LDR image so saturation/contrast make
          colors POP instead of amplifying HDR values tone mapping later clamps.
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
      </EffectComposer>
      {/* FPS counter — always-on dev/perf readout. Mounted into statsParentRef
          (the fixed div sibling above) so it appears below the CameraDebugOverlay
          at top:104px left:8px rather than defaulting to the top-left origin. */}
      <Stats parent={statsParentRef} />
    </Canvas>
    </>
  );
}
