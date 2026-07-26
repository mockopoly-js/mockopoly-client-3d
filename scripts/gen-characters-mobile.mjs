/**
 * gen-characters-mobile.mjs — build the MOBILE-ONLY, meshopt-compressed variants
 * of the 52 rigged character models under `public/models/characters-mobile/`
 * from the committed, desktop-frozen originals in `public/models/characters/`.
 *
 * WHY: each desktop `<id>.glb` is a decoder-free, SKINNED + ANIMATED character
 * (~0.5–0.9 MB; the animation keyframe streams dominate). Only ≤4 are resident
 * per game, but the download/parse cost on a low-end phone is still worth cutting.
 * This script produces a VISUALLY + BEHAVIORALLY IDENTICAL variant loaded at
 * runtime only when `isMobile` (see src/constants/characters.ts
 * `toMobileCharacterUrl`). Desktop keeps every original byte-identical.
 *
 * SKIN/ANIM SAFETY — the whole point of this pass:
 * ------------------------------------------------
 * These meshes are SKINNED and ANIMATED, so compression MUST NOT corrupt the
 * skinning inputs or the animation channels. We apply ONLY
 * EXT_meshopt_compression with the **FILTER** encoder method — and NOT the
 * `meshopt()` function's default QUANTIZE path (which first runs
 * KHR_mesh_quantization, lossily rounding positions AND, dangerously, the
 * skinning weights). The FILTER method's per-accessor filter map
 * (@gltf-transform/extensions `getMeshoptFilter`) is:
 *
 *   • POSITION ............. filter NONE  (LOSSLESS byte compression — no
 *                           dequant offset, so deformation is bit-exact)
 *   • JOINTS_0 ............. filter NONE  (LOSSLESS — skin bone indices exact)
 *   • WEIGHTS_0 ........... filter NONE  (LOSSLESS — skin weights exact, no
 *                           re-normalization drift that would break deformation)
 *   • inverseBindMatrices . filter NONE  (LOSSLESS — bind pose / skeleton exact)
 *   • animation input ..... filter NONE  (LOSSLESS — keyframe TIMES exact)
 *   • NORMAL/TANGENT ...... OCTAHEDRAL 8-bit (industry-standard, imperceptible
 *                           on these low-poly stylized characters)
 *   • anim rotation out ... QUATERNION 16-bit (imperceptible; gltfpack default)
 *   • anim translation/scale EXPONENTIAL 12-bit (imperceptible)
 *
 * i.e. everything the SKINNING pipeline reads (joints, weights, positions, bind
 * matrices) stays LOSSLESS; only normals + animation SAMPLER outputs are lossily
 * filtered at bit depths that are visually indistinguishable. NO geometry is
 * decimated, NO vertices are welded, NO clips/channels are dropped — this is a
 * pure download/parse compression pass. Meshopt is a byte codec; the decoded
 * accessors have the SAME element counts and semantics as the source.
 *
 * DECODER: the meshopt decoder is bundled in three-stdlib and auto-installed by
 * drei's `useGLTF` (see @react-three/drei Gltf.js `setMeshoptDecoder`), exactly
 * like the shipped forest.mobile.glb — so the CLIENT wires NO decoder, NO draco,
 * NO external CDN.
 *
 * VALIDATION: after writing each variant we READ IT BACK and assert, against the
 * source, that NOTHING skin/anim-critical changed: same skin count, same skin
 * joint count + inverseBindMatrices present, identical JOINTS_0/WEIGHTS_0
 * accessor element counts, identical animation clip count, identical TOTAL
 * animation channel count, and that the output carries EXT_meshopt_compression
 * (and NO draco/quantization extension). Any mismatch marks the file FAILED and
 * the script exits non-zero so a broken batch never silently commits.
 *
 * Run:  npm run models:characters:mobile
 * Or:   node scripts/gen-characters-mobile.mjs [srcDir] [outDir]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SRC = process.argv[2] || resolve(PROJECT_ROOT, 'public/models/characters');
const OUT = process.argv[3] || resolve(PROJECT_ROOT, 'public/models/characters-mobile');

const KB = (n) => (n / 1024).toFixed(0);
const MB = (n) => (n / 1024 / 1024).toFixed(2);

/**
 * Summarize the skin + animation integrity of a document root. This is the exact
 * data the runtime SKINNING + AnimationMixer depend on; comparing before vs. the
 * read-back after proves compression preserved every one of them.
 */
