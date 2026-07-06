# Mobile Preview Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the obsidian-drawio plugin install and run on Obsidian mobile, supporting preview (code blocks, embeds, and a read-only view for standalone `.drawio` files) — editing stays desktop-only.

**Architecture:** Fix the load-time crash (top-level static imports of Node built-ins) by converting them to dynamic imports gated behind `Platform.isDesktopApp`, following the dynamic-import pattern `onload()` already uses. Consolidate everything Node/Electron-touching into a new `src/desktop/registerDesktopFeatures.ts`, reached only through one gated dynamic import. Add a new read-only `DrawioMobileFileView` for standalone `.drawio` files on mobile, and gate the click-to-edit affordance and desktop-only settings rows behind the same `Platform.isDesktopApp` check.

**Tech Stack:** TypeScript, esbuild, vitest (jsdom environment), Obsidian plugin API (`Platform`, `TextFileView`, `PluginSettingTab`, `Setting`).

## Global Constraints

- `minAppVersion` stays `1.4.0` — unchanged. `Platform` (`isDesktopApp`/`isMobile`/`isPhone`/`isTablet`) is `@since 0.12.2`, long publicly released, no guard needed.
- `manifest.json`: `isDesktopOnly` changes from `true` to `false`. Do not touch `version` — a version bump is a release-time decision, not part of this plan.
- No static top-level import of any `node:*` built-in or `electron` outside `src/server/**` or `src/desktop/**`. A dynamic `await import(...)` at the point of use is fine anywhere (e.g. inside a method body in `main.ts`) — the rule is about *static* imports being hoisted and eagerly `require()`d by esbuild's bundling, not about directory location per se, but routing genuinely desktop-only logic through `src/server/**`/`src/desktop/**` keeps the boundary easy to audit.
- Editing (the iframe-based `DrawioEditor`/`DrawioModal`/`DrawioFileView`, `openEditor()`, `editorDeps()`) stays desktop-only in this phase. Do not wire any of these from a code path that also runs on mobile.
- Mobile click-to-edit Notice copy (exact string): `'Drawio: editing is only available on desktop'`.
- Mobile file-view banner copy (exact string): `'Drawio: preview only on mobile — open this file on desktop to edit.'`
- Do not add a `Setting` row for anything mobile can't use. This plan extends the spec's original list ("Editor source", "Custom drawio URL", "Server idle timeout", "Show shape libraries") with **"New diagram location"** and **"New diagram folder"** — the spec omitted these, but they configure `createNewDiagram()`, which is only ever invoked from desktop-gated entry points (ribbon/command/context menu) under this design, so they are equally meaningless on mobile. Task 4 below gates all six.

---

### Task 1: `DrawioMobileFileView` — read-only preview for standalone `.drawio` files

**Files:**
- Create: `src/preview/DrawioMobileFileView.ts`
- Modify: `tests/obsidian-stub.ts` (add `TextFileView`)
- Test: `tests/drawioMobileFileView.test.ts`

**Interfaces:**
- Consumes: `renderPreview(el: HTMLElement, xml: string, opts: RenderOptions): boolean` from `src/preview/ViewerRenderer.ts` (existing); `DRAWIO_VIEW_TYPE` from `src/constants.ts` (existing); `DrawioPlugin.previewOpts(): RenderOptions` from `src/main.ts` (existing).
- Produces: `export class DrawioMobileFileView extends TextFileView { constructor(leaf: WorkspaceLeaf, plugin: DrawioPlugin) }` — Task 3 instantiates this on mobile in place of `DrawioFileView`.

- [ ] **Step 1: Add a minimal `TextFileView` stub**

`tests/obsidian-stub.ts` currently has no `TextFileView` export (nothing has needed it in tests before). Add this class — it's the base class `DrawioMobileFileView` (and the existing `DrawioFileView`) extend:

```ts
export class TextFileView {
  contentEl: HTMLElement = document.createElement('div');
  file: TFile | null = null;
  data = '';
  constructor(_leaf: unknown) {}
  getViewType(): string { return ''; }
  getIcon(): string { return ''; }
  getViewData(): string { return this.data; }
  setViewData(_data: string, _clear: boolean): void {}
  clear(): void {}
  async onClose(): Promise<void> {}
  requestSave(): void {}
}
```

Add this class anywhere in `tests/obsidian-stub.ts` after the existing `TFile` class (so it can reference `TFile` in its type annotation).

- [ ] **Step 2: Write the failing test**

Create `tests/drawioMobileFileView.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DrawioMobileFileView } from '../src/preview/DrawioMobileFileView';
import type DrawioPlugin from '../src/main';

function fakePlugin(): DrawioPlugin {
  return {
    previewOpts: () => ({ dark: false, align: 'center' as const }),
  } as unknown as DrawioPlugin;
}

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" ' +
  'gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" ' +
  'pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">' +
  '<root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

describe('DrawioMobileFileView', () => {
  it('renders the fixed banner and the diagram, with no iframe', () => {
    const view = new DrawioMobileFileView({} as never, fakePlugin());
    view.setViewData(XML, true);
    const banner = view.contentEl.querySelector('.drawio-mobile-banner');
    expect(banner?.textContent).toContain('preview only on mobile');
    expect(view.contentEl.querySelector('.drawio-preview')).not.toBeNull();
    expect(view.contentEl.querySelector('iframe')).toBeNull();
  });

  it('getViewData returns the last data set (no write path)', () => {
    const view = new DrawioMobileFileView({} as never, fakePlugin());
    view.setViewData(XML, true);
    expect(view.getViewData()).toBe(XML);
  });

  it('clear() empties the content element and resets the data', () => {
    const view = new DrawioMobileFileView({} as never, fakePlugin());
    view.setViewData(XML, true);
    view.clear();
    expect(view.contentEl.children.length).toBe(0);
    expect(view.getViewData()).toBe('');
  });

  it('reports the shared drawio view type and a pencil-ruler icon', () => {
    const view = new DrawioMobileFileView({} as never, fakePlugin());
    expect(view.getViewType()).toBe('drawio-file-view');
    expect(view.getIcon()).toBe('pencil-ruler');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/drawioMobileFileView.test.ts`
Expected: FAIL — `Cannot find module '../src/preview/DrawioMobileFileView'`.

- [ ] **Step 4: Implement `DrawioMobileFileView`**

Create `src/preview/DrawioMobileFileView.ts`:

