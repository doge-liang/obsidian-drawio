import { get } from 'node:https';
import {
  existsSync, mkdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { DRAWIO_VERSION, DRAWIO_WAR_URL } from '../constants';
import type { InstallProgress } from '../model/installStatus';

/** Top-level directories in draw.war that are server-only and never served
 * (same exclusions as scripts/fetch-drawio.mjs). */
const SKIP_PREFIXES = ['WEB-INF/', 'META-INF/'];

/**
 * Download the pinned drawio webapp and install it into `<pluginDir>/webapp`.
 * The caller (settings tab) must stop the local server first — on Windows an
 * open file handle inside webapp/ would make the final swap fail.
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
  installFromWar(war, pluginDir);
}

/** The post-download half, separated for network-free testing: extract into a
 * staging dir, validate, then atomically swap into place. On any failure the
 * staging dir is removed and an existing webapp/ is left untouched. */
export function installFromWar(war: Uint8Array, pluginDir: string): void {
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
    const dest = join(pluginDir, 'webapp');
    rmSync(dest, { recursive: true, force: true });
    renameSync(staging, dest);
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
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

/** GET with redirect following (GitHub release assets 302 to object storage).
 * node:https rather than fetch/requestUrl: streams progress and needs no CORS. */
function download(
  url: string,
  onProgress: (p: InstallProgress) => void,
  redirects = 0,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error(`Too many redirects downloading ${url}`));
      return;
    }
    const req = get(url, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        resolve(download(new URL(location, url).toString(), onProgress, redirects + 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`Download failed: HTTP ${status} for ${url}`));
        return;
      }
      const lenHeader = res.headers['content-length'];
      const total = lenHeader ? Number(lenHeader) : null;
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
    req.on('error', reject);
  });
}
