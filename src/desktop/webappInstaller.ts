import { get as httpsGet } from 'node:https';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { DRAWIO_VERSION, DRAWIO_WAR_SHA256, DRAWIO_WAR_URL } from '../constants';
import type { InstallProgress } from '../model/installStatus';

/** Top-level directories in draw.war that are server-only and never served
 * (same exclusions as scripts/fetch-drawio.mjs). */
const SKIP_PREFIXES = ['WEB-INF/', 'META-INF/'];

/**
 * Download the pinned drawio webapp, verify it against DRAWIO_WAR_SHA256, and
 * install it into `<pluginDir>/webapp`. The caller (settings tab) must stop the
 * local server first — on Windows an open file handle inside webapp/ would make
 * the final swap fail.
 *
 * The whole archive (~53 MB) is buffered in memory: it spares a temp file and
 * its cleanup, and is well within desktop Electron's budget.
 */
export async function installWebapp(
  pluginDir: string,
  onProgress: (p: InstallProgress) => void,
): Promise<void> {
  const war = await download(DRAWIO_WAR_URL, onProgress);
  onProgress({ phase: 'extract' });
  // unzipSync + thousands of sync writes block the renderer's main thread;
  // without a committed frame first, the "Extracting…" label never paints and
  // the UI freezes on a stale download percentage. Double-rAF guarantees a
  // frame commit; the trailing setTimeout yields the macrotask before we block.
  await nextPaint();
  installFromWar(war, pluginDir);
}

/** Resolve after the renderer has committed a frame (double-rAF), then one
 * macrotask later — the last chance to show fresh progress text before a
 * long synchronous block. Raced against a short timeout: Chromium suspends
 * rAF while the window is hidden/minimized, and without the timeout arm an
 * install finishing in the background would stall before extraction until
 * the window became visible again. */
function nextPaint(): Promise<void> {
  const paint = new Promise<void>((resolve) => {
    activeWindow.requestAnimationFrame(() => {
      activeWindow.requestAnimationFrame(() => {
        activeWindow.setTimeout(resolve, 0);
      });
    });
  });
  const hiddenWindowFallback = new Promise<void>((resolve) => {
    activeWindow.setTimeout(resolve, 250);
  });
  return Promise.race([paint, hiddenWindowFallback]);
}

/** The post-download half, separated for network-free testing: verify the
 * archive's SHA-256, extract into a staging dir, validate, then atomically swap
 * into place. On any failure the staging dir is removed; an existing webapp/ is
 * either left fully in place or fully restored — see `swapWebappIntoPlace`.
 *
 * `expectedSha256` defaults to the pinned digest and is only ever passed by
 * tests, which build small synthetic archives. Callers in production must not
 * pass it — `installWebapp` deliberately keeps it out of its own signature, so
 * the shipped path can only ever check against the pin. */
