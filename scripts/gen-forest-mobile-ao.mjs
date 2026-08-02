/**
 * gen-forest-mobile-ao.mjs — bake the ISLAND-WIDE, TOP-DOWN forest contact-
 * occlusion texture for the MOBILE forest and produce the compressed decal map.
 * MOBILE-ONLY; the desktop-frozen `public/models/forest.glb` and every runtime
 * material are left untouched. This pass does NOT wire the decal into three — it
 * only produces + verifies the texture and reports the world→UV mapping.
 *
 * WHY: the mobile forest (`public/models/forest.mobile.glb`, GPU-instanced) rings
 * a central board CLEARING. A single baked top-down occlusion map, applied later
 * as ONE ground decal / overlay sampled by world XZ, adds cheap grounding depth
 * (dark under tree/rock/mountain clusters, white in the clearing) at ZERO
 * framerate cost — +1 texture tap on one bounded ground quad, no SSAO / no render
 * target / no per-frame shadow / no blur at runtime.
 *
 * PIPELINE:
 *   1. RENDER (Blender/Cycles, scripts/blender/bake_forest_ao.py): import the
 *      mobile glb, drop the `_LOD1`/`_LOD2` sibling meshes + the flat ground floor
 *      (meadow/path/lake) + small clutter (grass/flowers/mushrooms), keep ONLY the
 *      occluders (trees/birch/rocks/mountains), and render them flat-black on a
 *      white world through a TOP-DOWN orthographic camera framing the full island
 *      box. Output: a raw coverage PNG (black = occluded, white = open) + a meta
 *      JSON carrying the world islandMin/islandSize the wiring needs.
 *   2. SOFTEN + SQUARE (this script, sharp): downsample to a square texture,
 *      Gaussian-blur into a soft penumbra (OFFLINE — not a runtime pass), and lift
 *      a subtle black FLOOR so the decal reads as gentle occlusion, not a hard
 *      cut-out. The map is a grayscale occlusion factor (1 = no change, <1 =
 *      darken) — multiply-friendly for either an aoMap-style or a decal overlay.
 *   3. VERIFY it is a sane occlusion map: central (board) region near-WHITE, real
 *      DARK regions under the clusters, plus an ASCII preview + stats.
 *   4. COMPRESS to public/images/forest.mobile.ao.ktx2 (UASTC, linear, genmipmap —
 *      matches board.mobile.ktx2 / city.mobile.ao.ktx2) AND a .webp fallback.
 *
 * Run:  npm run models:forest:ao   (or: node scripts/gen-forest-mobile-ao.mjs)
 */
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const IN = join(ROOT, 'public/models/forest.mobile.glb'); // read-only (mobile source)
const BAKE_PY = join(ROOT, 'scripts/blender/bake_forest_ao.py');
const OUT_KTX2 = join(ROOT, 'public/images/forest.mobile.ao.ktx2');
const OUT_WEBP = join(ROOT, 'public/images/forest.mobile.ao.webp');

const LOCAL_TOKTX = join(ROOT, 'tools/ktx/bin/toktx');
const LOCAL_KTX_LIB = join(ROOT, 'tools/ktx/lib');

// ── Post-process tunables ─────────────────────────────────────────────────────
const TEX_SIZE = 1024;      // final SQUARE texture edge (px). Low-frequency map →
                            // 1024^2 is ample (≈0.1 world units/texel) and matches
                            // the mobile budget (city.mobile.ao is 1024 too).
const AO_BLUR_SIGMA = 6;    // px @1024: soften the hard coverage silhouette into a
                            // ~1-world-unit contact penumbra. OFFLINE blur only.
const AO_FLOOR = 0.25;      // lift the black point so the DARKEST occlusion reads
                            // as a subtle 0.25 (not black); open stays 1.0. Runtime
                            // can scale further via decal opacity / aoMapIntensity.

const MB = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
const KB = (n) => (n / 1024).toFixed(1) + ' KB';

/** Resolve the Blender binary (mirrors gen-city-mobile-ao). */
function resolveBlender() {
  const candidates = [
    process.env.BLENDER,
    '/opt/homebrew/bin/blender',
    '/Applications/Blender.app/Contents/MacOS/Blender',
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === 'blender' || existsSync(c)) return c;
  }
  const onPath = spawnSync('blender', ['--version'], { encoding: 'utf8' });
  if (!onPath.error) return 'blender';
  throw new Error('Blender not found. Set $BLENDER to the Blender 5.x binary.');
}

/** Resolve the toktx binary + any dylib dir it needs (mirrors gen-city-mobile-ao). */
function resolveToktx() {
  if (process.env.TOKTX && existsSync(process.env.TOKTX)) return { bin: process.env.TOKTX, libDir: null };
  const onPath = spawnSync('toktx', ['--version'], { encoding: 'utf8' });
  if (!onPath.error && onPath.status === 0) return { bin: 'toktx', libDir: null };
  if (existsSync(LOCAL_TOKTX)) return { bin: LOCAL_TOKTX, libDir: existsSync(LOCAL_KTX_LIB) ? LOCAL_KTX_LIB : null };
  return null;
}

