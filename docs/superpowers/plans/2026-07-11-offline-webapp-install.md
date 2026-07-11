# Offline Webapp Detection & One-Click Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the silent offline→online fallback; add webapp install detection plus a one-click installer (download + extract) in the settings tab.

**Architecture:** A typed error (`src/model/errors.ts`) replaces the fallback in `resolveBaseUrl()`; both editor entry points already catch mount errors and will surface its message. A desktop-only installer module (`src/desktop/webappInstaller.ts`, static node imports allowed there) downloads the pinned `draw.war` via `node:https` into memory, extracts with `fflate` into `webapp.installing/`, validates, then atomically renames to `webapp/`. Install state lives on the plugin instance (`InstallStatus`) so settings re-renders never lose progress. Spec: `docs/superpowers/specs/2026-07-11-offline-webapp-install-design.md`.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild (bundles `fflate` inline), vitest + jsdom, `node:https`/`node:fs` (desktop only).

## Global Constraints

- Node/electron imports: static top-level imports of `node:*` ONLY inside `src/server/**` or `src/desktop/**`; everywhere else use dynamic `await import('node:...')` inside the function body. Never remove `supported: { 'dynamic-import': false }` from `esbuild.config.mjs`.
- No `createElement('script')`, no DOMPurify, no regex-literal lookbehind/named-groups/`\p{}` anywhere in `src/`.
- No new Obsidian APIs newer than `minAppVersion` `1.4.0` (this plan uses only `Notice`, `Setting.addButton`/`setDesc`, `ButtonComponent` — all long-baseline).
- `fflate` goes in **devDependencies** (esbuild inlines it into `main.js`; Obsidian never runs npm install).
- UI copy: English, sentence case (Obsidian convention).
- drawio version stays pinned at `v30.0.4` and must match `scripts/fetch-drawio.mjs`.
- `window.setTimeout`/`window.clearTimeout` (not bare globals) if timers are ever added; none planned.
- Each task: run `npx tsc -noEmit -skipLibCheck` and `npm test` before committing.

---

### Task 1: Dependencies + pinned version constants

**Files:**
- Modify: `package.json` (add `fflate` devDependency)
- Modify: `src/constants.ts` (add `DRAWIO_VERSION`, `DRAWIO_WAR_URL`)
- Test: `tests/drawioVersionSync.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `DRAWIO_VERSION: string` (`'v30.0.4'`) and `DRAWIO_WAR_URL: string`, exported from `src/constants.ts`. Task 3 imports both.

- [ ] **Step 1: Install dependencies in the worktree**

The worktree is fresh (no `node_modules/`, no `webapp/`, no `src/preview/viewer.min.txt` — the viewer-dependent test suites skip themselves when the file is absent; that is expected until Task 6).

```bash
npm install
npm install --save-dev fflate
```

Expected: `fflate` appears in `package.json` devDependencies; `package-lock.json` updated.

- [ ] **Step 2: Write the failing version-sync test**

Create `tests/drawioVersionSync.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DRAWIO_VERSION, DRAWIO_WAR_URL } from '../src/constants';