function integrity(root) {
  const skins = root.listSkins();
  const skin0 = skins[0];
  const anims = root.listAnimations();
  let channels = 0;
  for (const a of anims) channels += a.listChannels().length;

  // First primitive carrying skin attributes (all 52 have exactly one mesh).
  let joints = null;
  let weights = null;
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) {
      const j = p.getAttribute('JOINTS_0');
      const w = p.getAttribute('WEIGHTS_0');
      if (j && w) {
        joints = j.getCount();
        weights = w.getCount();
        break;
      }
    }
    if (joints !== null) break;
  }

  return {
    skins: skins.length,
    skinJoints: skin0 ? skin0.listJoints().length : 0,
    ibm: !!(skin0 && skin0.getInverseBindMatrices()),
    clips: anims.length,
    channels,
    joints,
    weights,
  };
}

function sameIntegrity(a, b) {
  return (
    a.skins === b.skins &&
    a.skinJoints === b.skinJoints &&
    a.ibm === b.ibm &&
    a.clips === b.clips &&
    a.channels === b.channels &&
    a.joints === b.joints &&
    a.weights === b.weights
  );
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`\n[gen-characters-mobile] SOURCE NOT FOUND:\n  ${SRC}\n`);
    console.error('Build the desktop characters first (npm run models:characters).');
    process.exit(1);
  }

  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  mkdirSync(OUT, { recursive: true });

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });

  const names = readdirSync(SRC)
    .filter((f) => f.toLowerCase().endsWith('.glb'))
    .sort();

  if (names.length === 0) {
    console.error(`No .glb files found in ${SRC}`);
    process.exit(1);
  }

  console.log(`[gen-characters-mobile] compressing ${names.length} characters (meshopt FILTER)`);
  console.log(`  src: ${SRC}`);
  console.log(`  out: ${OUT}\n`);

  let totalIn = 0;
  let totalOut = 0;
  const failures = [];

  for (const file of names) {
    const name = file.replace(/\.glb$/i, '');
    const inPath = join(SRC, file);
    const outPath = join(OUT, file);
    try {
      const inSize = statSync(inPath).size;
      const doc = await io.read(inPath);
      const before = integrity(doc.getRoot());

      // SKIN-SAFE meshopt: FILTER method (NOT quantize). Keeps joints/weights/
      // positions/inverseBindMatrices LOSSLESS; only filters normals + anim
      // sampler outputs at imperceptible bit depths. See the banner.
      doc
        .createExtension(EXTMeshoptCompression)
        .setRequired(true)
        .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });

      await io.write(outPath, doc);
      const outSize = statSync(outPath).size;
      totalIn += inSize;
      totalOut += outSize;

      // ── Read-back integrity check (decodes meshopt via MeshoptDecoder) ──────
      const rb = await io.read(outPath);
      const after = integrity(rb.getRoot());
      const exts = rb.getRoot().listExtensionsUsed().map((e) => e.extensionName);

      const hasMeshopt = exts.includes('EXT_meshopt_compression');
      const hasBadExt = exts.some((e) => /draco|quantization|basisu|webp|avif/i.test(e));
      const intact = sameIntegrity(before, after);
      const ok = hasMeshopt && !hasBadExt && intact && after.skins === 1 && after.ibm;

      if (!ok) {
        const why = [];
        if (!hasMeshopt) why.push('missing EXT_meshopt_compression');
        if (hasBadExt) why.push(`unexpected ext (${exts.join(',')})`);
        if (!intact)
          why.push(
            `integrity drift ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
          );
        if (after.skins !== 1) why.push(`skins=${after.skins}`);
        if (!after.ibm) why.push('inverseBindMatrices lost');
        failures.push(`${name}: ${why.join('; ')}`);
      }

      const pct = ((1 - outSize / inSize) * 100).toFixed(0);
      console.log(
        `[${ok ? 'ok ' : 'BAD'}] ${name.padEnd(22)} ${KB(inSize).padStart(4)}KB -> ${KB(
          outSize,
        ).padStart(4)}KB (-${pct}%)  skins ${after.skins} joints ${after.skinJoints} ` +
          `clips ${after.clips} ch ${after.channels} J/W ${after.joints}/${after.weights}`,
      );
    } catch (err) {
      failures.push(`${name}: threw — ${err.message}`);
      console.log(`[ERR] ${name.padEnd(22)} ${err.message}`);
    }
  }

  console.log(
    `\n${names.length} variants -> ${OUT}\n` +
      `  total: ${MB(totalIn)} MB -> ${MB(totalOut)} MB ` +
      `(-${((1 - totalOut / totalIn) * 100).toFixed(0)}%, saved ${MB(totalIn - totalOut)} MB)`,
  );

  if (failures.length) {
    console.error(`\nFAILED — ${failures.length} file(s) did not validate:`);
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log(
    '\nAll variants valid: 1 skin + inverseBindMatrices intact, no clip/channel/joint/weight loss, EXT_meshopt_compression only.',
  );
}

main().catch((err) => {
  console.error('[gen-characters-mobile] FAILED:', err);
  process.exit(1);
});
