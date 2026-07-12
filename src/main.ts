import { Plugin, FileSystemAdapter, Platform } from 'obsidian';
import { OfflineEditorNotInstalledError } from './model/errors';
import { InstallStatus } from './model/installStatus';
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
  /** Offline-webapp install state — on the plugin (not the settings tab) so a
   * mid-install settings re-render can re-attach to the running install. */
  webappInstallStatus = new InstallStatus();

  async onload() {
    await this.loadSettings();

    const { registerDrawioCodeBlock } = await import('./codeblock/DrawioCodeBlock');
    registerDrawioCodeBlock(this);

    if (Platform.isDesktopApp) {
      const { DrawioFileView } = await import('./file/DrawioFileView');
      const { DrawioPreviewFileView } = await import('./preview/DrawioPreviewFileView');
      // Decided per leaf creation, so toggling the setting affects newly
      // opened tabs without a plugin reload (already-open tabs keep their view).
      this.registerView(DRAWIO_VIEW_TYPE, (leaf) =>
        this.settings.readonlyFileView
          ? new DrawioPreviewFileView(leaf, this)
          : new DrawioFileView(leaf, this));
    } else {
      const { DrawioPreviewFileView } = await import('./preview/DrawioPreviewFileView');
      this.registerView(DRAWIO_VIEW_TYPE, (leaf) => new DrawioPreviewFileView(leaf, this));
    }
    this.registerExtensions([DRAWIO_FILE_EXT], DRAWIO_VIEW_TYPE);

    const { registerDrawioEmbeds } = await import('./file/EmbedRenderer');
    registerDrawioEmbeds(this);

    // Preview alignment is a body-level class (see styles.css), so flipping
    // the setting realigns already-rendered previews — including ones Obsidian
    // keeps cached and detached — without waiting for a re-render. New popout
    // windows get the class on creation; unload clears it everywhere.
    this.applyPreviewAlignment();
    this.registerEvent(this.app.workspace.on('window-open', (_win, popoutWin) => {
      popoutWin.document.body.classList.toggle(
        'drawio-align-left', this.settings.previewAlignment === 'left');
    }));
    this.register(() => setPreviewAlignmentClass(this, false));

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

  /** Absolute path to this plugin's folder on disk. Desktop-only callers
   * (resolveBaseUrl's offline branch, isWebappInstalled(),
   * installedWebappVersion(), and the settings tab's install flow) —
   * dynamically imports node:path so this method's own presence in main.ts
   * never triggers an eager require() on mobile. */
  async pluginDir(): Promise<string> {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      const path = await import('node:path');
      return path.join(adapter.getBasePath(), this.manifest.dir ?? '');
    }
    throw new Error('Drawio plugin requires a desktop (FileSystem) vault');
  }

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

  isDark(): boolean {
    return activeDocument.body.hasClass('theme-dark');
  }

  /** Options for every preview render (code blocks and embeds). */
  previewOpts(): RenderOptions {
    return {
      dark: this.settings.followObsidianTheme && this.isDark(),
    };
  }

  /** Sync the body-level alignment class with the current setting. */
  applyPreviewAlignment() {
    setPreviewAlignmentClass(this, this.settings.previewAlignment === 'left');
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

/** Toggle the `drawio-align-left` class on every window's body (main window
 * plus any popouts, found via their leaves). Alignment lives on the body so a
 * settings change takes effect on previews Obsidian has already rendered.
 * Exported standalone so it's unit-testable without a full Plugin instance. */
export function setPreviewAlignmentClass(plugin: DrawioPlugin, left: boolean): void {
  const bodies = new Set<HTMLElement>([activeDocument.body]);
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    bodies.add(leaf.view.containerEl.ownerDocument.body);
  });
  for (const body of bodies) body.classList.toggle('drawio-align-left', left);
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