export function installFromWar(
  war: Uint8Array,
  pluginDir: string,
  expectedSha256: string = DRAWIO_WAR_SHA256,
): void {
  // Integrity gate first, ahead of every filesystem write below: an archive
  // that fails it leaves the vault byte-for-byte untouched — no staging dir,
  // no half-replaced webapp/.
  verifyWarChecksum(war, expectedSha256);
  const staging = join(pluginDir, 'webapp.installing');
  rmSync(staging, { recursive: true, force: true });
  try {
    extract(war, staging);
    for (const f of ['index.html', join('js', 'viewer.min.js')]) {
      if (!existsSync(join(staging, f))) {
        throw new Error(`The downloaded webapp is missing ${f} — aborting install.`);
      }
    }
    writeFileSync(join(staging, 'DRAWIO_VERSION'), DRAWIO_VERSION + '\n');
    swapWebappIntoPlace(pluginDir);
  } catch (e) {
    // A successful swap never reaches here — this only runs when extract,
    // validation, or the swap itself failed before or during the staging
    // rename, so staging still exists (or, if the swap already renamed it
    // away, force:true makes this a harmless no-op).
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Throw unless `war` hashes to `expected` (lowercase hex SHA-256).
 *
 * HTTPS and a version-pinned URL already make a substituted archive unlikely;
 * this turns "unlikely" into "detected", and also catches a body that arrived
 * intact-looking but corrupt (Content-Length only proves the byte count).
 *
 * Plain `!==` rather than a constant-time compare on purpose: the digest is a
 * public constant compiled into the plugin, so there is no secret for a timing
 * side channel to leak.
 *
 * Exported for tests.
 */
export function verifyWarChecksum(war: Uint8Array, expected: string = DRAWIO_WAR_SHA256): void {
  const actual = createHash('sha256').update(war).digest('hex');
  if (actual !== expected) {
    throw new Error(
      'The downloaded drawio archive does not match the checksum this plugin ' +
      'version expects, so nothing was installed. The download may have been ' +
      'corrupted in transit, or the archive published upstream may have changed. ' +
      `Check your connection and try again. Expected SHA-256 ${expected}, got ${actual}.`,
    );
  }
}

/**
 * Swap <pluginDir>/webapp.installing into <pluginDir>/webapp via
 * rename-aside, so an existing webapp/ is either fully in place or fully
 * restored — never partially deleted. A plain "rmSync(dest) then
 * renameSync(staging, dest)" can leave NO webapp at all if the delete is a
 * recursive tree removal that throws partway (e.g. a locked file on
 * Windows) or if the rename itself fails after the delete already
 * succeeded. Directory renames are single atomic filesystem operations —
 * they either happen or don't — so renaming the old webapp/ aside first
 * (instead of deleting it) means any later failure can roll it straight
 * back into place.
 *
 * A `webapp.old/` leftover may remain only if the process crashes between
 * the aside-rename and the final cleanup below; it is harmless (not read by
 * anything) and is cleared automatically at the top of the next install.
 *
 * Exported for tests: the rollback path needs failure injection (a missing
 * staging dir stands in for a swap that fails partway).
 */
export function swapWebappIntoPlace(pluginDir: string): void {
  const staging = join(pluginDir, 'webapp.installing');
  const dest = join(pluginDir, 'webapp');
  const old = join(pluginDir, 'webapp.old');

  rmSync(old, { recursive: true, force: true }); // leftover from a past interrupted swap
  let oldAside = false;
  if (existsSync(dest)) {
    renameSync(dest, old); // atomic: on failure, dest is fully intact
    oldAside = true;
  }
  try {
    renameSync(staging, dest);
  } catch (e) {
    if (oldAside) renameSync(old, dest); // roll the old install back into place
    throw e;
  }
  if (oldAside) {
    try {
      rmSync(old, { recursive: true, force: true });
    } catch {
      // The install itself succeeded; a locked leftover webapp.old is
      // cleared by the next install's leading rmSync. Don't fail a
      // successful install over cleanup of the old copy.
    }
  }
}

function extract(war: Uint8Array, destDir: string): void {
  const entries = unzipSync(war, {
    filter: (f) => !SKIP_PREFIXES.some((p) => f.name.startsWith(p)),
  });
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue; // directory entry
    const target = normalize(join(destDir, name));
    // Zip-slip guard: the source is a pinned HTTPS URL, but entry names are
    // still attacker-shaped input in principle — never write outside destDir.
    if (!target.startsWith(destDir + sep)) {
      throw new Error(`Unsafe zip entry path: ${name}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}

/** Injection points for tests only: `getter` swaps node:https for node:http
 * (so error paths can be exercised against a local plain-HTTP server) and
 * `idleMs` shrinks the stall timeout. Production callers pass neither. */
export interface DownloadOpts {
  idleMs?: number;
  getter?: typeof httpsGet;
}

/** GET with redirect following (GitHub release assets 302 to object storage).
 * node:https rather than fetch/requestUrl: streams progress and needs no CORS.
 * A socket-inactivity timeout aborts stalled transfers — without it a dead
 * connection would wedge the settings row in "Installing…" until plugin
 * reload. Exported for tests. */
export function download(
  url: string,
  onProgress: (p: InstallProgress) => void,
  redirects = 0,
  opts: DownloadOpts = {},
): Promise<Uint8Array> {
  const { idleMs = 30_000, getter = httpsGet } = opts;
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error(`Too many redirects downloading ${url}`));
      return;
    }
    const req = getter(url, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        resolve(download(new URL(location, url).toString(), onProgress, redirects + 1, opts));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`Download failed: HTTP ${status} for ${url}`));
        return;
      }
      const lenHeader = res.headers['content-length'];
      const parsedLen = Number(lenHeader);
      // Number.isFinite guards a malformed Content-Length: NaN compares
      // unequal to everything, which would fail the completeness check below
      // on every download.
      const total = lenHeader && Number.isFinite(parsedLen) ? parsedLen : null;
      const chunks: Buffer[] = [];
      let received = 0;
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        received += chunk.length;
        onProgress({ phase: 'download', received, total });
      });
      res.on('end', () => {
        if (total !== null && received !== total) {
          reject(new Error(`Download incomplete: got ${received} of ${total} bytes`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
      res.on('error', reject);
    });
    // Socket-inactivity watchdog (covers both a hung connect and a
    // mid-transfer stall). destroy(err) surfaces through 'error' below.
    req.setTimeout(idleMs, () => {
      req.destroy(new Error(`Download stalled (no data for ${Math.round(idleMs / 1000)} s) — check your connection and retry.`));
    });
    req.on('error', reject);
  });
}
