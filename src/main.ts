import { Plugin, FileSystemAdapter, Notice, TFolder } from 'obsidian';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DrawioSettings, DEFAULT_SETTINGS } from './settings';
import { ServerManager } from './server/ServerManager';
import { DrawioModal } from './editor/DrawioModal';
import type { DrawioEditorDeps } from './editor/DrawioEditor';
import type { DrawioSource } from './model/DrawioSource';
import type { RenderOptions } from './preview/ViewerRenderer';
import { DRAWIO_VIEW_TYPE, DRAWIO_FILE_EXT, ONLINE_DRAWIO_URL } from './constants';

export default class DrawioPlugin extends Plugin {
  settings!: DrawioSettings;
  server!: ServerManager;
  /** Show the "offline editor missing, using online" notice only once. */
  private warnedOfflineFallback = false;

  async onload() {
    await this.loadSettings();
    this.server = this.buildServer();
    this.register(() => this.server.stop());

    const { registerDrawioCodeBlock } = await import('./codeblock/DrawioCodeBlock');
    registerDrawioCodeBlock(this);

    const { DrawioFileView } = await import('./file/DrawioFileView');
    this.registerView(DRAWIO_VIEW_TYPE, (leaf) => new DrawioFileView(leaf, this));
    this.registerExtensions([DRAWIO_FILE_EXT], DRAWIO_VIEW_TYPE);

    const { registerDrawioEmbeds } = await import('./file/EmbedRenderer');
    registerDrawioEmbeds(this);

    const { createNewDiagram } = await import('./file/createDiagram');

    this.addCommand({
      id: 'create-drawio-file',
      name: 'Create new diagram',
      callback: () => { void createNewDiagram(this); },
    });

    this.addRibbonIcon('workflow', 'Create new drawio diagram', () => {
      void createNewDiagram(this);
    });

    // "New drawio diagram" on folder context menus, creating in that folder.
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFolder) {
        menu.addItem((item) => item
          .setTitle('New drawio diagram')
          .setIcon('workflow')
          .onClick(() => { void createNewDiagram(this, file); }));
      }
    }));

    const { DrawioSettingTab } = await import('./settingsTab');
    this.addSettingTab(new DrawioSettingTab(this.app, this));
  }

  onunload() {
    // Don't detach the plugin's leaves here: doing so resets the view to its
    // default location on next load, discarding where the user moved it. The
    // local server is stopped via the cleanup registered in onload().
    this.server?.stop();
  }

  /** Absolute path to this plugin's folder on disk. */
  pluginDir(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
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
      const indexPath = join(this.pluginDir(), 'webapp', 'index.html');
      if (existsSync(indexPath)) {
        const port = await this.server.ensureStarted();
        this.server.touch();
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

  /** Shared deps for any DrawioEditor surface (modal or inline file view). */
  editorDeps(): DrawioEditorDeps {
    return {
      resolveBaseUrl: () => this.resolveBaseUrl(),
      isDark: () => this.settings.followObsidianTheme && this.isDark(),
      showLibraries: () => this.settings.showLibraries,
      acquireServer: () => this.server.acquire(),
      releaseServer: () => this.server.release(),
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

  private buildServer(): ServerManager {
    const webappDir = join(this.pluginDir(), 'webapp');
    return new ServerManager(webappDir, {
      min: this.settings.serverPortMin,
      max: this.settings.serverPortMax,
      idleMs: this.settings.serverIdleTimeout * 1000,
    });
  }

  rebuildServer() {
    this.server.stop();
    this.server = this.buildServer();
  }
}
