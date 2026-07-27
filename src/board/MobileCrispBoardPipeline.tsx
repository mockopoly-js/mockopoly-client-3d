import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  HueSaturationEffect,
  BrightnessContrastEffect,
  FXAAEffect,
} from 'postprocessing';
import { FullScreenQuad } from 'three-stdlib';
import { SharpenEffectImpl } from '../screens/SharpenEffect';
import { WarmGradeEffectImpl } from '../screens/WarmGradeEffect';
import { BOARD_LAYER, CITY_LAYER } from './positions';

/**
 * ── MOBILE-ONLY BLOOM (golden-hour glow) ─────────────────────────────────────
 * Merged into the single grade EffectPass (BloomEffect is non-convolution, so it
 * adds NO standalone pass; it renders its bloom RT from the pass INPUT in
 * update() and ADDs it in mainImage). High threshold so ONLY the sun-disc skybox
 * hot-spot, emissive city windows and the hottest warm speculars bloom — board
 * text sits well below threshold and stays readable.
 * - INTENSITY: bloom add strength.
 * - THRESHOLD / SMOOTHING: luminance gate (0.85 = only bright warm sources).
 * - RADIUS: mipmap-blur spread (wide, soft golden glow).
 * - RESOLUTION_SCALE: half-res bloom base to trim fill on the native-dpr present.
 */
const MOBILE_BLOOM_INTENSITY = 0.8;
const MOBILE_BLOOM_THRESHOLD = 0.85;
const MOBILE_BLOOM_SMOOTHING = 0.2;
const MOBILE_BLOOM_RADIUS = 0.7;
const MOBILE_BLOOM_RESOLUTION_SCALE = 0.5;

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
 *                    (native): AGX ToneMapping → HueSaturation → BrightnessContrast
 *                    → FXAA → Sharpen → sRGB, encoded once.
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
  /** HueSaturation `saturation` — same value the mobile composer used. */
  saturation: number;
  /** BrightnessContrast `brightness` — same value the mobile composer used. */
  brightness: number;
  /** BrightnessContrast `contrast` — same value the mobile composer used. */
  contrast: number;
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
in vec2 vUv;
out vec4 fragColor;

// three's perspectiveDepthToViewZ: non-linear [0,1] depth -> negative view-space Z.
// All passes share the same camera, so these are directly comparable; a NEARER
// surface yields a LARGER (less-negative) value. Converting to view-Z makes the bias
// uniform in world space across the whole depth range.
float viewZ(float depth) {
  return (cameraNear * cameraFar) / ((cameraFar - cameraNear) * depth - cameraFar);
}