```ts
import { TextFileView, WorkspaceLeaf } from 'obsidian';
import { DRAWIO_VIEW_TYPE } from '../constants';
import { renderPreview } from './ViewerRenderer';
import type DrawioPlugin from '../main';

/**
 * Read-only view for `.drawio` files on mobile: a fixed banner plus the
 * diagram rendered via the same renderPreview used by code blocks and
 * embeds. No iframe, no editor — mobile has no local server, and the
 * online/custom iframe editor path isn't supported in this phase.
 */
export class DrawioMobileFileView extends TextFileView {
  constructor(leaf: WorkspaceLeaf, private plugin: DrawioPlugin) {
    super(leaf);
    this.data = '';
  }

  getViewType(): string { return DRAWIO_VIEW_TYPE; }
  getIcon(): string { return 'pencil-ruler'; }
  getViewData(): string { return this.data; }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    this.render();
  }

  clear(): void {
    this.data = '';
    this.contentEl.empty();
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass('drawio-mobile-file-view');
    c.createDiv({
      cls: 'drawio-mobile-banner',
      text: 'Drawio: preview only on mobile — open this file on desktop to edit.',
    });
    const preview = c.createDiv({ cls: 'drawio-preview' });
    renderPreview(preview, this.data, this.plugin.previewOpts());
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/drawioMobileFileView.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
git add src/preview/DrawioMobileFileView.ts tests/obsidian-stub.ts tests/drawioMobileFileView.test.ts
git commit -m "feat: add read-only DrawioMobileFileView for standalone .drawio files on mobile"
```

---

### Task 2: `registerDesktopFeatures` — extract the desktop-only registration

**Files:**
- Create: `src/desktop/registerDesktopFeatures.ts`
- Modify: `tests/obsidian-stub.ts` (add `FileSystemAdapter`)
- Test: `tests/registerDesktopFeatures.test.ts`

**Interfaces:**
- Consumes: `ServerManager` from `src/server/ServerManager.ts` (existing, unchanged); `createNewDiagram(plugin, folder?)` from `src/file/createDiagram.ts` (existing, unchanged); `DrawioPlugin.server: ServerManager | null` (Task 3 changes this field's type — this task writes to it as if already nullable-typed; Task 3 makes that type change in the same class this task's function targets).
- Produces: `export async function registerDesktopFeatures(plugin: DrawioPlugin): Promise<void>` — Task 3's `main.ts` dynamically imports and calls this.

- [ ] **Step 1: Add a minimal `FileSystemAdapter` stub**

Add to `tests/obsidian-stub.ts`, after `TextFileView`:

```ts
export class FileSystemAdapter {
  getBasePath(): string { return ''; }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/registerDesktopFeatures.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { FileSystemAdapter } from 'obsidian';
import { registerDesktopFeatures } from '../src/desktop/registerDesktopFeatures';
import type DrawioPlugin from '../src/main';

class FakeAdapter extends FileSystemAdapter {
  getBasePath(): string { return '/vault'; }
}

function fakePlugin() {
  const workspaceOn = vi.fn(() => ({}));
  const raw = {
    app: {
      vault: { adapter: new FakeAdapter() },
      workspace: { on: workspaceOn },
    },
    manifest: { dir: 'drawio-editor' },
    settings: { serverPortMin: 3000, serverPortMax: 3999, serverIdleTimeout: 300 },
    server: null as unknown,
    register: vi.fn(),
    addCommand: vi.fn(),
    addRibbonIcon: vi.fn(),
    registerEvent: vi.fn(),
  };
  return { plugin: raw as unknown as DrawioPlugin, raw, workspaceOn };
}

describe('registerDesktopFeatures', () => {
  it('builds and assigns a ServerManager to plugin.server, and registers its teardown', async () => {
    const { plugin, raw } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(raw.server).not.toBeNull();
    expect(raw.register).toHaveBeenCalledTimes(1);
  });

  it('registers the create-drawio-file command', async () => {
    const { plugin, raw } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(raw.addCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'create-drawio-file', name: 'Create new diagram' }),
    );
  });

  it('adds the ribbon icon', async () => {
    const { plugin, raw } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(raw.addRibbonIcon).toHaveBeenCalledWith(
      'workflow', 'Create new drawio diagram', expect.any(Function),
    );
  });

  it('registers a file-menu handler for the folder context menu', async () => {
    const { plugin, raw, workspaceOn } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(raw.registerEvent).toHaveBeenCalledTimes(1);
    expect(workspaceOn).toHaveBeenCalledWith('file-menu', expect.any(Function));
  });

  it('throws if the vault adapter is not a FileSystemAdapter', async () => {
    const { plugin, raw } = fakePlugin();
    (raw.app as { vault: { adapter: unknown } }).vault.adapter = {};
    await expect(registerDesktopFeatures(plugin)).rejects.toThrow(/desktop \(FileSystem\) vault/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/registerDesktopFeatures.test.ts`
Expected: FAIL — `Cannot find module '../src/desktop/registerDesktopFeatures'`.

- [ ] **Step 4: Implement `registerDesktopFeatures`**

Create `src/desktop/registerDesktopFeatures.ts`:

```ts
import { FileSystemAdapter, TFolder } from 'obsidian';
import { join } from 'node:path';
import { ServerManager } from '../server/ServerManager';
import { createNewDiagram } from '../file/createDiagram';
import type DrawioPlugin from '../main';

/**
 * Registers everything that only makes sense — and only works — on desktop:
 * the local drawio server, the ribbon icon, the "Create new diagram" command,
 * and the folder-context-menu item. Only reached through the
 * `Platform.isDesktopApp` gate in main.ts's `onload()` (via
 * `maybeRegisterDesktopFeatures`), so this file — and anything it statically
 * imports, like `ServerManager` and its own `node:http`/`node:fs`/`node:path`
 * imports — is never loaded on mobile.
 */
export async function registerDesktopFeatures(plugin: DrawioPlugin): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    throw new Error('Drawio plugin requires a desktop (FileSystem) vault');
  }
  const webappDir = join(adapter.getBasePath(), plugin.manifest.dir ?? '', 'webapp');
  plugin.server = new ServerManager(webappDir, {
    min: plugin.settings.serverPortMin,
    max: plugin.settings.serverPortMax,
    idleMs: plugin.settings.serverIdleTimeout * 1000,
  });
  plugin.register(() => plugin.server?.stop());

  plugin.addCommand({
    id: 'create-drawio-file',
    name: 'Create new diagram',
    callback: () => { void createNewDiagram(plugin); },
  });

  plugin.addRibbonIcon('workflow', 'Create new drawio diagram', () => {
    void createNewDiagram(plugin);
  });

  // "New drawio diagram" on folder context menus, creating in that folder.
  plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
    if (file instanceof TFolder) {
      menu.addItem((item) => item
        .setTitle('New drawio diagram')
        .setIcon('workflow')
        .onClick(() => { void createNewDiagram(plugin, file); }));
    }
  }));
}
```

