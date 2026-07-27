import { Effect, BlendFunction } from 'postprocessing';
import { wrapEffect } from '@react-three/postprocessing';

/**
 * Mobile-only warm split-tone grade (golden-hour push).
 *
 * WHY: the mobile golden-hour look wants highlights pushed GOLDEN and shadows
 * pushed WARM-BROWN without muddying the mid-tones — the board text and token
 * colours live in the mids and must stay READABLE. A global hue rotate or a flat
 * temperature multiply would tint everything (including the board glyphs); a
 * luminance-keyed SPLIT TONE only grades the darks and brights, leaving the mids
 * essentially untouched.
 *
 * HOW / COST: like SharpenEffect this is a per-fragment `postprocessing` Effect
 * (a `mainImage` function, NOT a convolution effect), so it MERGES into the
 * single mobile grade EffectPass — ZERO extra pass / render target, just a few
 * ALU ops per fragment. It runs in LINEAR-ISH tone-mapped space (after AGX
 * ToneMapping → HueSaturation → BrightnessContrast, before FXAA → Sharpen) so it
 * shapes the already-tone-mapped LDR colour.
 *
 * TUNING KNOBS (compile-time float literals, like SHARPEN_STRENGTH → zero
 * uniform cost; edit + rebuild to retune):
 * - WARM_TEMP: colour-temperature push. Reds up by WARM_TEMP, blues down by
 *   0.8·WARM_TEMP so the whole frame leans warm without a green cast.
 * - HIGH_TINT / HIGH_STRENGTH: multiply applied to HIGHLIGHTS (golden push).
 * - SHADOW_TINT / SHADOW_STRENGTH: multiply applied to SHADOWS (warm-brown push;
 *   ×1.6 so the low-key tint has enough bite against the dim ambient floor).
 */
const WARM_TEMP = 0.06;
const HIGH_TINT: readonly [number, number, number] = [1.0, 0.82, 0.52];
const HIGH_STRENGTH = 0.22;
const SHADOW_TINT: readonly [number, number, number] = [0.45, 0.32, 0.22];
const SHADOW_STRENGTH = 0.16;

/** Bakes a numeric vec3 const into a GLSL literal (no uniform cost). */
const glslVec3 = (c: readonly [number, number, number]): string =>
  `vec3(${c[0].toFixed(4)}, ${c[1].toFixed(4)}, ${c[2].toFixed(4)})`;

const fragmentShader = /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;

  // Perceptual luminance (BT.709) computed on the ORIGINAL colour, used to key
  // the split tone below.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));

  // Colour-temperature push: warm reds up, cool blues down (golden hour).
  c.r *= ${(1.0 + WARM_TEMP).toFixed(4)};
  c.b *= ${(1.0 - 0.8 * WARM_TEMP).toFixed(4)};

  // Split tone keyed off the original luma: golden highlights, warm-brown
  // shadows, mids (board text / token faces) left alone for readability.
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
