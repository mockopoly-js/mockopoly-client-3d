import { Effect, BlendFunction } from 'postprocessing';
import { wrapEffect } from '@react-three/postprocessing';

/**
 * Mobile-only sharpen (unsharp-mask) post effect.
 *
 * WHY: the mobile board renders at dpr 2 (an FPS/thermal cap — see
 * MOBILE_DPR_STILL in GameScene) and the mobile edge-AA is FXAA. Both SOFTEN the
 * 4096² board texture text: dpr 2 under-samples the fine glyphs, and FXAA's
 * edge blend blurs high-contrast edges. Raising dpr fixes it but is exactly the
 * fixed full-screen fill we are cutting. The standard fix is "render low then
 * sharpen": a cheap contrast-adaptive / unsharp-mask that adds back the local
 * high-frequency detail the downsample + FXAA removed.
 *
 * HOW / COST: this is a per-fragment `postprocessing` Effect (a `mainImage`
 * function, NOT a convolution effect), so @react-three/postprocessing MERGES it
 * into the SAME EffectPass as the color grade + FXAA — it adds NO standalone
 * full-screen pass and no extra render target. The only added cost is 4 texel
 * fetches + a handful of ALU ops per fragment, i.e. near-zero next to the pass
 * that already runs. It reads the shared built-in `inputBuffer` / `texelSize`
 * uniforms exactly like the FXAA effect does.
 *
 * PLACEMENT: runs FIRST in the mobile grade pass, immediately AFTER FXAA and
 * BEFORE the tonemap + grade. In a merged postprocessing EffectPass the 4 neighbour
 * taps can ONLY read `inputBuffer` (the RAW linear-HDR composite = the pass input);
 * they can never reach a later effect's threaded colour. So Sharpen MUST sit where
 * `inputColor` is ALSO that raw composite — i.e. before any grade effect mutates it.
 * Here `inputColor` is the FXAA output (raw composite, AA'd) and the taps are the
 * raw composite: center and neighbours live in the SAME linear-HDR colour space, so
 * the unsharp mask is colorimetrically consistent (no HDR-minus-LDR DC offset), and
 * the sharpened result then flows through ACES + the full grade like every other
 * pixel. (Mounting it AFTER the grade — the old placement — put a graded-LDR center
 * against raw-HDR taps, a frame-wide DC offset that washed the grade out.)
 *
 * SHARPEN_STRENGTH — the single tuning knob. It scales the high-frequency
 * detail added back: out = center + strength * (center - blur). Higher = crisper
 * but risks haloing/ringing on the board text edges; lower = softer. ~0.25–0.35
 * is the subtle sweet spot that restores crispness without visible halos at
 * dpr 2. Baked into the shader as a compile-time float literal (zero uniform
 * cost); edit this const to retune.
 */
const SHARPEN_STRENGTH = 0.45;

const fragmentShader = /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // 4-tap cross of the pass input (the same buffer FXAA reads), one texel out.
  vec3 up    = texture2D(inputBuffer, uv + vec2(0.0, -texelSize.y)).rgb;
  vec3 down  = texture2D(inputBuffer, uv + vec2(0.0,  texelSize.y)).rgb;
  vec3 left  = texture2D(inputBuffer, uv + vec2(-texelSize.x, 0.0)).rgb;
  vec3 right = texture2D(inputBuffer, uv + vec2( texelSize.x, 0.0)).rgb;

  vec3 center = inputColor.rgb;
  vec3 blur = (up + down + left + right) * 0.25;

  // Unsharp mask: add back the high-frequency detail the dpr-2 downsample +
  // FXAA edge blend removed.
  vec3 sharp = center + ${SHARPEN_STRENGTH.toFixed(4)} * (center - blur);

  // FLOOR at 0 only — kills the negative undershoot/ringing on the dark side of an
  // edge (negative colour would corrupt the ACES input). Do NOT clip the TOP: this
  // now runs PRE-tonemap on the raw linear-HDR composite, where bright pixels are
  // legitimately > 1; ACES downstream rolls those highlights off, so clamping to 1
  // here would flatten them (the "muddy, dulled highlights" regression).
  outputColor = vec4(max(sharp, 0.0), inputColor.a);
}
`;

/**
 * SRC blend so this effect's output REPLACES the accumulated colour (it emits
 * the final sharpened pixel), matching how FXAA blends in the same merged pass.
 */
class SharpenEffectImpl extends Effect {
  constructor({ blendFunction = BlendFunction.SRC } = {}) {
    super('SharpenEffect', fragmentShader, { blendFunction });
  }
}

/** Declarative wrapper — the @react-three/postprocessing <EffectComposer> form. */
export const Sharpen = wrapEffect(SharpenEffectImpl);

/**
 * Raw `postprocessing` Effect class — for imperative use OUTSIDE a declarative
 * <EffectComposer>. The mobile crisp-board pipeline builds its grade EffectPass
 * by hand (`new EffectPass(camera, ...effects)`) so it can drive it at native
 * resolution over a custom composite buffer; it instantiates this directly
 * (`new SharpenEffectImpl()`) to keep the sharpen identical to the composer form.
 */
export { SharpenEffectImpl };