Note: this duplicates the `join(adapter.getBasePath(), manifest.dir ?? '')` logic that `main.ts`'s `pluginDir()` also computes (Task 3 makes `pluginDir()` async for its own, different reason). This is deliberate, small duplication — it keeps `registerDesktopFeatures.ts` self-contained and independently readable, rather than threading a dependency back into `main.ts` for two lines of logic.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/registerDesktopFeatures.test.ts`
Expected: PASS (5/5).

- [ ] **Step 6: Commit**

```bash
git add src/desktop/registerDesktopFeatures.ts tests/obsidian-stub.ts tests/registerDesktopFeatures.test.ts
git commit -m "feat: extract desktop-only registration into registerDesktopFeatures"
```

---

### Task 3: Wire `main.ts` — Platform gate, dynamic imports, `isDesktopOnly: false`

**Files:**
- Modify: `main.ts` is at `src/main.ts` — see exact replacement below (whole-file rewrite of the changed regions).
- Modify: `manifest.json`
- Modify: `tests/obsidian-stub.ts` (add `Plugin`, `Modal`, `Platform`)
- Test: `tests/main.test.ts`

**Interfaces:**
- Consumes: `registerDesktopFeatures` from Task 2 (`src/desktop/registerDesktopFeatures.ts`); `DrawioMobileFileView` from Task 1 (`src/preview/DrawioMobileFileView.ts`); existing `DrawioFileView` from `src/file/DrawioFileView.ts` (unchanged).
- Produces: `export async function maybeRegisterDesktopFeatures(plugin: DrawioPlugin): Promise<void>` from `src/main.ts` — a standalone, unit-testable wrapper around the `Platform.isDesktopApp` gate. `DrawioPlugin.server` becomes `ServerManager | null` (was `ServerManager` via definite-assignment assertion) — any later task reading `plugin.server` must handle `null`.

- [ ] **Step 1: Add `Plugin`, `Modal`, and `Platform` stubs**

`main.ts` statically imports `DrawioModal` (from `src/editor/DrawioModal.ts`, which extends Obsidian's `Modal`), and `DrawioPlugin` itself extends `Plugin`. Merely *importing* `src/main.ts` in a test evaluates both class declarations, so both base classes must exist in the stub even though this task's test never calls their methods. Add to `tests/obsidian-stub.ts`, after `FileSystemAdapter`:

```ts
export class Plugin {
  constructor(_app: unknown, _manifest: unknown) {}
}

export class Modal {
  constructor(_app: unknown) {}
}

export const Platform = {
  isDesktopApp: true,
  isMobileApp: false,
  isMobile: false,
  isPhone: false,
  isTablet: false,
};
```

- [ ] **Step 2: Write the failing test**

Create `tests/main.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform } from 'obsidian';

vi.mock('../src/desktop/registerDesktopFeatures', () => ({
  registerDesktopFeatures: vi.fn(async () => {}),
}));

import { maybeRegisterDesktopFeatures } from '../src/main';
import { registerDesktopFeatures } from '../src/desktop/registerDesktopFeatures';
import type DrawioPlugin from '../src/main';

describe('maybeRegisterDesktopFeatures', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => {
    Platform.isDesktopApp = originalIsDesktopApp;
    vi.clearAllMocks();
  });

  it('registers desktop features when Platform.isDesktopApp is true', async () => {
    Platform.isDesktopApp = true;
    const fakePlugin = {} as unknown as DrawioPlugin;
    await maybeRegisterDesktopFeatures(fakePlugin);
    expect(registerDesktopFeatures).toHaveBeenCalledWith(fakePlugin);
  });

  it('does nothing when Platform.isDesktopApp is false', async () => {
    Platform.isDesktopApp = false;
    const fakePlugin = {} as unknown as DrawioPlugin;
    await maybeRegisterDesktopFeatures(fakePlugin);
    expect(registerDesktopFeatures).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/main.test.ts`
Expected: FAIL — `maybeRegisterDesktopFeatures` is not exported from `../src/main` (and/or `Plugin`/`Modal`/`Platform` missing from the stub, if Step 1 wasn't done first — do Step 1 first so the only failure here is the missing export).

- [ ] **Step 4: Rewrite `src/main.ts`**

Replace the full file with:

```ts
import { Plugin, FileSystemAdapter, Notice, Platform, TFolder } from 'obsidian';
import { DrawioSettings, DEFAULT_SETTINGS } from './settings';
import type { ServerManager } from './server/ServerManager';
import { DrawioModal } from './editor/DrawioModal';
import type { DrawioEditorDeps } from './editor/DrawioEditor';
import type { DrawioSource } from './model/DrawioSource';
import type { RenderOptions } from './preview/ViewerRenderer';
import { DRAWIO_VIEW_TYPE, DRAWIO_FILE_EXT, ONLINE_DRAWIO_URL } from './constants';

export default class DrawioPlugin extends Plugin {
  settings!: DrawioSettings;
  server: ServerManager | null = null;
  /** Show the "offline editor missing, using online" notice only once. */
  private warnedOfflineFallback = false;

  async onload() {
    await this.loadSettings();

    const { registerDrawioCodeBlock } = await import('./codeblock/DrawioCodeBlock');
    registerDrawioCodeBlock(this);

    if (Platform.isDesktopApp) {
      const { DrawioFileView } = await import('./file/DrawioFileView');
      this.registerView(DRAWIO_VIEW_TYPE, (leaf) => new DrawioFileView(leaf, this));
    } else {
      const { DrawioMobileFileView } = await import('./preview/DrawioMobileFileView');
      this.registerView(DRAWIO_VIEW_TYPE, (leaf) => new DrawioMobileFileView(leaf, this));
    }
    this.registerExtensions([DRAWIO_FILE_EXT], DRAWIO_VIEW_TYPE);

    const { registerDrawioEmbeds } = await import('./file/EmbedRenderer');
    registerDrawioEmbeds(this);

    await maybeRegisterDesktopFeatures(this);

    const { DrawioSettingTab } = await import('./settingsTab');
    this.addSettingTab(new DrawioSettingTab(this.app, this));
  }

  onunload() {
    // Don't detach the plugin's leaves here: doing so resets the view to its
    // default location on next load, discarding where the user moved it. The
    // local server is stopped via the cleanup registered in onload().
    this.server?.stop();
  }

  /** Absolute path to this plugin's folder on disk. Desktop-only caller
   * (resolveBaseUrl's offline branch) — dynamically imports node:path so this
   * method's own presence in main.ts never triggers an eager require() on
   * mobile. */
  async pluginDir(): Promise<string> {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      const { join } = await import('node:path');
      return join(adapter.getBasePath(), this.manifest.dir ?? '');
    }
    throw new Error('Drawio plugin requires a desktop (FileSystem) vault');
  }

  async resolveBaseUrl(): Promise<string> {
    const mode = this.settings.drawioMode;
    if (mode === 'custom' && this.settings.customDrawioUrl) {
      return this.settings.customDrawioUrl;
    }
    if (mode === 'offline') {
      const { join } = await import('node:path');
      const { existsSync } = await import('node:fs');
      const indexPath = join(await this.pluginDir(), 'webapp', 'index.html');
      if (existsSync(indexPath)) {
        const port = await this.server!.ensureStarted();
        this.server!.touch();
        return `http://127.0.0.1:${port}/index.html`;
      }
      // No bundled webapp (e.g. a community-store install, where the ~145 MB
      // webapp can't ship). Fall back to the online editor so it still works.
      if (!this.warnedOfflineFallback) {
        this.warnedOfflineFallback = true;
        new Notice(
          'Drawio: the bundled offline editor isn\'t installed — using the online editor (diagrams.net). See the README to enable the offline editor.',
          8000,
        );
      }
      return ONLINE_DRAWIO_URL;
    }
    // 'online' (and 'custom' with no URL set) → the hosted diagrams.net embed.
    return ONLINE_DRAWIO_URL;
  }

  isDark(): boolean {
    return activeDocument.body.hasClass('theme-dark');
  }

  /** Options for every preview render (code blocks and embeds). */
  previewOpts(): RenderOptions {
    return {
      dark: this.settings.followObsidianTheme && this.isDark(),
      align: this.settings.previewAlignment,
    };
  }

  /** Shared deps for any DrawioEditor surface (modal or inline file view).
   * Only ever consumed by desktop-only entry points (see Global Constraints). */
  editorDeps(): DrawioEditorDeps {
    return {
      resolveBaseUrl: () => this.resolveBaseUrl(),
      isDark: () => this.settings.followObsidianTheme && this.isDark(),
      showLibraries: () => this.settings.showLibraries,
      acquireServer: () => this.server!.acquire(),
      releaseServer: () => this.server!.release(),
    };
  }

  openEditor(source: DrawioSource) {
    new DrawioModal(this.app, source, this.editorDeps()).open();
  }

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<DrawioSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Apply a changed idle-timeout setting without tearing down a running
   * server — an open editor may hold a live connection to it. */
  updateServerIdleTimeout() {
    this.server?.setIdleMs(this.settings.serverIdleTimeout * 1000);
  }
}

