import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import {
  EffectComposer,
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
 * Lighting:
 * - hemisphereLight: soft sky/ground fill (sky #cbe8f5, ground #8a9a5b) at
 *   low intensity 0.35 — keeps unlit sides warm and grounded without washing
 *   out the directional shadow.
 * - ambientLight: trimmed to 0.4 (was 0.5) since the HDRI Environment now adds
 *   image-based fill light — keeps the scene from over-brightening while the
 *   directional shadow still reads clearly against the hemisphere fill.
 * - directionalLight: unchanged — position, intensity, shadow map.
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
      dpr={[1, 2]}
      performance={{ min: 0.5 }}
      gl={{ powerPreference: 'high-performance' }}
    >
      {/*
        Flat sky fallback — only used when the HDRI sky is NOT shown as the
        background. When SHOW_HDRI_BACKGROUND is true the Environment paints the
        scene background with the equirect sky instead.
      */}
      {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- SHOW_HDRI_BACKGROUND is a documented build-time toggle (see header) */}
      {!SHOW_HDRI_BACKGROUND && <color attach="background" args={['#cbe8f5']} />}
      {/* Soft shadow injection (must be early in the scene, no assets). */}
      <SoftShadows size={12} samples={16} />
      {/* Sky/ground hemisphere fill — warms the scene and lifts shadow darkness. */}
      <hemisphereLight args={['#cbe8f5', '#8a9a5b', 0.35]} />
      {/* Ambient trimmed (0.5 → 0.4) now that the HDRI Environment adds IBL fill. */}
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[6, 10, 6]} intensity={1.15} castShadow
        shadow-mapSize={[1024, 1024]}
      >
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
      </directionalLight>
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
      <EffectComposer>
        {/*
          Order matters: Bloom -> ToneMapping -> global color grade. Grading runs
          on the tone-mapped LDR image so saturation/contrast make colors POP
          instead of just amplifying HDR values that tone mapping later clamps.
        */}
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