void main() {
  // BASE: the scene always has full coverage (HDRI sky fills the background), so
  // it is the fallback everywhere. COLOR bilinear (smooth upscale); DEPTH NEAREST
  // (DepthTexture default) so the dpr2->native upscale never invents an
  // intermediate depth across a silhouette -> no halo.
  vec3 outC = texture(sceneColor, vUv).rgb;
  float zS  = viewZ(texture(sceneDepth, vUv).x);
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
  saturation,
  brightness,
  contrast,
  fxaaSubpixelQuality,
  sceneDpr,
  cityDpr,
  depthBias,
  cityDepthBias,
}: MobileCrispBoardPipelineProps): null {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const get = useThree((s) => s.get);

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

    const compositeMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: compositeVertexShader,
      fragmentShader: compositeFragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        // Texture objects are stable across WebGLRenderTarget.setSize (only the GPU
        // storage is reallocated), so these references stay valid after a resize.
        sceneColor: { value: sceneFBO.texture },
        sceneDepth: { value: sceneDepthTex },
        boardColor: { value: boardFBO.texture },
        boardDepth: { value: boardDepthTex },
        cityColor: { value: cityFBO.texture },
        cityDepth: { value: cityDepthTex },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        depthBias: { value: depthBias },
        cityBias: { value: cityDepthBias },
      },
    });
    const quad = new FullScreenQuad(compositeMat);

    // Grade EffectPass — all non-convolution effects, so they MERGE into ONE
    // pass over the linear-HDR composite. sRGB OETF is applied once by
    // EffectMaterial.encodeOutput (on by default). Golden-hour additions vs the
    // original mobile grade: a warm split-tone (WarmGrade) after the tone/hue/BC
    // trio, and Bloom FIRST.
    //
    // BLOOM is placed FIRST so its ADD lands BEFORE ToneMapping (matching the
    // desktop composer order N8AO → Bloom → ToneMapping): BloomEffect.update()
    // renders its bloom RT from the pass INPUT (the linear-HDR composite)
    // regardless of chain position, then its mainImage ADDs that precomputed
    // bloom — so ordering it first tone-maps the summed HDR, not a clamped LDR.
    // mipmapBlur → wide soft glow; resolutionScale halves the bloom base.
    const bloom = new BloomEffect({
      intensity: MOBILE_BLOOM_INTENSITY,
      luminanceThreshold: MOBILE_BLOOM_THRESHOLD,
      luminanceSmoothing: MOBILE_BLOOM_SMOOTHING,
      radius: MOBILE_BLOOM_RADIUS,
      mipmapBlur: true,
      resolutionScale: MOBILE_BLOOM_RESOLUTION_SCALE,
    });
    // ToneMapping default is AGX (parity with desktop). AGX desaturates
    // highlights; if the golden reads muted on-device, the one-line alternative
    // is `new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })` (punchier
    // warm highlights) — a tuning toggle, not the default.
    const toneMapping = new ToneMappingEffect({});
    const hueSat = new HueSaturationEffect({ saturation });
    const brightnessContrast = new BrightnessContrastEffect({ brightness, contrast });
    // Warm split-tone (golden highlights / warm-brown shadows, mids untouched) —
    // after the tone/hue/BC trio so it shapes the tone-mapped LDR colour.
    const warmGrade = new WarmGradeEffectImpl();
    const fxaa = new FXAAEffect({});
    // subpixelQuality is a define-backed setter (the R3F <FXAA subpixelQuality>
    // wrapper sets it the same way, via applyProps) — set BEFORE the pass builds
    // its merged shader in initialize().
    fxaa.subpixelQuality = fxaaSubpixelQuality;
    const sharpen = new SharpenEffectImpl();
    const gradePass = new EffectPass(
      camera,
      bloom,
      toneMapping,
      hueSat,
      brightnessContrast,
      warmGrade,
      fxaa,
      sharpen,
    );
    // Present straight to the canvas at native dpr (outputBuffer ignored).
    gradePass.renderToScreen = true;

    return {
      sceneFBO,
      boardFBO,
      cityFBO,
      compositeFBO,
      sceneDepthTex,
      boardDepthTex,
      cityDepthTex,
      compositeMat,
      quad,
      gradePass,
    };
  }, [camera, saturation, brightness, contrast, fxaaSubpixelQuality, depthBias, cityDepthBias]);

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

    const prevToneMapping = gl.toneMapping;
    gl.toneMapping = THREE.NoToneMapping;

    // Additively enable BOTH the board and city layers on every light (a light is
    // only collected if `light.layers.test(camera.layers)`, so without this the
    // board pass AND the city pass would be unlit/black). `.layers` lives on
    // Object3D, so we track Object3D and detect lights via the optional `isLight`
    // flag (Partial → `true | undefined`). Enabling on EVERY light is correct and
    // future-proof: the mobile-active lights (hemisphere / ambient / KEY) all need
    // to reach the board + city; FILL/RIM are desktop-only so the traverse simply
    // won't find them on mobile — no special-casing needed.
    const litLights: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const isLight = (o as Partial<THREE.Light>).isLight === true;
      if (isLight && (!o.layers.isEnabled(BOARD_LAYER) || !o.layers.isEnabled(CITY_LAYER))) {
        o.layers.enable(BOARD_LAYER);
        o.layers.enable(CITY_LAYER);
        litLights.push(o);
      }
    });

    return () => {
      gl.toneMapping = prevToneMapping;
      for (const light of litLights) {
        light.layers.disable(BOARD_LAYER);
        light.layers.disable(CITY_LAYER);
      }
      lastNative.current = { w: 0, h: 0 };
      rig.sceneFBO.dispose();
      rig.boardFBO.dispose();
      rig.cityFBO.dispose();
      rig.compositeFBO.dispose();
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
    const sDpr = Math.min(dpr, sceneDpr);
    const sceneW = Math.max(1, Math.round(size.width * sDpr));
    const sceneH = Math.max(1, Math.round(size.height * sDpr));
    const cDpr = Math.min(dpr, cityDpr);
    const cityW = Math.max(1, Math.round(size.width * cDpr));
    const cityH = Math.max(1, Math.round(size.height * cDpr));

    // Resize only when the pixel size actually changes (dpr swap on camera-motion
    // start/end, or a viewport resize). setSize reallocates lazily and three
    // re-syncs the attached depth texture to the new size on the next bind.
    if (rig.sceneFBO.width !== sceneW || rig.sceneFBO.height !== sceneH) {
      rig.sceneFBO.setSize(sceneW, sceneH);
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

    // 1. SCENE pass — everything on layer 0 (board + city EXCLUDED), at scene dpr.
    //    Keeps scene.background (HDRI sky) so the sky renders here at the cheap dpr.
    camera.layers.set(0);
    gl.setRenderTarget(rig.sceneFBO);
    gl.render(scene, camera);

    // 2. BOARD pass — ONLY the board layer, at native dpr. Suppress the HDRI sky
    //    background so this stays a cheap opaque raster (the board slab) instead of
    //    a full-screen equirect fill at native res. Depth clears to 1.0 → the
    //    composite reads boardDepth == 1.0 as "no board here". scene.environment
    //    (IBL) is untouched, so the board is lit identically.
    scene.background = null;
    camera.layers.set(BOARD_LAYER);
    gl.setRenderTarget(rig.boardFBO);
    gl.render(scene, camera);

    // 3. CITY pass — ONLY the city layer, at dpr 1.5. Keep the sky suppressed (a
    //    sparse layer; depth clears to 1.0 outside the city footprint). scene.fog
    //    stays live so the city is fogged exactly as before, and scene.environment
    //    (IBL) is untouched so its lighting is identical.
    camera.layers.set(CITY_LAYER);
    gl.setRenderTarget(rig.cityFBO);
    gl.render(scene, camera);

    // Restore the sky background AFTER both sparse passes, and the default layer
    // for the composite quad + everything else (the FullScreenQuad renders on 0).
    scene.background = prevBackground;
    camera.layers.set(0);

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
