import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  EffectPass,
  ToneMappingEffect,
  HueSaturationEffect,
  BrightnessContrastEffect,
  FXAAEffect,
} from 'postprocessing';
import { FullScreenQuad } from 'three-stdlib';
import { SharpenEffectImpl } from '../screens/SharpenEffect';
import { BOARD_LAYER } from './positions';

/**
 * ── MOBILE CRISP-BOARD PIPELINE (MOBILE ONLY) ────────────────────────────────
 *
 * Replaces the mobile <EffectComposer>. It renders the board texture at NATIVE
 * device-pixel-ratio (razor-crisp text) while keeping the expensive scene
 * (forest / city / tokens / HDRI sky) at dpr 2 for framerate, then depth-composites
 * the two and applies the SAME colour grade the mobile composer used — once, over
 * the composited linear-HDR image, so the board and scene are graded identically.
 *
 * WHY NOT A COMPOSER EFFECT: a single postprocessing EffectComposer runs every
 * pass at ONE resolution, so a composite added as its last effect would re-sample
 * the board back down to the composer's dpr — not crisp. The board being crisp
 * REQUIRES the final present to happen at native dpr, which needs a small custom
 * render orchestration (this component) rather than a declarative composer.
 *
 * FRAME GRAPH (per frame, in a useFrame at renderPriority 1 so R3F's auto-render
 * is suppressed and this is the only thing that presents):
 *   1. SCENE pass  — camera.layers = {0} (board EXCLUDED) → sceneFBO
 *                    [css × min(dpr,sceneDpr), HalfFloat LINEAR + DepthTexture]
 *   2. BOARD pass  — camera.layers = {BOARD_LAYER} (board ONLY), sky suppressed
 *                    → boardFBO [css × dpr (native), HalfFloat LINEAR + DepthTexture]
 *   3. COMPOSITE   — depth-merge board over scene (native) → compositeFBO (linear)
 *   4. GRADE       — the reused mobile grade EffectPass over compositeFBO → canvas
 *                    (native): AGX ToneMapping → HueSaturation → BrightnessContrast
 *                    → FXAA → Sharpen → sRGB, encoded once.
 *
 * Both passes share the SAME scene + camera, so the board inherits the SAME lights
 * (this component additively enables BOARD_LAYER on every light — lights are layer
 * gated too) and the SAME scene.environment (HDRI IBL, not layer gated) → the board
 * is lit IDENTICALLY to the single-pass render. NOT a separate un-lit scene.
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
   * View-space-Z bias (world-ish units) so a token/house base — which sits ON the
   * board surface (zBoard ≈ zScene at the contact) — resolves to the SCENE, not the
   * board, killing z-fight shimmer at the contact. The board wins a pixel only if it
   * is nearer than the scene by more than this. Tune on-device: too small → contact
   * shimmer; too large → the board visibly recedes behind low geometry.
   */
  depthBias: number;
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
uniform float cameraNear;
uniform float cameraFar;
uniform float depthBias;
in vec2 vUv;
out vec4 fragColor;

// three's perspectiveDepthToViewZ: non-linear [0,1] depth -> negative view-space Z.
// Both passes share the same camera, so these are directly comparable; a NEARER
// surface yields a LARGER (less-negative) value. Converting to view-Z makes the bias
// uniform in world space across the whole depth range.
float viewZ(float depth) {
  return (cameraNear * cameraFar) / ((cameraFar - cameraNear) * depth - cameraFar);
}