// The runtime installer (src/desktop/webappInstaller.ts) and the build-time
// fetch script must install the exact same drawio version, or the bundled
// viewer.min.txt and the installed webapp drift apart.
describe('drawio version pinning', () => {
  it('matches the version pinned in scripts/fetch-drawio.mjs', () => {
    const script = readFileSync('scripts/fetch-drawio.mjs', 'utf8');
    const m = script.match(/DRAWIO_VERSION = '([^']+)'/);
    expect(m?.[1]).toBe(DRAWIO_VERSION);
  });

  it('builds the war URL from the pinned version', () => {
    expect(DRAWIO_WAR_URL).toBe(
      `https://github.com/jgraph/drawio/releases/download/${DRAWIO_VERSION}/draw.war`,
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/drawioVersionSync.test.ts`
Expected: FAIL — `'"DRAWIO_VERSION" is not exported'` (or similar import error).

- [ ] **Step 4: Add the constants**

In `src/constants.ts`, after the `ONLINE_DRAWIO_URL` export:

```ts
/** Pinned drawio version — MUST match scripts/fetch-drawio.mjs (guarded by
 * tests/drawioVersionSync.test.ts) so the runtime-installed webapp matches the
 * bundled viewer.min.txt. */
export const DRAWIO_VERSION = 'v30.0.4';

/** The pinned drawio webapp archive (a ZIP), downloaded by the settings-tab
 * one-click installer. */
export const DRAWIO_WAR_URL =
  `https://github.com/jgraph/drawio/releases/download/${DRAWIO_VERSION}/draw.war`;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/drawioVersionSync.test.ts && npx tsc -noEmit -skipLibCheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/constants.ts tests/drawioVersionSync.test.ts
git commit -m "feat: pin drawio version/war URL in constants, add fflate dep"
```

---

### Task 2: Typed error + detection + remove the offline→online fallback

**Files:**
- Create: `src/model/errors.ts`
- Modify: `src/main.ts:1` (imports), `src/main.ts:13-14` (remove field), `src/main.ts:77-104` (`resolveBaseUrl`), add `isWebappInstalled()`/`installedWebappVersion()` after `pluginDir()` (line 75)
- Modify: `src/editor/DrawioModal.ts:24-28`
- Modify: `src/file/DrawioFileView.ts:66-69`
- Test: `tests/resolveBaseUrl.test.ts` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `class OfflineEditorNotInstalledError extends Error` in `src/model/errors.ts` (constructor takes no arguments; `message` is user-facing copy).
  - `DrawioPlugin.isWebappInstalled(): Promise<boolean>` — Task 4 (load-time notice) and Task 5 (settings row) call it.
  - `DrawioPlugin.installedWebappVersion(): Promise<string | null>` — Task 5 calls it.

- [ ] **Step 1: Write the failing tests**

Create `tests/resolveBaseUrl.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import DrawioPlugin from '../src/main';
import { OfflineEditorNotInstalledError } from '../src/model/errors';
import { ONLINE_DRAWIO_URL } from '../src/constants';

// resolveBaseUrl/isWebappInstalled are instance methods with no constructor
// dependencies beyond the fields they read, so they are tested via
// prototype.call on a minimal fake (same pattern as other suites' fakePlugin).
// The cast keeps strictBindCallApply satisfied.
const proto = DrawioPlugin.prototype;
const asPlugin = (o: object) => o as unknown as DrawioPlugin;

describe('resolveBaseUrl', () => {
  it('throws OfflineEditorNotInstalledError in offline mode without the webapp', async () => {
    const fake = asPlugin({
      settings: { drawioMode: 'offline', customDrawioUrl: '' },
      isWebappInstalled: async () => false,
    });
    await expect(proto.resolveBaseUrl.call(fake)).rejects.toBeInstanceOf(
      OfflineEditorNotInstalledError,
    );
  });

  it('serves from the local server in offline mode when installed', async () => {
    const touch = vi.fn();
    const fake = asPlugin({
      settings: { drawioMode: 'offline', customDrawioUrl: '' },
      isWebappInstalled: async () => true,
      server: { ensureStarted: async () => 3456, touch },
    });
    await expect(proto.resolveBaseUrl.call(fake)).resolves.toBe(
      'http://127.0.0.1:3456/index.html',
    );
    expect(touch).toHaveBeenCalled();
  });

  it('returns the online URL in online mode', async () => {
    const fake = asPlugin({ settings: { drawioMode: 'online', customDrawioUrl: '' } });
    await expect(proto.resolveBaseUrl.call(fake)).resolves.toBe(ONLINE_DRAWIO_URL);
  });
});

describe('isWebappInstalled / installedWebappVersion', () => {
  it('reflects webapp/index.html presence and reads DRAWIO_VERSION', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawio-detect-'));
    try {
      const fake = asPlugin({ pluginDir: async () => dir });
      expect(await proto.isWebappInstalled.call(fake)).toBe(false);
      expect(await proto.installedWebappVersion.call(fake)).toBeNull();

      mkdirSync(join(dir, 'webapp'), { recursive: true });
      writeFileSync(join(dir, 'webapp', 'index.html'), '<html></html>');
      expect(await proto.isWebappInstalled.call(fake)).toBe(true);
      // Manually-installed webapps may lack the version file — that is not an error.
      expect(await proto.installedWebappVersion.call(fake)).toBeNull();

      writeFileSync(join(dir, 'webapp', 'DRAWIO_VERSION'), 'v30.0.4\n');
      expect(await proto.installedWebappVersion.call(fake)).toBe('v30.0.4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/resolveBaseUrl.test.ts`
Expected: FAIL — cannot resolve `../src/model/errors`.

- [ ] **Step 3: Create the error class**

Create `src/model/errors.ts` (pure TS, no node imports — safe to import from any module on any platform):

```ts
/** Thrown by resolveBaseUrl() when the editor source is Offline but the bundled
 * webapp isn't installed. The message is user-facing: both editor entry points
 * (DrawioModal, DrawioFileView) display it verbatim. There is deliberately no
 * automatic online fallback — offline means offline. */
export class OfflineEditorNotInstalledError extends Error {
  constructor() {
    super(
      "The offline drawio editor isn't installed. Install it in the Drawio plugin " +
      'settings, or switch the editor source to Online.',
    );
    this.name = 'OfflineEditorNotInstalledError';
  }
}
```

- [ ] **Step 4: Rework `src/main.ts`**

Replace the import line 1 (drop `Notice`, add the error import below it):

```ts
import { Plugin, FileSystemAdapter, Platform } from 'obsidian';
import { OfflineEditorNotInstalledError } from './model/errors';
```

Delete the field on lines 13-14:

```ts
  /** Show the "offline editor missing, using online" notice only once. */
  private warnedOfflineFallback = false;
```

Add the two detection methods right after `pluginDir()` (after line 75):

```ts
  /** Whether the bundled offline webapp is installed (same criterion the local
   * server relies on: webapp/index.html exists). Desktop-only caller; node
   * modules are imported dynamically per the mobile-safety rule. */
  async isWebappInstalled(): Promise<boolean> {
    const path = await import('node:path');
    const fs = await import('node:fs');
    return fs.existsSync(path.join(await this.pluginDir(), 'webapp', 'index.html'));
  }

  /** The installed webapp's pinned version (from the DRAWIO_VERSION file the
   * installer/fetch script writes), or null when absent — manual installs may
   * not carry the file, which is fine. Desktop-only caller. */
  async installedWebappVersion(): Promise<string | null> {
    try {
      const path = await import('node:path');
      const fs = await import('node:fs');
      const raw = fs.readFileSync(
        path.join(await this.pluginDir(), 'webapp', 'DRAWIO_VERSION'), 'utf8');
      return raw.trim() || null;
    } catch {
      return null;
    }
  }
```

Replace the offline branch of `resolveBaseUrl()` (lines 82-101) so the whole method reads:

```ts
  async resolveBaseUrl(): Promise<string> {
    const mode = this.settings.drawioMode;
    if (mode === 'custom' && this.settings.customDrawioUrl) {
      return this.settings.customDrawioUrl;
    }
    if (mode === 'offline') {
      // No fallback: offline means offline. The entry points surface this
      // error's message, which points at the settings-tab installer.
      if (!(await this.isWebappInstalled())) {
        throw new OfflineEditorNotInstalledError();
      }
      const port = await this.server!.ensureStarted();
      this.server!.touch();
      return `http://127.0.0.1:${port}/index.html`;
    }
    // 'online' (and 'custom' with no URL set) → the hosted diagrams.net embed.
    return ONLINE_DRAWIO_URL;
  }
```

- [ ] **Step 5: Surface the message at both entry points**

`src/editor/DrawioModal.ts` — add the import and replace the catch block (lines 24-28):

```ts
import { OfflineEditorNotInstalledError } from '../model/errors';
```

```ts
    } catch (err) {
      console.error('[drawio] failed to open editor:', err);
      const msg = err instanceof OfflineEditorNotInstalledError
        ? err.message
        : 'Drawio: failed to open editor — see console (Ctrl+Shift+I)';
      new Notice(msg, 8000);
      this.contentEl.createDiv({
        cls: 'drawio-error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
```

`src/file/DrawioFileView.ts` — replace the mount catch (lines 66-69):

```ts
    this.editor.mount().catch((err) => {
      console.error('[drawio] file-view editor failed to mount', err);
      c.createDiv({
        cls: 'drawio-error',
        text: err instanceof Error ? err.message : String(err),
      });
    });
```

- [ ] **Step 6: Run the suite**

Run: `npx vitest run && npx tsc -noEmit -skipLibCheck`
Expected: all tests PASS (viewer-dependent suites skip — expected in this worktree), no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/model/errors.ts src/main.ts src/editor/DrawioModal.ts src/file/DrawioFileView.ts tests/resolveBaseUrl.test.ts
git commit -m "feat!: remove offline->online fallback; typed not-installed error"
```

---

### Task 3: Installer library (`webappInstaller.ts`) + real-download feasibility check

**Files:**
- Create: `src/desktop/webappInstaller.ts`
- Create: `src/model/installStatus.ts` (progress/state types only in this task; class consumed in Task 5)
- Test: `tests/webappInstaller.test.ts` (new)

**Interfaces:**
- Consumes: `DRAWIO_VERSION`, `DRAWIO_WAR_URL` from `src/constants.ts` (Task 1).
- Produces:
  - `type InstallProgress = { phase: 'download'; received: number; total: number | null } | { phase: 'extract' }` (in `src/model/installStatus.ts`).
  - `installWebapp(pluginDir: string, onProgress: (p: InstallProgress) => void): Promise<void>` (in `src/desktop/webappInstaller.ts`) — Task 5's settings button calls it via dynamic import.
  - `installFromWar(war: Uint8Array, pluginDir: string): void` (exported for tests; the post-download half).

- [ ] **Step 1: Write the failing tests**

Create `tests/webappInstaller.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installFromWar } from '../src/desktop/webappInstaller';
import { DRAWIO_VERSION } from '../src/constants';

function makeWar(entries: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    'index.html': strToU8('<html>drawio</html>'),
    'js/viewer.min.js': strToU8('// viewer'),
    'WEB-INF/web.xml': strToU8('<web-app/>'),
    'META-INF/MANIFEST.MF': strToU8('Manifest-Version: 1.0'),
    ...entries,
  });
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'drawio-install-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('installFromWar', () => {
  it('extracts the webapp, skipping WEB-INF/META-INF, and writes DRAWIO_VERSION', () => {
    installFromWar(makeWar(), dir);
    expect(readFileSync(join(dir, 'webapp', 'index.html'), 'utf8')).toBe('<html>drawio</html>');
    expect(existsSync(join(dir, 'webapp', 'js', 'viewer.min.js'))).toBe(true);
    expect(existsSync(join(dir, 'webapp', 'WEB-INF'))).toBe(false);
    expect(existsSync(join(dir, 'webapp', 'META-INF'))).toBe(false);
    expect(readFileSync(join(dir, 'webapp', 'DRAWIO_VERSION'), 'utf8').trim()).toBe(DRAWIO_VERSION);
    expect(existsSync(join(dir, 'webapp.installing'))).toBe(false);
  });

  it('replaces an existing webapp atomically', () => {
    mkdirSync(join(dir, 'webapp'), { recursive: true });
    writeFileSync(join(dir, 'webapp', 'stale.txt'), 'old');
    installFromWar(makeWar(), dir);
    expect(existsSync(join(dir, 'webapp', 'stale.txt'))).toBe(false);
    expect(existsSync(join(dir, 'webapp', 'index.html'))).toBe(true);
  });

  it('cleans leftover webapp.installing from a previously interrupted run', () => {
    mkdirSync(join(dir, 'webapp.installing'), { recursive: true });
    writeFileSync(join(dir, 'webapp.installing', 'junk.txt'), 'junk');
    installFromWar(makeWar(), dir);
    expect(existsSync(join(dir, 'webapp', 'junk.txt'))).toBe(false);
    expect(existsSync(join(dir, 'webapp', 'index.html'))).toBe(true);
  });

  it('rejects an archive missing required files, keeping the old webapp intact', () => {
    mkdirSync(join(dir, 'webapp'), { recursive: true });
    writeFileSync(join(dir, 'webapp', 'index.html'), 'previous install');
    const bad = zipSync({ 'js/viewer.min.js': strToU8('// viewer only') });
    expect(() => installFromWar(bad, dir)).toThrow(/index\.html/);
    // Old install untouched, staging cleaned up.
    expect(readFileSync(join(dir, 'webapp', 'index.html'), 'utf8')).toBe('previous install');
    expect(existsSync(join(dir, 'webapp.installing'))).toBe(false);
  });

  it('rejects zip entries that escape the target directory (zip-slip)', () => {
    // If fflate's zipSync ever refuses to create '../' entry names, keep the
    // guard in the implementation and adapt this test to call the exported
    // path check directly instead of deleting the test.
    const evil = makeWar({ '../evil.txt': strToU8('escape') });
    expect(() => installFromWar(evil, dir)).toThrow(/[Uu]nsafe zip entry/);
    expect(existsSync(join(dir, 'evil.txt'))).toBe(false);
    expect(existsSync(join(dir, 'webapp.installing'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/webappInstaller.test.ts`
Expected: FAIL — cannot resolve `../src/desktop/webappInstaller`.

- [ ] **Step 3: Create the progress type module**

Create `src/model/installStatus.ts` (pure TS — no node imports; Task 5 extends this file with the `InstallStatus` class):

```ts
/** Progress events emitted by the offline-webapp installer. Download progress
 * is per-chunk; extraction is a single coarse phase (fflate's unzipSync is
 * synchronous — deliberately no finer granularity, per the design spec). */
export type InstallProgress =
  | { phase: 'download'; received: number; total: number | null }
  | { phase: 'extract' };
```

- [ ] **Step 4: Implement the installer**

Create `src/desktop/webappInstaller.ts`. This file lives in `src/desktop/**`, so static `node:*` imports are allowed (it is only ever loaded through desktop-gated dynamic imports).

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/webappInstaller.test.ts && npx tsc -noEmit -skipLibCheck`
Expected: PASS. If the zip-slip test fails because `zipSync` normalizes the entry name, follow the note inside that test.

- [ ] **Step 6: Feasibility check — real download through the production code**

This validates the riskiest assumptions (redirect handling, content-length check, fflate on the real 53 MB war) before any UI is built, per the design spec. Not committed; uses a throwaway temp dir.

```bash
TMP=$(mktemp -d)
npx esbuild src/desktop/webappInstaller.ts --bundle --platform=node --format=esm --outfile="$TMP/installer.mjs"
cat > "$TMP/drive.mjs" <<'EOF'
import { installWebapp } from './installer.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'drawio-feas-'));
let lastPct = -1;
await installWebapp(dir, (p) => {
  if (p.phase === 'extract') { console.log('extracting…'); return; }
  if (p.total) {
    const pct = Math.floor((p.received / p.total) * 100);
    if (pct !== lastPct && pct % 20 === 0) { lastPct = pct; console.log(`download ${pct}%`); }
  }
});
for (const f of ['index.html', join('js', 'viewer.min.js'), 'DRAWIO_VERSION']) {
  if (!existsSync(join(dir, 'webapp', f))) throw new Error(`missing webapp/${f}`);
}
console.log('installed version:', readFileSync(join(dir, 'webapp', 'DRAWIO_VERSION'), 'utf8').trim());
rmSync(dir, { recursive: true, force: true });
console.log('FEASIBILITY OK');
EOF
node "$TMP/drive.mjs"
rm -rf "$TMP"
```

Expected output ends with `installed version: v30.0.4` and `FEASIBILITY OK`. If this fails, STOP and investigate before building the UI on top.

- [ ] **Step 7: Commit**

```bash
git add src/desktop/webappInstaller.ts src/model/installStatus.ts tests/webappInstaller.test.ts
git commit -m "feat: add offline webapp installer (download + extract + atomic swap)"
```

---

### Task 4: Load-time detection notice

**Files:**
- Modify: `src/desktop/registerDesktopFeatures.ts:1` (imports) and end of `registerDesktopFeatures()` (after line 47)
- Test: `tests/registerDesktopFeatures.test.ts` (extend)

**Interfaces:**
- Consumes: `plugin.isWebappInstalled()` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

In `tests/registerDesktopFeatures.test.ts`, mock `Notice` at the top of the file (before the existing imports of the module under test):

```ts
vi.mock('obsidian', async (importOriginal) => {
  const orig = await importOriginal<typeof import('obsidian')>();
  return { ...orig, Notice: vi.fn() };
});
import { Notice } from 'obsidian';
```

Extend `fakePlugin()`'s `raw` object with:

```ts
    settings: {
      serverPortMin: 3000, serverPortMax: 3999, serverIdleTimeout: 300,
      drawioMode: 'offline',
    },
    isWebappInstalled: vi.fn(async () => true),
```

Add a `beforeEach(() => { vi.mocked(Notice).mockClear(); })` and these tests:

```ts
  it('shows a notice when offline mode is set but the webapp is missing', async () => {
    const { plugin, raw } = fakePlugin();
    raw.isWebappInstalled = vi.fn(async () => false);
    await registerDesktopFeatures(plugin);
    expect(Notice).toHaveBeenCalledWith(
      expect.stringContaining('offline editor'), expect.any(Number),
    );
  });

  it('stays silent when the webapp is installed', async () => {
    const { plugin } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(Notice).not.toHaveBeenCalled();
  });

  it('stays silent in online mode even without the webapp', async () => {
    const { plugin, raw } = fakePlugin();
    raw.settings.drawioMode = 'online';
    raw.isWebappInstalled = vi.fn(async () => false);
    await registerDesktopFeatures(plugin);
    expect(Notice).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/registerDesktopFeatures.test.ts`
Expected: the first new test FAILS (`Notice` never called); pre-existing tests still pass.

- [ ] **Step 3: Implement the notice**

In `src/desktop/registerDesktopFeatures.ts`, extend the obsidian import (line 1):

```ts
import { FileSystemAdapter, Notice, TFolder } from 'obsidian';
```

Append at the end of `registerDesktopFeatures()` (after the file-menu registration):

```ts
  // Lifecycle detection: offline mode selected but the webapp isn't installed.
  // One notice per plugin load — the settings tab carries the actual installer.
  if (plugin.settings.drawioMode === 'offline' && !(await plugin.isWebappInstalled())) {
    new Notice(
      "Drawio: the offline editor isn't installed — open the plugin settings to " +
      'install it, or switch the editor source to Online.',
      10000,
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/registerDesktopFeatures.test.ts && npx tsc -noEmit -skipLibCheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/registerDesktopFeatures.ts tests/registerDesktopFeatures.test.ts
git commit -m "feat: notify at load when offline mode lacks the webapp"
```

---

### Task 5: Install state tracker + settings-tab UI

**Files:**
- Modify: `src/model/installStatus.ts` (add state type, `InstallStatus` class, `formatInstallProgress`)
- Modify: `src/main.ts` (add `webappInstallStatus` field)
- Modify: `src/settingsTab.ts` (offline status row + install/reinstall flow; update Editor source desc)
- Modify: `tests/obsidian-stub.ts` (add `ButtonComponent`, `Setting.addButton`, `Setting.descEl`)
- Test: `tests/installStatus.test.ts` (new), `tests/settingsTab.test.ts` (extend)

**Interfaces:**
- Consumes: `installWebapp` (Task 3, via dynamic import), `isWebappInstalled`/`installedWebappVersion` (Task 2), `InstallProgress` (Task 3).
- Produces:
  - `type WebappInstallState = { status: 'idle' } | { status: 'installing'; progressText: string } | { status: 'error'; message: string }`
  - `class InstallStatus { state: WebappInstallState; set(s): void; subscribe(cb): void }` — single listener, last subscriber wins (there is only ever one settings pane).
  - `formatInstallProgress(p: InstallProgress): string`
  - `DrawioPlugin.webappInstallStatus: InstallStatus`

- [ ] **Step 1: Write the failing tracker tests**

Create `tests/installStatus.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { InstallStatus, formatInstallProgress } from '../src/model/installStatus';

describe('InstallStatus', () => {
  it('notifies the current subscriber on set', () => {
    const s = new InstallStatus();
    const cb = vi.fn();
    s.subscribe(cb);
    s.set({ status: 'installing', progressText: 'Downloading… 10%' });
    expect(s.state).toEqual({ status: 'installing', progressText: 'Downloading… 10%' });
    expect(cb).toHaveBeenCalledWith({ status: 'installing', progressText: 'Downloading… 10%' });
  });

  it('replaces the previous subscriber (settings re-render)', () => {
    const s = new InstallStatus();
    const first = vi.fn();
    const second = vi.fn();
    s.subscribe(first);
    s.subscribe(second);
    s.set({ status: 'idle' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });
});

describe('formatInstallProgress', () => {
  it('formats download with a known total as a percentage', () => {
    expect(formatInstallProgress({ phase: 'download', received: 26_500_000, total: 53_000_000 }))
      .toBe('Downloading… 50%');
  });

  it('formats download without a total as received MB', () => {
    expect(formatInstallProgress({ phase: 'download', received: 5 * 1024 * 1024, total: null }))
      .toBe('Downloading… 5.0 MB');
  });

  it('formats extraction', () => {
    expect(formatInstallProgress({ phase: 'extract' })).toBe('Extracting…');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/installStatus.test.ts`
Expected: FAIL — `InstallStatus` not exported.

- [ ] **Step 3: Implement tracker + formatter**

Append to `src/model/installStatus.ts`:

```ts
/** UI-facing install state, held on the plugin instance so it outlives
 * settings-tab re-renders (display() rebuilds the whole pane at any time). */
export type WebappInstallState =
  | { status: 'idle' }
  | { status: 'installing'; progressText: string }
  | { status: 'error'; message: string };

/** Single-listener state holder: the settings row re-subscribes on every
 * render, and only one settings pane exists, so last-subscriber-wins is
 * exactly the right semantics. */
export class InstallStatus {
  state: WebappInstallState = { status: 'idle' };
  private listener: ((s: WebappInstallState) => void) | null = null;

  set(state: WebappInstallState): void {
    this.state = state;
    this.listener?.(state);
  }

  subscribe(cb: (s: WebappInstallState) => void): void {
    this.listener = cb;
  }
}

export function formatInstallProgress(p: InstallProgress): string {
  if (p.phase === 'extract') return 'Extracting…';
  if (p.total) return `Downloading… ${Math.floor((p.received / p.total) * 100)}%`;
  return `Downloading… ${(p.received / (1024 * 1024)).toFixed(1)} MB`;
}
```

In `src/main.ts`, import and add the field after `server`:

```ts
import { InstallStatus } from './model/installStatus';
```

```ts
  /** Offline-webapp install state — on the plugin (not the settings tab) so a
   * mid-install settings re-render can re-attach to the running install. */
  webappInstallStatus = new InstallStatus();
```

Run: `npx vitest run tests/installStatus.test.ts` — expected PASS.

- [ ] **Step 4: Extend the obsidian stub**

In `tests/obsidian-stub.ts`, add a `ButtonComponent` class (next to the other component classes) and wire `Setting`:

```ts
export class ButtonComponent {
  buttonEl: HTMLButtonElement = document.createElement('button');
  setButtonText(t: string): this { this.buttonEl.textContent = t; return this; }
  setCta(): this { return this; }
  setDisabled(d: boolean): this { this.buttonEl.disabled = d; return this; }
  onClick(cb: (evt: MouseEvent) => unknown): this {
    this.buttonEl.addEventListener('click', () => { void cb(new MouseEvent('click')); });
    return this;
  }
}
```

In the `Setting` stub: add a public `descEl`, create/append it in the constructor (class `setting-item-description`), make `setDesc` write `descEl.textContent`, and add:

```ts
  addButton(cb: (b: ButtonComponent) => unknown): this {
    const b = new ButtonComponent();
    this.settingEl.appendChild(b.buttonEl);
    cb(b);
    return this;
  }
```

- [ ] **Step 5: Write the failing settings-tab tests**

In `tests/settingsTab.test.ts`, extend `fakePlugin()` to accept overrides:

```ts
import { InstallStatus } from '../src/model/installStatus';

function fakePlugin(overrides: Record<string, unknown> = {}): DrawioPlugin {
  return {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
    updateServerIdleTimeout: () => {},
    webappInstallStatus: new InstallStatus(),
    isWebappInstalled: async () => false,
    installedWebappVersion: async () => null,
    server: null,
    ...overrides,
  } as unknown as DrawioPlugin;
}
```

Add a new describe block:

```ts
describe('offline editor status row', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  function statusRow(containerEl: HTMLElement): HTMLElement | null {
    return Array.from(containerEl.querySelectorAll('.setting-item')).find((el) =>
      el.querySelector('.setting-item-name')?.textContent === 'Offline editor',
    ) as HTMLElement ?? null;
  }

  it('is shown in offline mode and offers Install when not installed', async () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin());
    tab.display();
    const row = statusRow(tab.containerEl);
    expect(row).not.toBeNull();
    await vi.waitFor(() => {
      expect(row!.querySelector('button')?.textContent).toBe('Install');
      expect(row!.querySelector('.setting-item-description')?.textContent).toContain('Not installed');
    });
  });

  it('offers Reinstall and shows the version when installed', async () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin({
      isWebappInstalled: async () => true,
      installedWebappVersion: async () => 'v30.0.4',
    }));
    tab.display();
    const row = statusRow(tab.containerEl)!;
    await vi.waitFor(() => {
      expect(row.querySelector('button')?.textContent).toBe('Reinstall');
      expect(row.querySelector('.setting-item-description')?.textContent).toContain('v30.0.4');
    });
  });

  it('renders live progress while an install is running', async () => {
    Platform.isDesktopApp = true;
    const plugin = fakePlugin();
    (plugin as unknown as { webappInstallStatus: InstallStatus }).webappInstallStatus
      .set({ status: 'installing', progressText: 'Downloading… 42%' });
    const tab = new DrawioSettingTab({} as never, plugin);
    tab.display();
    const row = statusRow(tab.containerEl)!;
    expect(row.querySelector('.setting-item-description')?.textContent).toBe('Downloading… 42%');
    expect(row.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
  });

  it('is absent in online mode', () => {
    Platform.isDesktopApp = true;
    const plugin = fakePlugin();
    (plugin as unknown as { settings: { drawioMode: string } }).settings.drawioMode = 'online';
    const tab = new DrawioSettingTab({} as never, plugin);
    tab.display();
    expect(statusRow(tab.containerEl)).toBeNull();
  });
});
```

Also import `vi` in the test file's vitest import.

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run tests/settingsTab.test.ts`
Expected: new tests FAIL (no 'Offline editor' row rendered).

- [ ] **Step 7: Implement the settings row**

In `src/settingsTab.ts`:

Imports (top of file):

```ts
import { App, ButtonComponent, Platform, PluginSettingTab, Setting } from 'obsidian';
import { formatInstallProgress, type WebappInstallState } from './model/installStatus';
```

Update the Editor source desc (line 28-32) — drop the fallback sentence:

```ts
        .setDesc(
          'Offline (default) uses the bundled editor served locally — fully offline, no network. ' +
          'Online loads the editor from diagrams.net. Or point at a custom embed URL. The offline ' +
          'editor requires a one-time install — see below when Offline is selected.',
        )
```

After the custom-URL block (after line 57), add:

```ts
      // Offline-editor install status + one-click installer.
      if (s.drawioMode === 'offline') {
        this.renderOfflineEditorStatus(containerEl);
      }
```

Add these methods to the class:

```ts
  /** Status row for the bundled offline editor: detection is async (disk
   * check), so the row renders a checking state and fills itself in; while an
   * install runs, the row re-subscribes to the plugin-held status each render
   * so progress survives full display() re-renders. */
  private renderOfflineEditorStatus(containerEl: HTMLElement): void {
    const setting = new Setting(containerEl).setName('Offline editor');
    let button!: ButtonComponent;
    setting.addButton((b) => {
      button = b;
      b.onClick(() => { void this.startInstall(); });
    });

    const status = this.plugin.webappInstallStatus;
    const refresh = async (state: WebappInstallState) => {
      if (state.status === 'installing') {
        setting.setDesc(state.progressText);
        button.setButtonText('Installing…').setDisabled(true);
        return;
      }
      if (state.status === 'error') {
        setting.setDesc(`Install failed: ${state.message}`);
        button.setButtonText('Retry').setDisabled(false);
        return;
      }
      // idle → check the disk.
      setting.setDesc('Checking installation…');
      button.setButtonText('Install').setDisabled(true);
      const installed = await this.plugin.isWebappInstalled();
      if (status.state.status !== 'idle') return; // an install started meanwhile
      if (installed) {
        const version = await this.plugin.installedWebappVersion();
        setting.setDesc(version ? `Installed (drawio ${version}).` : 'Installed.');
        button.setButtonText('Reinstall').setDisabled(false);
      } else {
        setting.setDesc(
          'Not installed. Installing downloads ~53 MB from GitHub (one time, needs network); ' +
          'editing is fully offline afterwards. Reinstalling interrupts any open offline editor.',
        );
        button.setButtonText('Install').setCta().setDisabled(false);
      }
    };
    status.subscribe((state) => { void refresh(state); });
    void refresh(status.state);
  }

  /** Runs the installer, publishing progress through the plugin-held status.
   * Stops the local server first: on Windows an open handle inside webapp/
   * would make the atomic swap fail. */
  private async startInstall(): Promise<void> {
    const status = this.plugin.webappInstallStatus;
    if (status.state.status === 'installing') return;
    this.plugin.server?.stop();
    status.set({ status: 'installing', progressText: 'Starting download…' });
    try {
      const { installWebapp } = await import('./desktop/webappInstaller');
      await installWebapp(await this.plugin.pluginDir(), (p) => {
        status.set({ status: 'installing', progressText: formatInstallProgress(p) });
      });
      status.set({ status: 'idle' });
    } catch (e) {
      status.set({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }
```

Note: `startInstall` runs to completion even if the settings pane closes (the promise is held by the closure, and state updates against a detached row's DOM are harmless); reopening settings re-subscribes and shows current progress. No cancellation — YAGNI per spec.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run && npx tsc -noEmit -skipLibCheck`
Expected: all PASS (viewer-dependent suites still skip).

- [ ] **Step 9: Commit**

```bash
git add src/model/installStatus.ts src/main.ts src/settingsTab.ts tests/obsidian-stub.ts tests/installStatus.test.ts tests/settingsTab.test.ts
git commit -m "feat: settings-tab offline editor status row with one-click install"
```

---

### Task 6: Documentation + full verification

**Files:**
- Modify: `README.md` (lines 15, 26, 62, 78, and the "Offline editor (optional)" section at 80-88)
- Modify: `CLAUDE.md` (module-map `resolveBaseUrl` line; the "Default editor mode" non-obvious-decision bullet)

**Interfaces:** none — documentation only, then whole-feature verification.

- [ ] **Step 1: Update README.md**

Replace line 15 (`- **Offline editor, optionally** — ...`) with:

```md
- **Offline editor, optionally** — the editor defaults to a bundled, fully offline drawio build served from a local server. Store installs don't include the bundle (~145 MB); install it with one click from the plugin settings, or switch the editor source to Online.
```

Replace line 26 (`No extra setup is needed: ...`) with:

```md
The editor needs one of: the offline editor installed (one click in settings, ~53 MB download), or **Editor source → Online** in the plugin settings.
```

Replace line 62's Editor source row description sentence `Offline falls back to Online automatically when the bundled webapp isn't installed.` with:

```md
Offline requires the one-time install below — there is no automatic fallback.
```

Replace line 78 (`- **When the bundle isn't installed** ...`) with:

```md
- **When the bundle isn't installed**, Offline mode shows an install prompt instead of silently going online. If you choose **Online** (or a Custom URL), the editor UI is loaded from that origin. Your diagram content still stays on your device — it is passed to the editor in the page and is **not uploaded**; only the editor's assets are fetched.
```

Rewrite the "Offline editor (optional)" section (lines 80-88) as:

```md
## Offline editor (optional)

A store install ships without the offline drawio webapp (it is ~145 MB, beyond store limits). To install it, open **Settings → Drawio**, select **Editor source → Offline (bundled webapp)**, and click **Install** — a one-time ~53 MB download from GitHub; editing is fully offline afterwards.

Building from source also works and produces the same layout: run `npm run fetch-drawio` before `npm run build` and copy the `webapp/` folder alongside `main.js` (see Development below).
```

Keep the rest of the section's surrounding content intact; read the actual file before editing — line numbers may have drifted.

- [ ] **Step 2: Update CLAUDE.md**

In the module map, change the `resolveBaseUrl()` sentence to:

```md
  `resolveBaseUrl()` picks the editor URL (offline → local server; throws a typed
  `OfflineEditorNotInstalledError` when the webapp isn't installed — **no automatic
  online fallback** since 0.5.x).
```

Replace the non-obvious-decision bullet `- **Default editor mode is \`offline\`** with automatic online fallback. ...` with:

```md
- **Default editor mode is `offline`, with NO automatic online fallback** (the
  fallback existed through 0.4.x and was removed on purpose — don't reintroduce
  it). The ~145 MB `webapp/` can't ship via the store, so store installs start
  without it: `resolveBaseUrl()` throws `OfflineEditorNotInstalledError`
  (`src/model/errors.ts`), whose message both editor entry points surface, and
  the settings tab offers a one-click installer
  (`src/desktop/webappInstaller.ts`: `node:https` download of the pinned
  `draw.war` → `fflate` extract to `webapp.installing/` → validate → atomic
  rename to `webapp/`; the caller stops the local server first for Windows file
  locks). `fflate` is a devDependency inlined by esbuild. The pinned version
  lives in `src/constants.ts` (`DRAWIO_VERSION`) and a test asserts it matches
  `scripts/fetch-drawio.mjs`. A load-time notice
  (`registerDesktopFeatures.ts`) points offline-mode users at settings when
  the webapp is missing.
```

- [ ] **Step 3: Full verification**

```bash
npm run fetch-drawio   # populates webapp/ + viewer.min.txt so ALL suites run
npm test
npm run build
```

Expected: fetch succeeds; the previously-skipped viewer suites now run and pass; `tsc` + esbuild produce `main.js` with no errors (the guard plugins pass).

- [ ] **Step 4: Grep for stragglers**

```bash
grep -rn "fallback" src/ README.md CLAUDE.md | grep -vi "no automatic\|no fallback\|falls back to an older"
grep -n "warnedOfflineFallback" -r src/ tests/
```

Expected: no hits describing the old offline→online fallback behavior; `warnedOfflineFallback` gone.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: describe offline install flow; remove fallback wording"
```

---

## Post-plan notes (for the session driving this plan)

- **Release-notes callout (when a release is next cut, not part of this plan):** store users who never touched settings were silently using the online editor; after this change they get an install prompt instead. State this prominently.
- **Manual E2E** (cannot be automated here): copy `main.js`/`manifest.json`/`styles.css` into a dev vault **without** `webapp/`, set Offline mode, confirm: load notice appears; opening an editor shows the instructive error; settings shows "Not installed" + Install; clicking Install shows progress then "Installed (drawio v30.0.4)"; editor then opens offline; Reinstall works.
- No version bump in this plan — releases are cut separately per CLAUDE.md's release process.