/** Dynamically load and run desktop-only registration (local server, ribbon,
 * command, folder-context-menu) — skipped entirely on mobile, so nothing in
 * `./desktop/registerDesktopFeatures` (or its ServerManager/node:http/node:fs
 * /node:path imports) is ever reached there. Exported standalone so the
 * platform gate is unit-testable without a full Plugin instance. */
export async function maybeRegisterDesktopFeatures(plugin: DrawioPlugin): Promise<void> {
  if (!Platform.isDesktopApp) return;
  const { registerDesktopFeatures } = await import('./desktop/registerDesktopFeatures');
  await registerDesktopFeatures(plugin);
}
```

Notable changes from the current file: removed the top-level `import { join } from 'node:path'` / `import { existsSync } from 'node:fs'` / `import { ServerManager } from './server/ServerManager'` (the last becomes `import type`); added `Platform` to the `obsidian` import; `server` field is now `ServerManager | null = null`; `pluginDir()` is now `async`; `resolveBaseUrl()`'s offline branch dynamically imports `node:path`/`node:fs` and uses `this.server!` (non-null: only reachable once `registerDesktopFeatures` has run, which only happens on desktop); `editorDeps()` uses `this.server!` for the same reason; `updateServerIdleTimeout()` uses `this.server?.`; the `buildServer()` private method, the `create-drawio-file` command, the ribbon icon, and the folder-context-menu registration are all removed from `onload()` (they moved to `registerDesktopFeatures`, Task 2) and replaced by the one `await maybeRegisterDesktopFeatures(this);` call; `registerView` now branches on `Platform.isDesktopApp`.

- [ ] **Step 5: Update `manifest.json`**

Change:
```json
  "isDesktopOnly": true
```
to:
```json
  "isDesktopOnly": false
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/main.test.ts`
Expected: PASS (2/2).

- [ ] **Step 7: Run the full suite and type-check**

Run: `npm test`
Expected: all test files pass (no regressions in existing suites).

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts manifest.json tests/obsidian-stub.ts tests/main.test.ts
git commit -m "fix: gate desktop-only registration behind Platform.isDesktopApp, flip isDesktopOnly"
```

---

### Task 4: `settingsTab.ts` — hide desktop-only rows on mobile

**Files:**
- Modify: `src/settingsTab.ts`
- Modify: `tests/obsidian-stub.ts` (add `Setting`, `PluginSettingTab`)
- Test: `tests/settingsTab.test.ts`

