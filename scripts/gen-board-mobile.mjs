/**
 * gen-board-mobile.mjs — build the MOBILE-ONLY board texture variant
 * `public/images/board.mobile.ktx2` from the committed, desktop-frozen
 * `public/images/board.webp`.
 *
 * WHY: `board.webp` is a 4096×4096 sRGB image. On the GPU a plain webp texture
 * is decompressed to full RGBA8 — 4096·4096·4 = ~64 MB for the base level, and
 * ~85 MB once the trilinear mip chain (+1/3) is resident. On a low-end mobile
 * GPU that is the single biggest texture in the scene, and it is sampled at a
 * grazing angle every frame (max anisotropy), so it costs sampling bandwidth
 * too. A GPU-compressed KTX2 texture stays compressed IN VRAM: UASTC is a
 * 4bpp block format, so the base level is ~8 MB and the full mip chain is
 * ~11 MB of GPU-resident data; three keeps a small transcode target so the
 * effective VRAM footprint is ~21 MB — a ~4× cut plus lower sampling bandwidth.
 *
 * WHY UASTC (not ETC1S): the board carries fine, READABLE printed text and
 * thin colored bands. UASTC is the high-quality transcodable mode designed to
 * preserve exactly that kind of high-frequency detail; ETC1S would smear the
 * small type. UASTC data is incompressible on its own, so we add zstd
 * supercompression (--zcmp) to shrink the on-disk/over-the-wire size with ZERO
 * effect on the transcoded GPU result.
 *
 * The .ktx2 carries its OWN mip chain (--genmipmap) and an sRGB transfer
 * function (--assign_oetf srgb). On the client (mobile only, BoardTiles.tsx)
 * KTX2Loader transcodes it via the self-hosted basis transcoder in
 * /public/basis/ (no external CDN). Desktop keeps `board.webp` byte-identical.
 *
 * PIPELINE:  sharp(board.webp) → temp 4096 sRGB PNG → toktx → board.mobile.ktx2
 *
 * toktx is only needed at BUILD time. It ships in the KhronosGroup KTX-Software
 * release. Resolution order for the binary:
 *   1. $TOKTX                     (explicit path)
 *   2. `toktx` on $PATH           (e.g. a system install)
 *   3. ./tools/ktx/bin/toktx      (local, uncommitted download — see README note)
 * When the local tool dir is used, its libktx dylib dir is added to
 * DYLD_FALLBACK_LIBRARY_PATH automatically.
 *
 * Run:  npm run models:board:mobile
 */
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SRC = join(ROOT, 'public/images/board.webp');
const OUT = join(ROOT, 'public/images/board.mobile.ktx2');
const LOCAL_TOOL = join(ROOT, 'tools/ktx/bin/toktx');
const LOCAL_LIB = join(ROOT, 'tools/ktx/lib');

/** Resolve the toktx binary + any dylib dir it needs. */
function resolveToktx() {
  if (process.env.TOKTX && existsSync(process.env.TOKTX)) {
    return { bin: process.env.TOKTX, libDir: null };
  }
  const onPath = spawnSync('toktx', ['--version'], { encoding: 'utf8' });
  if (!onPath.error && onPath.status === 0) return { bin: 'toktx', libDir: null };
  if (existsSync(LOCAL_TOOL)) return { bin: LOCAL_TOOL, libDir: existsSync(LOCAL_LIB) ? LOCAL_LIB : null };
  console.error(
    'ERROR: toktx not found. Install KhronosGroup KTX-Software (provides toktx),\n' +
      '       set $TOKTX to its path, or place it at tools/ktx/bin/toktx.',
  );
  process.exit(1);
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`ERROR: source not found: ${SRC}`);
    process.exit(1);
  }
  const { bin, libDir } = resolveToktx();

  // 1) Decode board.webp → temp lossless 4096 sRGB PNG (toktx reads PNG, not webp).
  const tmp = mkdtempSync(join(tmpdir(), 'board-ktx-'));
  const tmpPng = join(tmp, 'board.png');
  const meta = await sharp(SRC).metadata();
  console.log(`source: board.webp ${meta.width}×${meta.height} (${meta.space})`);
  await sharp(SRC)
    .toColorspace('srgb')
    .png({ compressionLevel: 9 })
    .toFile(tmpPng);

  // 2) Encode → KTX2, UASTC (highest quality), zstd supercompression, mipmaps, sRGB.
  //    --encode uastc implies --t2 (KTX2 container).
  const args = [
    '--encode', 'uastc',
    '--uastc_quality', '4', // highest UASTC quality — preserves fine board text
    '--zcmp', '19', // zstd supercompression level (lossless; shrinks on-disk size)
    '--genmipmap', // build the mip chain (matches trilinear/anisotropic sampling)
    '--assign_oetf', 'srgb', // sRGB transfer function (board artwork is sRGB)
    '--assign_primaries', 'srgb',
    OUT,
    tmpPng,
  ];

  const env = { ...process.env };
  if (libDir) {
    env.DYLD_FALLBACK_LIBRARY_PATH = [libDir, env.DYLD_FALLBACK_LIBRARY_PATH]
      .filter(Boolean)
      .join(':');
  }

  console.log(`toktx ${args.join(' ')}`);
  const res = spawnSync(bin, args, { stdio: 'inherit', env });
  rmSync(tmp, { recursive: true, force: true });

  if (res.error) {
    console.error(`ERROR running toktx: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`ERROR: toktx exited with status ${res.status}`);
    process.exit(res.status ?? 1);
  }

  const outKB = statSync(OUT).size / 1024;
  const srcKB = statSync(SRC).size / 1024;
  console.log('');
  console.log(`OK  ${OUT}`);
  console.log(`    board.webp        : ${srcKB.toFixed(1)} KB (on disk)`);
  console.log(`    board.mobile.ktx2 : ${outKB.toFixed(1)} KB (on disk)`);
  console.log('    est VRAM  webp (RGBA8, +mips)  : ~85 MB');
  console.log('    est VRAM  ktx2 (UASTC, +mips)  : ~21 MB  (~4× less)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
