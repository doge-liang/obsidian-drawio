// Downloads a pinned drawio webapp (draw.war = ZIP) and extracts static files to webapp/.
import { copyFileSync, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFileSync, spawnSync } from 'node:child_process';

const DRAWIO_VERSION = 'v31.1.8';
// SHA-256 of the pinned draw.war — MUST match DRAWIO_WAR_SHA256 in
// src/constants.ts (guarded by tests/drawioVersionSync.test.ts), so the
// build-time fetch and the runtime installer accept the exact same bytes.
const WAR_SHA256 = '46389bd60810f9775cd463c9eff4f4f8335f10926d613b0606ad4e978f46d49b';
const WAR_URL = `https://github.com/jgraph/drawio/releases/download/${DRAWIO_VERSION}/draw.war`;
const OUT_DIR = join(process.cwd(), 'webapp');

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  if (!res.body) throw new Error(`Response body is null for ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

/**
 * Abort unless the downloaded archive hashes to the pinned SHA-256. Runs before
 * anything is extracted, so a bad download can never reach webapp/ or the
 * vendored viewer.min.txt.
 */
async function verifyWarChecksum(file, expected) {
  const actual = createHash('sha256').update(await readFile(file)).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `BLOCKED: checksum mismatch for ${WAR_URL}\n` +
      `  expected sha256 ${expected}\n` +
      `  actual   sha256 ${actual}\n` +
      'The download was corrupted, or the pinned archive changed upstream. ' +
      'Nothing was extracted. Re-run `npm run fetch-drawio`; if it keeps failing, ' +
      'update WAR_SHA256 here and DRAWIO_WAR_SHA256 in src/constants.ts together, ' +
      'and only after verifying the new archive.'
    );
  }
}

/**
 * Returns true if `unzip` is available on PATH, false otherwise.
 */
function hasUnzip() {
  const result = spawnSync('unzip', ['-v'], { stdio: 'ignore' });
  return result.status === 0 && !result.error;
}

/**
 * Returns true if `python3` (or `python`) is available on PATH.
 * Sets pythonCmd to the found binary.
 */
function findPython() {
  for (const cmd of ['python3', 'python']) {
    const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    if (result.status === 0) return cmd;
  }
  return null;
}

/**
 * Extract a ZIP archive using unzip CLI.
 */
function extractWithUnzip(archive, destDir) {
  execFileSync('unzip', ['-q', '-o', archive, '-d', destDir]);
}

/**
 * Extract a ZIP archive using Python's zipfile module (fallback when unzip is unavailable).
 */
function extractWithPython(pythonCmd, archive, destDir) {
  const script = [
    'import zipfile, sys',
    'archive, dest = sys.argv[1], sys.argv[2]',
    'with zipfile.ZipFile(archive) as zf:',
    '    zf.extractall(dest)',
  ].join('\n');
  execFileSync(pythonCmd, ['-c', script, archive, destDir]);
}

async function main() {
  const tmp = await mkdtemp(join(tmpdir(), 'drawio-'));
  try {
    const war = join(tmp, 'draw.war');
    console.log(`Downloading ${WAR_URL} ...`);
    await download(WAR_URL, war);

    console.log('Verifying checksum ...');
    await verifyWarChecksum(war, WAR_SHA256);

    // Only now is the previous webapp/ cleared: a failed download or a checksum
    // mismatch above leaves whatever was already extracted fully intact.
    if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });

    // draw.war is a ZIP. Extract everything, then drop the server-only WEB-INF/META-INF.
    console.log('Extracting ...');

    if (hasUnzip()) {
      extractWithUnzip(war, OUT_DIR);
    } else {
      // unzip not available; try Python's zipfile as a zero-dependency fallback.
      const pythonCmd = findPython();
      if (!pythonCmd) {
        throw new Error(
          'BLOCKED: Neither `unzip` nor `python3`/`python` is available on this system. ' +
          'Please install `unzip` (e.g. `sudo apt-get install unzip`) and re-run `npm run fetch-drawio`.'
        );
      }
      console.log(`unzip not found — using ${pythonCmd} zipfile module as fallback`);
      extractWithPython(pythonCmd, war, OUT_DIR);
    }

    rmSync(join(OUT_DIR, 'WEB-INF'), { recursive: true, force: true });
    rmSync(join(OUT_DIR, 'META-INF'), { recursive: true, force: true });

    // Sanity check key files exist.
    for (const f of ['index.html', join('js', 'viewer.min.js')]) {
      if (!existsSync(join(OUT_DIR, f))) throw new Error(`Missing expected file in webapp: ${f}`);
    }

    mkdirSync(join(process.cwd(), 'src', 'preview'), { recursive: true });
    copyFileSync(join(OUT_DIR, 'js', 'viewer.min.js'),
      join(process.cwd(), 'src', 'preview', 'viewer.min.txt'));

    await writeFile(join(OUT_DIR, 'DRAWIO_VERSION'), DRAWIO_VERSION + '\n');
    console.log(`drawio ${DRAWIO_VERSION} extracted to ${OUT_DIR}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