/**
 * Soften + square the raw coverage render into the final grayscale occlusion map.
 * Returns the processed square PNG path (in `scratch`).
 */
async function postProcess(coveragePng, scratch) {
  const meta = await sharp(coveragePng).metadata();
  console.log(`[gen-forest-ao] coverage render: ${meta.width}x${meta.height} (${KB(statSync(coveragePng).size)})`);

  const outPng = join(scratch, 'forest_ao_1024.png');
  // grayscale → square (anisotropic 'fill'; the true world aspect lives in
  // islandSize, so the shader un-stretches) → blur (offline penumbra) → lift floor.
  // linear(a,b): out = in*a + b (8-bit) with a = 1-FLOOR, b = FLOOR*255 → black
  // point rises to FLOOR, white point stays 255.
  await sharp(coveragePng)
    .grayscale()
    .resize(TEX_SIZE, TEX_SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .blur(AO_BLUR_SIGMA)
    .linear(1 - AO_FLOOR, Math.round(AO_FLOOR * 255))
    .png({ compressionLevel: 9 })
    .toFile(outPng);
  console.log(
    `[gen-forest-ao] processed → ${TEX_SIZE}x${TEX_SIZE} (blur σ=${AO_BLUR_SIGMA}px, floor=${AO_FLOOR}) (${KB(statSync(outPng).size)})`,
  );
  return outPng;
}

/** Read a raw single-channel buffer for verification. */
async function readGray(png) {
  const { data, info } = await sharp(png).grayscale().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Mean of a rectangular region [x0,x1)×[y0,y1) in 0..1. */
function regionMean(g, x0, y0, x1, y1) {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += g.data[y * g.w + x];
      n++;
    }
  }
  return n ? sum / n / 255 : 0;
}

/**
 * Verify the map is a SANE top-down occlusion: central board area near-white,
 * genuine dark regions under the clusters. Throws (fails loud) if not.
 */
async function verify(png, islandSize) {
  const g = await readGray(png);
  const { w, h } = g;

  // Global stats.
  let min = 255;
  let max = 0;
  let sum = 0;
  let dark = 0; // texels darker than 0.75 (visibly occluded)
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    if (v < 0.75 * 255) dark++;
  }
  const mean = sum / g.data.length / 255;
  const darkFrac = dark / g.data.length;

  // CENTER (board footprint) — the forest is centred at world origin, so the board
  // maps to the texture centre. Sample the central ±6% patch → must be near-white.
  const cx0 = Math.floor(w * 0.44);
  const cx1 = Math.ceil(w * 0.56);
  const cy0 = Math.floor(h * 0.44);
  const cy1 = Math.ceil(h * 0.56);
  const centerMean = regionMean(g, cx0, cy0, cx1, cy1);

  // TREELINE RING — a normalized-radius annulus [0.10, 0.26] around the centre
  // (where the occluder ring around the clearing sits). Proves the STRUCTURE
  // (bright clearing INSIDE a darker treeline), which a bare center-vs-global-mean
  // check cannot once the outer terrain is white too.
  let ringSum = 0;
  let ringN = 0;
  const halfW = w / 2;
  const halfH = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nr = Math.hypot((x - halfW) / halfW, (y - halfH) / halfH);
      if (nr >= 0.1 && nr <= 0.26) {
        ringSum += g.data[y * g.w + x];
        ringN++;
      }
    }
  }
  const ringMean = ringN ? ringSum / ringN / 255 : 1;

  // ASCII preview (48 cols). ramp[0]='@' = darkest (occluded), ramp[last]=' ' =
  // white (open); index by brightness m so the picture reads true (dark clusters
  // print '@', the open clearing prints spaces).
  const cols = 48;
  const rows = Math.max(1, Math.round((cols * h) / w / 2)); // /2 for char aspect
  const ramp = '@%#*+=-:. ';
  let preview = '';
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const m = regionMean(
        g,
        Math.floor((c / cols) * w),
        Math.floor((r / rows) * h),
        Math.floor(((c + 1) / cols) * w),
        Math.floor(((r + 1) / rows) * h),
      );
      line += ramp[Math.min(ramp.length - 1, Math.floor(m * ramp.length))];
    }
    preview += '  ' + line + '\n';
  }

  console.log('[gen-forest-ao] occlusion preview (top-down; @ = dark under clusters, space = open/white):');
  console.log(preview);
  console.log(
    `[gen-forest-ao] stats: min=${(min / 255).toFixed(3)} max=${(max / 255).toFixed(3)} ` +
      `mean=${mean.toFixed(3)} centerMean=${centerMean.toFixed(3)} ringMean=${ringMean.toFixed(3)} ` +
      `darkFrac=${(darkFrac * 100).toFixed(1)}%`,
  );
  console.log(`[gen-forest-ao] world island size ≈ ${islandSize.map((v) => v.toFixed(1)).join(' × ')} units`);

  // ── Asserts (fail loud) ──────────────────────────────────────────────────
  const problems = [];
  if (centerMean < 0.85) problems.push(`center not white (mean ${centerMean.toFixed(3)} < 0.85) — board area is occluded`);
  if (centerMean < ringMean + 0.03) {
    problems.push(`clearing (${centerMean.toFixed(3)}) not clearly brighter than treeline ring (${ringMean.toFixed(3)})`);
  }
  if (min / 255 > 0.5) problems.push(`no genuinely dark occlusion (min ${(min / 255).toFixed(3)} > 0.5)`);
  if (darkFrac < 0.02) problems.push(`too little darkening (darkFrac ${(darkFrac * 100).toFixed(1)}% < 2%)`);
  if (max / 255 < 0.95) problems.push(`no clean white/open areas (max ${(max / 255).toFixed(3)} < 0.95)`);
  if (problems.length) {
    throw new Error('verify: not a sane occlusion map:\n  - ' + problems.join('\n  - '));
  }
  console.log('[gen-forest-ao] VERIFY OK: bright clearing inside a darker treeline ring, clean open terrain.');
}

