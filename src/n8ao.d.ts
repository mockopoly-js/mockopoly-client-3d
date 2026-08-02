/**
 * Ambient type declaration for `n8ao` (ships no .d.ts). Only the members the
 * MOBILE crisp-board pipeline drives imperatively are typed — see
 * `MobileCrispBoardPipeline.tsx` (mobile SSAO). This does NOT touch the desktop
 * path: desktop uses the `<N8AO>` REACT wrapper from `@react-three/postprocessing`
 * (a different, fully-typed entry point); this bare `n8ao` import is mobile-only.
 *
 * N8AOPostPass is a `postprocessing.Pass` that reconstructs normals from DEPTH
 * ALONE (no NormalPass / no full-screen normal render) and multiplies the
 * resulting ambient occlusion into the input colour — the depth-only AO the
 * fill-bound mobile pipeline needs.
 */
declare module 'n8ao' {
  import type {
    Scene,
    Camera,
    Color,
    DepthTexture,
    WebGLRenderer,
    WebGLRenderTarget,
  } from 'three';

  /** Tunable knobs on the pass (a live Proxy — assigning re-configures sub-passes). */
  interface N8AOConfiguration {
    /** AO sample count per pixel (quality vs cost). */
    aoSamples: number;
    /** Occlusion sample radius in WORLD units (when screenSpaceRadius is false). */
    aoRadius: number;
    /** Bilateral denoise sample count. */
    denoiseSamples: number;
    /** Bilateral denoise radius (pixels). */
    denoiseRadius: number;
    /** How quickly occlusion fades with view-space distance (fraction of radius). */
    distanceFalloff: number;
    /** AO darkening strength. */
    intensity: number;
    /** Denoise (Poisson blur) iterations. */
    denoiseIterations: number;
    /** 0 = Combined (AO multiplied into colour), 1 = AO, 2 = No AO, 3/4 = Split. */
    renderMode: number;
    /** Occlusion tint (multiplied with scene colour when colorMultiply is true). */
    color: Color;
    /** Apply sRGB OETF on output (kept false for a linear-HDR pipeline). */
    gammaCorrection: boolean;
    /** Interpret aoRadius in screen pixels instead of world units. */
    screenSpaceRadius: boolean;
    /** Compute AO at half resolution then depth-aware upsample (resolutionScale 0.5). */
    halfRes: boolean;
    /** Depth-aware upsample of the half-res AO (only meaningful when halfRes). */
    depthAwareUpsampling: boolean;
    /** Multiply occlusion tint by the scene colour (true) vs replace with tint (false). */
    colorMultiply: boolean;
  }

  export class N8AOPostPass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    /** When false, render() writes to the passed outputBuffer instead of the screen. */
    renderToScreen: boolean;
    /** Feed the depth buffer of the geometry to be occluded (the scene FBO's depth). */
    setDepthTexture(depthTexture: DepthTexture): void;
    setSize(width: number, height: number): void;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setDisplayMode(mode: string): void;
    render(
      renderer: WebGLRenderer,
      inputBuffer: WebGLRenderTarget,
      outputBuffer?: WebGLRenderTarget | null,
    ): void;
    dispose(): void;
  }

  export class N8AOPass {}
}