**Interfaces:**
- Consumes: `Platform.isDesktopApp` (from Task 3's stub addition; already real in `obsidian`).
- Produces: none consumed by later tasks.

- [ ] **Step 1: Add `Setting` and `PluginSettingTab` stubs**

Add to `tests/obsidian-stub.ts`, after `Platform`:

```ts
export class PluginSettingTab {
  containerEl: HTMLElement;
  constructor(_app: unknown, _plugin: unknown) {
    this.containerEl = document.createElement('div');
  }
}

class DropdownComponent {
  addOption(_value: string, _label: string): this { return this; }
  setValue(_value: string): this { return this; }
  onChange(_cb: (value: string) => void): this { return this; }
}

class ToggleComponent {
  setValue(_value: boolean): this { return this; }
  onChange(_cb: (value: boolean) => void): this { return this; }
}

class TextComponent {
  inputEl: HTMLInputElement = document.createElement('input');
  setPlaceholder(_p: string): this { return this; }
  setValue(_v: string): this { return this; }
  onChange(_cb: (value: string) => void): this { return this; }
}

export class Setting {
  settingEl: HTMLElement;
  private nameEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement('div');
    this.settingEl.className = 'setting-item';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'setting-item-name';
    this.settingEl.appendChild(this.nameEl);
    containerEl.appendChild(this.settingEl);
  }
  setName(name: string): this { this.nameEl.textContent = name; return this; }
  setDesc(_desc: string): this { return this; }
  addDropdown(cb: (d: DropdownComponent) => unknown): this { cb(new DropdownComponent()); return this; }
  addToggle(cb: (t: ToggleComponent) => unknown): this { cb(new ToggleComponent()); return this; }
  addText(cb: (t: TextComponent) => unknown): this { cb(new TextComponent()); return this; }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/settingsTab.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { DrawioSettingTab } from '../src/settingsTab';
import { DEFAULT_SETTINGS } from '../src/settings';
import type DrawioPlugin from '../src/main';

function fakePlugin(): DrawioPlugin {
  return {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
    updateServerIdleTimeout: () => {},
  } as unknown as DrawioPlugin;
}

function rowNames(containerEl: HTMLElement): (string | null)[] {
  return Array.from(containerEl.querySelectorAll('.setting-item-name')).map((n) => n.textContent);
}

describe('DrawioSettingTab', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  it('shows the editor-only rows on desktop', () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin());
    tab.display();
    const names = rowNames(tab.containerEl);
    expect(names).toContain('Editor source');
    expect(names).toContain('Server idle timeout (seconds)');
    expect(names).toContain('Show shape libraries');
    expect(names).toContain('New diagram location');
  });

  it('hides the editor-only rows on mobile, keeps preview/theme rows', () => {
    Platform.isDesktopApp = false;
    const tab = new DrawioSettingTab({} as never, fakePlugin());
    tab.display();
    const names = rowNames(tab.containerEl);
    expect(names).not.toContain('Editor source');
    expect(names).not.toContain('Custom drawio URL');
    expect(names).not.toContain('Server idle timeout (seconds)');
    expect(names).not.toContain('Show shape libraries');
    expect(names).not.toContain('New diagram location');
    expect(names).not.toContain('New diagram folder');
    expect(names).toContain('Preview alignment');
    expect(names).toContain('Follow Obsidian theme');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/settingsTab.test.ts`
Expected: FAIL on the mobile-hides-rows assertion (all rows currently always render).

- [ ] **Step 4: Wrap the desktop-only rows**

Replace `src/settingsTab.ts`'s `display()` method body with:

```ts
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = () => { void this.plugin.saveSettings(); };

    if (Platform.isDesktopApp) {
      new Setting(containerEl)
        .setName('Editor source')
        .setDesc(
          'Offline (default) uses the bundled editor served locally — fully offline, no network. ' +
          'Online loads the editor from diagrams.net. Or point at a custom embed URL. If Offline is ' +
          "selected but the bundled webapp isn't installed, the online editor is used automatically.",
        )
        .addDropdown((d) => d
          .addOption('online', 'Online (diagrams.net)')
          .addOption('offline', 'Offline (bundled webapp)')
          .addOption('custom', 'Custom URL')
          .setValue(s.drawioMode)
          .onChange((v) => { s.drawioMode = v as DrawioMode; save(); this.display(); }));

      // Privacy note shown only in Online mode.
      if (s.drawioMode === 'online') {
        new Setting(containerEl).setDesc(
          'The editor UI is loaded from diagrams.net. Your diagram content stays in the browser and ' +
          'is not uploaded; only the editor assets are fetched over the network.',
        );
      }

      // Custom embed URL, only relevant in Custom mode.
      if (s.drawioMode === 'custom') {
        new Setting(containerEl)
          .setName('Custom drawio URL')
          .setDesc('Embed URL, e.g. https://embed.diagrams.net/')
          .addText((t) => t
            .setPlaceholder('https://embed.diagrams.net/')
            .setValue(s.customDrawioUrl)
            .onChange((v) => { s.customDrawioUrl = v; save(); }));
      }

      new Setting(containerEl)
        .setName('New diagram location')
        .setDesc(
          'Where the command and the ribbon button create new diagrams. The folder context menu ' +
          'always creates in the clicked folder.',
        )
        .addDropdown((d) => d
          .addOption('root', 'Vault root')
          .addOption('current', 'Same folder as current note')
          .addOption('folder', 'Folder specified below')
          .setValue(s.newDiagramLocation)
          .onChange((v) => { s.newDiagramLocation = v as NewDiagramLocation; save(); this.display(); }));

      // Target folder, only relevant when the location is a fixed folder.
      if (s.newDiagramLocation === 'folder') {
        new Setting(containerEl)
          .setName('New diagram folder')
          .setDesc("Created automatically if it doesn't exist.")
          .addText((t) => t
            .setPlaceholder('Diagrams/drawio')
            .setValue(s.newDiagramFolder)
            .onChange((v) => { s.newDiagramFolder = v; save(); }));
      }
    }

    new Setting(containerEl)
      .setName('Preview alignment')
      .setDesc('How rendered previews (embeds and code blocks) are aligned. Applies when a note is re-rendered.')
      .addDropdown((d) => d
        .addOption('center', 'Center')
        .addOption('left', 'Left')
        .setValue(s.previewAlignment)
        .onChange((v) => { s.previewAlignment = v as PreviewAlignment; save(); }));

    new Setting(containerEl)
      .setName('Follow Obsidian theme')
      .addToggle((t) => t
        .setValue(s.followObsidianTheme)
        .onChange((v) => { s.followObsidianTheme = v; save(); }));

    if (Platform.isDesktopApp) {
      new Setting(containerEl)
        .setName('Show shape libraries')
        .addToggle((t) => t
          .setValue(s.showLibraries)
          .onChange((v) => { s.showLibraries = v; save(); }));

      new Setting(containerEl)
        .setName('Server idle timeout (seconds)')
        .setDesc('Stop the local drawio server after this idle period (minimum 5). Only used in Offline mode.')
        .addText((t) => {
          t.inputEl.type = 'number';
          t.inputEl.min = '5';
          t.setValue(String(s.serverIdleTimeout))
            .onChange((raw) => {
              // Ignore invalid/too-small input so the last good value is kept; the
              // change only takes effect (and restarts the server) once valid.
              const v = Number(raw);
              if (!Number.isFinite(v) || v < 5) return;
              s.serverIdleTimeout = v;
              save();
              this.plugin.updateServerIdleTimeout();
            });
        });
    }
  }
```

Also add `Platform` to the file's import line:
```ts
import { App, Platform, PluginSettingTab, Setting } from 'obsidian';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/settingsTab.test.ts`
Expected: PASS (2/2).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all test files pass.

- [ ] **Step 7: Commit**

```bash
git add src/settingsTab.ts tests/obsidian-stub.ts tests/settingsTab.test.ts
git commit -m "fix: hide desktop-only settings rows on mobile"
```

---

### Task 5: Code blocks and embeds — Notice instead of opening the editor on mobile

**Files:**
- Modify: `src/codeblock/DrawioCodeBlock.ts`
- Modify: `src/file/EmbedRenderer.ts`
- Modify: `tests/obsidian-stub.ts` (add `MarkdownRenderChild`)
- Test: `tests/drawioCodeBlockMobile.test.ts`
- Test: `tests/embedRendererMobile.test.ts`

**Interfaces:**
- Consumes: `Platform.isDesktopApp` (existing stub from Task 3).
- Produces: none consumed by later tasks.

- [ ] **Step 1: Add a minimal `MarkdownRenderChild` stub**

`EmbedRenderer.ts`'s `DrawioFileEmbed` class extends `MarkdownRenderChild`, not yet in the stub. Add to `tests/obsidian-stub.ts`, after `Setting`:

```ts
export class MarkdownRenderChild {
  containerEl: HTMLElement;
  constructor(containerEl: HTMLElement) { this.containerEl = containerEl; }
  registerEvent(_ref: unknown): void {}
  onload(): void {}
  onunload(): void {}
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/drawioCodeBlockMobile.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { registerDrawioCodeBlock } from '../src/codeblock/DrawioCodeBlock';
import type DrawioPlugin from '../src/main';

type Processor = (source: string, el: HTMLElement, ctx: unknown) => void;

function fakePlugin(openEditor: DrawioPlugin['openEditor']) {
  let processor: Processor | undefined;
  const raw = {
    app: {},
    previewOpts: () => ({ dark: false, align: 'center' as const }),
    openEditor,
    registerMarkdownCodeBlockProcessor: (_lang: string, cb: Processor) => { processor = cb; },
  };
  return {
    plugin: raw as unknown as DrawioPlugin,
    run: (source: string, el: HTMLElement, ctx: unknown) => processor!(source, el, ctx),
  };
}

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel/></diagram></mxfile>';

describe('drawio code block — mobile click behavior', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  it('opens the editor on click and shows the edit hint on desktop', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor);
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.drawio-edit-hint')).not.toBeNull();
  });

  it('shows a Notice instead of opening the editor on mobile, with no edit hint', () => {
    Platform.isDesktopApp = false;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor);
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(el.querySelector('.drawio-edit-hint')).toBeNull();
  });
});
```

Create `tests/embedRendererMobile.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform, TFile } from 'obsidian';
import { registerDrawioEmbeds } from '../src/file/EmbedRenderer';
import type DrawioPlugin from '../src/main';

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel/></diagram></mxfile>';

type Creator = (ctx: { containerEl: HTMLElement }, file: TFile, subpath?: string) => { loadFile: () => Promise<void> };

function fakePlugin(openEditor: DrawioPlugin['openEditor']) {
  let creator: Creator | undefined;
  const file = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
  const raw = {
    app: {
      embedRegistry: {
        registerExtension: (_ext: string, c: Creator) => { creator = c; },
      },
      vault: { read: async () => XML, on: vi.fn(() => ({})) },
    },
    previewOpts: () => ({ dark: false, align: 'center' as const }),
    openEditor,
    register: vi.fn(),
  };
  return {
    plugin: raw as unknown as DrawioPlugin,
    create: (containerEl: HTMLElement) => creator!({ containerEl }, file, undefined),
  };
}

describe('drawio embed — mobile click behavior', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  it('opens the editor on click and shows the edit hint on desktop', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, create } = fakePlugin(openEditor);
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();
    containerEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(containerEl.querySelector('.drawio-edit-hint')).not.toBeNull();
  });

  it('shows a Notice instead of opening the editor on mobile, with no edit hint', async () => {
    Platform.isDesktopApp = false;
    const openEditor = vi.fn();
    const { plugin, create } = fakePlugin(openEditor);
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();
    containerEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(containerEl.querySelector('.drawio-edit-hint')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/drawioCodeBlockMobile.test.ts tests/embedRendererMobile.test.ts`
Expected: FAIL on the mobile assertions (both currently always call `openEditor` and always add the edit hint).

- [ ] **Step 4: Gate `DrawioCodeBlock.ts`**

Replace `src/codeblock/DrawioCodeBlock.ts`'s imports and `renderCodeBlock` function:

```ts
import { MarkdownPostProcessorContext, Notice, Platform } from 'obsidian';
import { renderPreview } from '../preview/ViewerRenderer';
import { renderPageControl } from '../preview/pageControl';
import { addEditHint } from '../preview/editHint';
import { getDiagramPages, ensureMxfile } from '../model/xmlUtils';
import { CodeBlockSource } from './CodeBlockSource';
import type DrawioPlugin from '../main';

export function registerDrawioCodeBlock(plugin: DrawioPlugin) {
  plugin.registerMarkdownCodeBlockProcessor('drawio', (source, el, ctx) => {
    renderCodeBlock(plugin, source, el, ctx);
  });
}

function renderCodeBlock(
  plugin: DrawioPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
) {
  const wrapper = el.createDiv({ cls: 'drawio-codeblock' });
  wrapper.setAttribute('title', Platform.isDesktopApp ? 'Click to edit diagram' : 'Drawio diagram');
  const preview = wrapper.createDiv({ cls: 'drawio-preview' });

  const wrapped = ensureMxfile(source);
  const pages = getDiagramPages(wrapped);
  let currentPage = 0;
  renderPreview(preview, source, { ...plugin.previewOpts(), page: currentPage });

  if (pages.length > 1) {
    const pageControlEl = wrapper.createDiv({ cls: 'drawio-page-control' });
    renderPageControl(pageControlEl, {
      pages,
      initialPage: currentPage,
      onPageChange: (page) => {
        currentPage = page;
        renderPreview(preview, source, { ...plugin.previewOpts(), page });
      },
    });
  }

  if (Platform.isDesktopApp) {
    addEditHint(wrapper);
  }

  // Click anywhere on the diagram to edit (the centered hint shows on hover).
  // Mobile has no editor in this phase — show a Notice instead.
  wrapper.addEventListener('click', () => {
    if (Platform.isDesktopApp) {
      plugin.openEditor(new CodeBlockSource(plugin.app, ctx, el, source));
    } else {
      new Notice('Drawio: editing is only available on desktop');
    }
  });
}
```

- [ ] **Step 5: Gate `EmbedRenderer.ts`**

Change the `obsidian` import line to add `Notice` and `Platform`:
```ts
import { MarkdownPostProcessorContext, MarkdownRenderChild, Notice, Platform, TFile } from 'obsidian';
```

In `DrawioFileEmbed.render()`, change the `title` line and the `addEditHint`/click-handler section:

```ts
  private async render(): Promise<void> {
    const el = this.containerEl;
    el.empty();
    el.addClass('drawio-embed');
    el.setAttribute('title', Platform.isDesktopApp ? 'Click to edit diagram' : 'Drawio diagram');
    try {
      const xml = await this.plugin.app.vault.read(this.file);
      const wrapped = ensureMxfile(xml);
      const pages = getDiagramPages(wrapped);

      if (!this.pageResolvedFromSubpath) {
        this.pageResolvedFromSubpath = true;
        this.currentPage = resolvePageFromSubpath(pages, this.subpath);
      } else {
        // A modify-triggered refresh: keep whatever page the user was looking
        // at, clamped in case the page count shrank.
        this.currentPage = Math.min(this.currentPage, Math.max(pages.length - 1, 0));
      }

      const preview = el.createDiv({ cls: 'drawio-preview' });
      renderPreview(preview, xml, { ...this.plugin.previewOpts(), page: this.currentPage });

      if (pages.length > 1) {
        const pageControlEl = el.createDiv({ cls: 'drawio-page-control' });
        renderPageControl(pageControlEl, {
          pages,
          initialPage: this.currentPage,
          onPageChange: (page) => {
            this.currentPage = page;
            renderPreview(preview, xml, { ...this.plugin.previewOpts(), page });
          },
        });
      }

      if (Platform.isDesktopApp) {
        addEditHint(el);
      }
    } catch (err) {
      el.createDiv({ cls: 'drawio-error', text: `Failed to render diagram: ${String(err)}` });
    }
    // Wire click-to-edit once (survives re-renders; el.empty() keeps the listener).
    if (!el.dataset.drawioClick) {
      el.dataset.drawioClick = '1';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (Platform.isDesktopApp) {
          this.plugin.openEditor(new FileSource(this.plugin.app, this.file));
        } else {
          new Notice('Drawio: editing is only available on desktop');
        }
      });
    }
  }
```

In `registerEmbedPostProcessor`, change the `title` line and click handler:

```ts
function registerEmbedPostProcessor(plugin: DrawioPlugin) {
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    for (const span of Array.from(el.querySelectorAll<HTMLElement>('.internal-embed'))) {
      if (span.dataset.drawioEmbed === '1') continue;
      const rawSrc = span.getAttribute('src');
      if (!rawSrc) continue;
      const hashIndex = rawSrc.indexOf('#');
      const path = hashIndex === -1 ? rawSrc : rawSrc.slice(0, hashIndex);
      const subpath = hashIndex === -1 ? undefined : rawSrc.slice(hashIndex + 1);
      if (!path.toLowerCase().endsWith('.' + DRAWIO_FILE_EXT)) continue;
      const file = plugin.app.metadataCache.getFirstLinkpathDest(path, ctx.sourcePath);
      if (!(file instanceof TFile)) continue;
      span.dataset.drawioEmbed = '1';
      span.setAttribute('title', Platform.isDesktopApp ? 'Click to edit diagram' : 'Drawio diagram');
      span.addEventListener('click', () => {
        if (Platform.isDesktopApp) {
          plugin.openEditor(new FileSource(plugin.app, file));
        } else {
          new Notice('Drawio: editing is only available on desktop');
        }
      });
      void renderEmbedInto(plugin, span, file, subpath);
    }
  });
}
```

In `renderEmbedInto`, gate the `addEditHint` call:

```ts
async function renderEmbedInto(
  plugin: DrawioPlugin,
  span: HTMLElement,
  file: TFile,
  subpath?: string,
) {
  span.empty();
  span.addClass('drawio-embed');
  span.removeClasses(['file-embed', 'mod-generic', 'is-loaded']);
  try {
    const xml = await plugin.app.vault.read(file);
    const wrapped = ensureMxfile(xml);
    const pages = getDiagramPages(wrapped);
    const currentPage = resolvePageFromSubpath(pages, subpath);

    const preview = span.createDiv({ cls: 'drawio-preview' });
    renderPreview(preview, xml, { ...plugin.previewOpts(), page: currentPage });

    if (pages.length > 1) {
      const pageControlEl = span.createDiv({ cls: 'drawio-page-control' });
      renderPageControl(pageControlEl, {
        pages,
        initialPage: currentPage,
        onPageChange: (page) => {
          renderPreview(preview, xml, { ...plugin.previewOpts(), page });
        },
      });
    }

    if (Platform.isDesktopApp) {
      addEditHint(span);
    }
  } catch (err) {
    span.empty();
    span.createDiv({ cls: 'drawio-error', text: `Failed to render diagram: ${String(err)}` });
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/drawioCodeBlockMobile.test.ts tests/embedRendererMobile.test.ts`
Expected: PASS (4/4).

- [ ] **Step 7: Run the full suite and type-check**

Run: `npm test`
Expected: all test files pass.

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/codeblock/DrawioCodeBlock.ts src/file/EmbedRenderer.ts tests/obsidian-stub.ts tests/drawioCodeBlockMobile.test.ts tests/embedRendererMobile.test.ts
git commit -m "fix: show a Notice instead of opening the editor on mobile clicks"
```

---

### Task 6: Documentation and final verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:** none — documentation only, plus a final full-repo verification pass.

- [ ] **Step 1: Update CLAUDE.md's opening description**

Find this line near the top, under "## What this is":
```
An Obsidian **desktop-only** plugin that embeds, previews, and edits
[draw.io](https://www.drawio.com/) (diagrams.net) diagrams. Plugin **id is
`drawio-editor`** (the bare `drawio` id is reserved — do not change it back).
```

Replace with:
```
An Obsidian plugin that embeds, previews, and edits
[draw.io](https://www.drawio.com/) (diagrams.net) diagrams. Plugin **id is
`drawio-editor`** (the bare `drawio` id is reserved — do not change it back).
**Editing is desktop-only** (it needs the iframe-based drawio embed app, the
local Node server, or a network connection); **mobile (phone/tablet) gets
preview only** — code blocks, embeds, and a read-only view for standalone
`.drawio` files. See `src/desktop/registerDesktopFeatures.ts` and the
"Mobile support" entry below.
```

- [ ] **Step 2: Add a new "Non-obvious decisions" entry**

Find the start of the "## Non-obvious decisions — DO NOT casually revert" section (the first bullet is about indirect eval in `loadViewer.ts`). Insert this new bullet immediately after that section's heading, before the existing first bullet:

```
- **Mobile support (`isDesktopOnly: false`)**: `main.ts` and `ServerManager.ts`
  used to have top-level static imports of `node:http`/`node:fs`/`node:path`.
  esbuild marks Node built-ins as `external` (`esbuild.config.mjs`), so a
  static top-level import compiles to an unconditional, module-load-time
  `require(...)` call — which throws immediately on mobile (no Node runtime),
  crashing the *entire plugin load* before `onload()` even runs. Fixed by
  never letting a `node:*`/`electron` import be *static and top-level* outside
  `src/server/**` or `src/desktop/**` — both are only ever reached through the
  one `Platform.isDesktopApp`-gated dynamic import in `main.ts`'s
  `maybeRegisterDesktopFeatures()`. A dynamic `await import(...)` at the point
  of use (e.g. `main.ts`'s `pluginDir()`/`resolveBaseUrl()`) is fine anywhere,
  since it's never eagerly evaluated — only a *static* top-level import gets
  hoisted and unconditionally `require()`d. **If you add a new Node/Electron
  API call anywhere outside those two directories, use a dynamic import at
  the call site — never a top-level static import** — or you will silently
  reintroduce the mobile load-time crash. `Platform` itself
  (`isDesktopApp`/`isMobile`/`isPhone`/`isTablet`) is `@since 0.12.2`, long
  publicly released — no `minAppVersion` concern.
```

- [ ] **Step 3: Add a checklist entry**

Find the "## Checklist: before shipping any change" section's "**New Obsidian API call you haven't used in this repo before:**" subsection. After its last bullet (the one about reproducing findings locally), add a new subsection:

```

**Anything that imports a Node built-in (`node:*`) or `electron`:**
- [ ] Never a *static, top-level* `import ... from 'node:...'` (or `'electron'`)
  outside `src/server/**` or `src/desktop/**` — esbuild's `external` config
  (`esbuild.config.mjs`) leaves these as unconditional `require(...)` calls in
  the bundled `main.js`, which crashes the entire plugin load on mobile
  (no Node runtime) before `onload()` runs.
- [ ] If the call site is outside those two directories (e.g. a method on
  `DrawioPlugin` in `main.ts`), use a dynamic `await import('node:...')`
  *inside* the function body, at the point of use — never a top-level import.
- [ ] If you're adding a genuinely new desktop-only feature, prefer adding it
  to `src/desktop/registerDesktopFeatures.ts` (or a sibling file there) over
  scattering a new `Platform.isDesktopApp` check somewhere else — keeping the
  boundary in one place is what makes it auditable.
```

- [ ] **Step 4: Update README.md's Requirements section**

Find:
```
## Requirements

- **Desktop only.** The plugin uses Node/Electron APIs (and a local HTTP server for the offline editor), so it does not run on Obsidian mobile.
- **Obsidian 1.4.0 or later.**
```

Replace with:
```
## Requirements

- **Obsidian 1.4.0 or later.**
- **Editing is desktop only** (it needs Node/Electron APIs and, in Offline
  mode, a local HTTP server). **Mobile (phone/tablet) supports preview
  only**: rendered code blocks, embeds, and a read-only view for standalone
  `.drawio` files.
```

- [ ] **Step 5: Replace the stale "Desktop only" note under "Notes & limitations"**

Find this existing bullet (right after "**Multi-page embed subpaths**"):
```
- **Desktop only**: see Requirements above.
```
This is now misleading — it reads as if the whole plugin needs desktop, which is no longer true. Replace it with:
```
- **Mobile support**: on phone/tablet, code blocks, embeds, and standalone
  `.drawio` files all render as read-only previews. Tapping one shows a
  Notice explaining that editing needs desktop — there is no mobile editor in
  this phase. The ribbon icon, "Create new diagram" command, and the folder
  right-click "New drawio diagram" item aren't available on mobile either,
  since their only purpose is opening that editor. See Requirements above for
  what does need desktop.
```

- [ ] **Step 6: Run full verification**

Run: `npm test`
Expected: all test files pass, including every test added in Tasks 1–5.

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors.

Run: `npm run build`
Expected: succeeds, produces `main.js`.

Run (per this repo's documented local lint-repro recipe in CLAUDE.md — install once if not already present):
```bash
npm install --no-save eslint-plugin-obsidianmd typescript-eslint
```
Then create a scratch `eslint.check.config.mjs` (delete after use, do not commit):
```js
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';
export default tseslint.config({
  files: ['src/**/*.ts'],
  languageOptions: { parser: tseslint.parser, parserOptions: {
    project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } },
  plugins: { obsidianmd },
  rules: { ...obsidianmd.configs.recommended.rules },
});
```
Run: `npx eslint --no-config-lookup -c ./eslint.check.config.mjs src/`
Expected: 0 errors (pre-existing accepted warnings — `display()` deprecation,
`fs` access, dynamic-code-execution recommendations — are fine; no new
findings). Delete `eslint.check.config.mjs` afterward.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document mobile preview support and the Node-import boundary rule"
```

---

## What this plan does not cover (confirmed out of scope, per the design spec)

- Editing on mobile (forcing the online/custom iframe editor mode) — a candidate follow-up project, not part of this plan.
- Real-device verification: the plugin actually installing and loading without crashing on real mobile Obsidian, rendering fidelity/performance in the mobile WebView, touch tap-target sizing for the page-switcher and the edit-Notice, and the Notice's on-device appearance. This project has no way to run or simulate Obsidian mobile — the user verifies these manually on their own device once all six tasks are merged.
