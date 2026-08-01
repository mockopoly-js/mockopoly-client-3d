import { Effect, BlendFunction } from 'postprocessing';
import { wrapEffect } from '@react-three/postprocessing';

/**
 * Mobile-only split-tone grade — currently NEUTRAL (identity). The realistic /
 * grounded-PBR look does NOT stylize colour, so every knob below is zeroed: no
 * warm-temp push, no highlight/shadow tint. The effect stays fully WIRED and
 * MERGEABLE in the single mobile grade EffectPass, so a split-tone can be dialled
 * back in later purely by editing the consts — no pass / plumbing change.
 *
 * WHAT IT DOES (when non-zero): a classic split — a small warm temperature push
 * plus a luminance-keyed tint that pushes HIGHLIGHTS one way and SHADOWS the
 * other. BOARD-SAFE: the split keys highlights on smoothstep(0.5,1.0,luma) and
 * shadows on 1-smoothstep(0.0,0.5,luma), so mid-tones (board text / token faces
 * at luma≈0.4–0.6) get ≈0 push and stay readable. At the current all-zero values
 * the shader collapses to a passthrough (×1.0 temp, mix strengths 0) → identity.
 *
 * HOW / COST: like SharpenEffect this is a per-fragment `postprocessing` Effect
 * (a `mainImage` function, NOT a convolution effect), so it MERGES into the
 * single mobile grade EffectPass — ZERO extra pass / render target, just a few
 * ALU ops per fragment. It runs in tone-mapped LDR space (after ACES_FILMIC
 * ToneMapping → HueSaturation → BrightnessContrast) so it keys off the final
 * contrast-shaped luminance. (FXAA + Sharpen run EARLIER, pre-tonemap, over the
 * raw linear-HDR composite — see MobileCrispBoardPipeline.)
 *
 * TUNING KNOBS (compile-time float literals, like SHARPEN_STRENGTH → zero
 * uniform cost; edit + rebuild to retune):
 * - WARM_TEMP: colour-temperature push. Reds up by WARM_TEMP, blues down by
 *   0.8·WARM_TEMP. 0 = neutral (no push).
 * - HIGH_TINT / HIGH_STRENGTH: multiply applied to HIGHLIGHTS. Tint [1,1,1] /
 *   strength 0 = neutral.
 * - SHADOW_TINT / SHADOW_STRENGTH: multiply applied to SHADOWS. Tint [1,1,1] /
 *   strength 0 = neutral (the ·1.6 built-in lift is inert while strength is 0).
 */
const WARM_TEMP = 0.0; // neutral: no colour-temperature push
const HIGH_TINT: readonly [number, number, number] = [1.0, 1.0, 1.0]; // neutral highlights
const HIGH_STRENGTH = 0.0;
const SHADOW_TINT: readonly [number, number, number] = [1.0, 1.0, 1.0]; // neutral shadows
const SHADOW_STRENGTH = 0.0;

/** Bakes a numeric vec3 const into a GLSL literal (no uniform cost). */
const glslVec3 = (c: readonly [number, number, number]): string =>
  `vec3(${c[0].toFixed(4)}, ${c[1].toFixed(4)}, ${c[2].toFixed(4)})`;

const fragmentShader = /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;

  // Perceptual luminance (BT.709) computed on the ORIGINAL colour, used to key
  // the split tone below.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));

  // Colour-temperature push: reds up, blues down. NEUTRAL at WARM_TEMP=0 (×1.0),
  // so this is a passthrough at the current realistic settings.
  c.r *= ${(1.0 + WARM_TEMP).toFixed(4)};
  c.b *= ${(1.0 - 0.8 * WARM_TEMP).toFixed(4)};

  // Split tone keyed off the original luma: highlights get HIGH_TINT, shadows
  // get SHADOW_TINT (the ·1.6 lift keeps shadows from crushing). Mids (luma≈0.4–
  // 0.6) fall between both smoothsteps → ≈0 push. NEUTRAL at the current values
  // (tints [1,1,1], strengths 0) → identity; board text/token faces stay readable.
  float hi = smoothstep(0.5, 1.0, l);
  float lo = 1.0 - smoothstep(0.0, 0.5, l);
  c = mix(c, c * ${glslVec3(HIGH_TINT)}, hi * ${HIGH_STRENGTH.toFixed(4)});
  c = mix(c, c * ${glslVec3(SHADOW_TINT)} * 1.6, lo * ${SHADOW_STRENGTH.toFixed(4)});

  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

/**
 * SRC blend so this effect's output REPLACES the accumulated colour (it emits
 * the graded pixel), matching how the sibling grade effects blend in the merged
 * pass.
 */
class WarmGradeEffectImpl extends Effect {
  constructor({ blendFunction = BlendFunction.SRC } = {}) {
    super('WarmGradeEffect', fragmentShader, { blendFunction });
  }
}

/** Declarative wrapper — the @react-three/postprocessing <EffectComposer> form. */
export const WarmGrade = wrapEffect(WarmGradeEffectImpl);

/**
 * Raw `postprocessing` Effect class — for imperative use OUTSIDE a declarative
 * <EffectComposer>. The mobile crisp-board pipeline builds its grade EffectPass
 * by hand and instantiates this directly (`new WarmGradeEffectImpl()`) so the
 * warm grade merges into the single mobile grade pass.
 */
export { WarmGradeEffectImpl };