void main() {
  vec3 sceneC = texture(sceneColor, vUv).rgb;
  float rawB = texture(boardDepth, vUv).x;
  // rawB == 1.0 -> the board pass wrote nothing here (cleared to the far plane) ->
  // outside the board footprint (forest / sky) -> keep the scene.
  if (rawB >= 1.0) {
    fragColor = vec4(sceneC, 1.0);
    return;
  }
  // Scene depth is sampled NEAREST (DepthTexture's default filter), so the
  // dpr-2 -> native upscale never invents an intermediate depth across a
  // token/house silhouette (which would shimmer at the contact). Scene COLOR
  // keeps LinearFilter for a smooth upscale.
  float rawS = texture(sceneDepth, vUv).x;
  float zS = viewZ(rawS);
  float zB = viewZ(rawB);
  // Board wins only if strictly nearer than the scene by depthBias. At a token
  // base zB ≈ zS, so the tie resolves to the scene (the token) — the crisp board
  // never bleeds over the token's base. Forest trees / tokens in FRONT of the
  // board have zS > zB, so they correctly occlude it.
  if (zB > zS + depthBias) {
    fragColor = vec4(texture(boardColor, vUv).rgb, 1.0);
  } else {
    fragColor = vec4(sceneC, 1.0);
  }
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
  depthBias,
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
    const sceneFBO = makeTarget(sceneDepthTex);
    const boardFBO = makeTarget(boardDepthTex);
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
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        depthBias: { value: depthBias },
      },
    });
    const quad = new FullScreenQuad(compositeMat);

    // Grade EffectPass — the SAME 5 effects, same options, same order as the old
    // mobile <EffectComposer> (all non-convolution → one merged pass). Reusing the
    // library effects makes the grade byte-identical: ToneMapping default is AGX,
    // and the final sRGB OETF is EffectMaterial.encodeOutput (on by default).
    const toneMapping = new ToneMappingEffect({});
    const hueSat = new HueSaturationEffect({ saturation });
    const brightnessContrast = new BrightnessContrastEffect({ brightness, contrast });
    const fxaa = new FXAAEffect({});
    // subpixelQuality is a define-backed setter (the R3F <FXAA subpixelQuality>
    // wrapper sets it the same way, via applyProps) — set BEFORE the pass builds
    // its merged shader in initialize().
    fxaa.subpixelQuality = fxaaSubpixelQuality;
    const sharpen = new SharpenEffectImpl();
    const gradePass = new EffectPass(camera, toneMapping, hueSat, brightnessContrast, fxaa, sharpen);
    // Present straight to the canvas at native dpr (outputBuffer ignored).
    gradePass.renderToScreen = true;

    return {
      sceneFBO,
      boardFBO,
      compositeFBO,
      sceneDepthTex,
      boardDepthTex,
      compositeMat,
      quad,
      gradePass,
    };
  }, [camera, saturation, brightness, contrast, fxaaSubpixelQuality, depthBias]);

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

    // Additively enable BOARD_LAYER on every light (a light is only collected if
    // `light.layers.test(camera.layers)`, so without this the board pass would be
    // unlit/black). `.layers` lives on Object3D, so we track Object3D and detect
    // lights via the optional `isLight` flag (Partial → `true | undefined`).
    const litLights: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const isLight = (o as Partial<THREE.Light>).isLight === true;
      if (isLight && !o.layers.isEnabled(BOARD_LAYER)) {
        o.layers.enable(BOARD_LAYER);
        litLights.push(o);
      }
    });

    return () => {
      gl.toneMapping = prevToneMapping;
      for (const light of litLights) light.layers.disable(BOARD_LAYER);
      lastNative.current = { w: 0, h: 0 };
      rig.sceneFBO.dispose();
      rig.boardFBO.dispose();
      rig.compositeFBO.dispose();
      rig.sceneDepthTex.dispose();
      rig.boardDepthTex.dispose();
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

    // Resize only when the pixel size actually changes (dpr swap on camera-motion
    // start/end, or a viewport resize). setSize reallocates lazily and three
    // re-syncs the attached depth texture to the new size on the next bind.
    if (rig.sceneFBO.width !== sceneW || rig.sceneFBO.height !== sceneH) {
      rig.sceneFBO.setSize(sceneW, sceneH);
    }
    if (rig.boardFBO.width !== nativeW || rig.boardFBO.height !== nativeH) {
      rig.boardFBO.setSize(nativeW, nativeH);
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

    // 1. SCENE pass — everything EXCEPT the board (layer 0), at scene dpr. Keeps
    //    scene.background (HDRI sky) so the sky renders here at the cheap dpr.
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
    scene.background = prevBackground;
    camera.layers.set(0);

    // 3. COMPOSITE — depth-merge board over scene into a native linear-HDR buffer.
    gl.setRenderTarget(rig.compositeFBO);
    rig.quad.render(gl);

    // 4. GRADE + PRESENT — the merged mobile grade chain, sRGB-encoded once,
    //    straight to the canvas at native dpr.
    rig.gradePass.render(gl, rig.compositeFBO, null, delta);

    gl.setRenderTarget(null);
    gl.autoClear = prevAutoClear;
  }, 1);

  return null;
}
