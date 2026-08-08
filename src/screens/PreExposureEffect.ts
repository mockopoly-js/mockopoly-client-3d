import { Effect, BlendFunction } from 'postprocessing';
import { Uniform } from 'three';
import { wrapEffect } from '@react-three/postprocessing';

/**
 * ── MOBILE-ONLY PRE-EXPOSURE (linear-HDR exposure lift) ──────────────────────
 *
 * WHY: the mobile grade tone-maps with ACES_FILMIC, which — like AGX — compresses
 * midtones without any exposure compensation, so the scene reads DIM/too-dark
 * despite the light rig. The research-standard fix is not more lights but an
 * EXPOSURE lever: scale the linear-HDR image BEFORE the tonemap so midtones lift
 * while ACES rolls the boosted highlights off near white (its natural shoulder) —
 * midtones brighten, highlights hold, blacks stay put (a MULTIPLY preserves the
 * black point far better than an additive brightness offset).
 *
 * WHERE IT SITS: inserted in the single mobile grade EffectPass BETWEEN Sharpen
 * and the ACES ToneMapping (see MobileCrispBoardPipeline). At that point the
 * threaded `inputColor` is the RAW linear-HDR composite (FXAA'd + sharpened, both
 * of which operate in that same linear space), and the renderer is NoToneMapping
 * with a HalfFloat/NoColorSpace composite FBO — so multiplying here scales true
 * linear radiance, exactly what an exposure control does, and the very next effect
 * (ACES) tone-maps the lifted signal. postprocessing 6.39.3's ToneMappingEffect
 * does NOT thread a settable per-effect exposure for ACES_FILMIC mode (its shader
 * calls three's ACESFilmicToneMapping(texel) directly), so this pre-exposure
 * multiply is the clean lever rather than the tonemap's own knob.
 *
 * HOW / COST: like SharpenEffect / WarmGradeEffect this is a per-fragment
 * `postprocessing` Effect (a `mainImage` function, NOT a convolution effect), so
 * @react-three/postprocessing MERGES it into the SAME EffectPass as FXAA +
 * Sharpen + tonemap + grade — it adds NO standalone full-screen pass and no extra
 * render target. The only added cost is one uniform read + one vec3 multiply per
 * fragment inside a pass that already runs. Perf-neutral.
 *
 * uExposure — the single tuning knob (a linear multiplier; 1.0 = unchanged). It is
 * a real uniform (threaded from the `exposure` prop / MOBILE_EXPOSURE const) so it
 * can be retuned on-device without a shader rebuild. ~1.25–1.5 is the natural
 * too-dark band; 1.35 is the starting value.
 */
const fragmentShader = /* glsl */ `
uniform float uExposure;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Linear-HDR exposure lift. Runs PRE-tonemap on the raw linear composite, so
  // scaling here maps to a true photographic exposure; ACES downstream rolls the
  // boosted highlights off near white. No clamp — the >1 highlights must survive
  // for the ACES shoulder (clamping would flatten them, the "dulled highlights"
  // regression Sharpen also avoids).
  outputColor = vec4(inputColor.rgb * uExposure, inputColor.a);
}
`;

/**
 * SRC blend so this effect's output REPLACES the accumulated colour (it emits the
 * exposed pixel), matching how the sibling grade effects blend in the merged pass.
 */
class PreExposureEffectImpl extends Effect {
  constructor({ blendFunction = BlendFunction.SRC, exposure = 1.0 } = {}) {
    super('PreExposureEffect', fragmentShader, {
      blendFunction,
      uniforms: new Map([['uExposure', new Uniform(exposure)]]),
    });
  }
}

/** Declarative wrapper — the @react-three/postprocessing <EffectComposer> form. */
export const PreExposure = wrapEffect(PreExposureEffectImpl);

/**
 * Raw `postprocessing` Effect class — for imperative use OUTSIDE a declarative
 * <EffectComposer>. The mobile crisp-board pipeline builds its grade EffectPass by
 * hand (`new EffectPass(camera, ...effects)`) and instantiates this directly
 * (`new PreExposureEffectImpl({ exposure })`) so the pre-exposure merges into the
 * single mobile grade pass between Sharpen and the ACES ToneMapping.
 */
export { PreExposureEffectImpl };