async function compress(processedPng) {
  // WEBP fallback (grayscale). MUST be loaded with flipY=false at runtime (webp
  // defaults flipY=true), mirroring the city AO decal.
  await sharp(processedPng).grayscale().webp({ quality: 82, effort: 6 }).toFile(OUT_WEBP);
  console.log(`[gen-forest-ao] wrote ${OUT_WEBP} (${KB(statSync(OUT_WEBP).size)})`);

  // KTX2 UASTC (primary, VRAM-optimal, matches board/city). LINEAR transfer (AO is
  // not colour); UASTC (not ETC1S) to avoid banding on the smooth gradient.
  const tk = resolveToktx();
  if (!tk) {
    console.warn('[gen-forest-ao] toktx not found — skipping KTX2 (webp fallback written). Set $TOKTX or place tools/ktx/bin/toktx.');
    return;
  }
  const args = [
    '--encode', 'uastc',
    '--uastc_quality', '3',
    '--zcmp', '19',
    '--genmipmap',
    '--assign_oetf', 'linear',
    '--assign_primaries', 'none',
    OUT_KTX2,
    processedPng,
  ];
  const env = { ...process.env };
  if (tk.libDir) {
    env.DYLD_FALLBACK_LIBRARY_PATH = [tk.libDir, env.DYLD_FALLBACK_LIBRARY_PATH].filter(Boolean).join(':');
  }
  console.log(`[gen-forest-ao] toktx ${args.join(' ')}`);
  const res = spawnSync(tk.bin, args, { stdio: 'inherit', env });
  if (res.error || res.status !== 0) {
    throw new Error(`toktx failed: ${res.error?.message ?? 'status ' + res.status}`);
  }
  console.log(`[gen-forest-ao] wrote ${OUT_KTX2} (${KB(statSync(OUT_KTX2).size)})`);
}

async function main() {
  if (!existsSync(IN)) throw new Error(`input not found: ${IN}`);

  const scratch = mkdtempSync(join(tmpdir(), 'forest-ao-'));
  const coveragePng = join(scratch, 'forest_coverage.png');
  const metaJson = join(scratch, 'forest_ao.meta.json');

  // ── 1. Blender top-down coverage render ────────────────────────────────────
  const blender = resolveBlender();
  const bakeArgs = ['--background', '--python', BAKE_PY, '--', IN, coveragePng, metaJson];
  console.log(`[gen-forest-ao] ${blender} ${bakeArgs.join(' ')}`);
  const bake = spawnSync(blender, bakeArgs, { stdio: 'inherit' });
  if (bake.error || bake.status !== 0) {
    throw new Error(`Blender render failed: ${bake.error?.message ?? 'status ' + bake.status}`);
  }
  if (!existsSync(coveragePng) || !existsSync(metaJson)) {
    throw new Error('Blender render did not produce the expected outputs');
  }
  const meta = JSON.parse(readFileSync(metaJson, 'utf8'));

  // ── 2. Soften + square ─────────────────────────────────────────────────────
  const processed = await postProcess(coveragePng, scratch);

  // ── 3. Verify ──────────────────────────────────────────────────────────────
  await verify(processed, meta.island_size_world);

  // ── 4. Compress ────────────────────────────────────────────────────────────
  await compress(processed);

  // ── Report the world→UV mapping the wiring needs ───────────────────────────
  console.log('\n[gen-forest-ao] WIRING CONSTANTS (world → UV for the ground decal):');
  console.log(`  islandMin  (world XZ) = [${meta.island_min_world.join(', ')}]`);
  console.log(`  islandSize (world XZ) = [${meta.island_size_world.join(', ')}]`);
  console.log(`  groupScale           = ${meta.group_scale}`);
  console.log('  uv.u = (worldX - islandMin.x) / islandSize.x   (u: min.x@left → max.x@right)');
  console.log('  uv.v = (worldZ - islandMin.z) / islandSize.z   (PNG row: min.z@top → max.z@bottom)');
  console.log('  (island is centred at world origin: islandMin = -islandSize/2)');

  rmSync(scratch, { recursive: true, force: true });
  console.log(`\n[gen-forest-ao] done. glb source read-only: ${MB(statSync(IN).size)} (unchanged).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
