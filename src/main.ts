import { Plugin, FileSystemAdapter, MarkdownView, Notice, Platform } from 'obsidian';
import { OfflineEditorNotInstalledError } from './model/errors';
import { InstallStatus } from './model/installStatus';
import {
  findBlockExtraction, findEmbedConversion,
  uniqueDiagramPath, buildBlockReplacementText,
} from './model/blockFileConvert';
import type { BlockExtraction, EmbedConversion } from './model/blockFileConvert';
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

    const { registerDrawioEmbeds, registerDualFormatEmbeds } = await import('./file/EmbedRenderer');
    registerDrawioEmbeds(this);
    // Click-to-edit for dual-format image embeds (self-gates to desktop +
    // Reading view internally, so it's safe to register unconditionally).
    registerDualFormatEmbeds(this);

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

    // Platform-independent (pure text edits + Vault operations), so these are
    // registered here rather than with the desktop-only features.
    registerConvertCommands(this);

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

/** Register the two code-block ↔ .drawio-file conversion commands. Both are
 * check-callbacks: available only in a Markdown editor whose cursor sits in a
 * ```drawio block (extract) / on a line with a `![[….drawio]]` embed
 * (convert). All range math lives in model/blockFileConvert.ts (pure,
 * unit-tested); this layer only touches the editor and the vault. Exported
 * standalone so the wiring is unit-testable without a full Plugin instance. */
export function registerConvertCommands(plugin: DrawioPlugin): void {
  plugin.addCommand({
    id: 'extract-code-block-to-file',
    name: 'Extract diagram code block to file',
    checkCallback: (checking) => {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) return false;
      const plan = findBlockExtraction(view.editor.getValue(), view.editor.getCursor().line);
      if (!plan) return false;
      if (!checking) void extractBlockToFile(plugin, view, plan);
      return true;
    },
  });

  plugin.addCommand({
    id: 'inline-embed-to-code-block',
    name: 'Convert diagram embed to code block',
    checkCallback: (checking) => {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) return false;
      const conv = findEmbedConversion(view.editor.getValue(), view.editor.getCursor().line);
      if (!conv) return false;
      if (!checking) void embedToCodeBlock(plugin, view, conv);
      return true;
    },
  });
}

/** Create `<note basename> diagram[ N].drawio` next to the note from the
 * block's XML, then replace the whole fenced block with an embed of it. */
async function extractBlockToFile(
  plugin: DrawioPlugin, view: MarkdownView, plan: BlockExtraction,
): Promise<void> {
  const noteFile = view.file;
  if (!noteFile) return;
  try {
    const vault = plugin.app.vault;
    // Root files report parent path '/', which must not prefix the new path.
    const parent = noteFile.parent?.path ?? '';
    const folder = parent === '/' ? '' : parent;
    const path = uniqueDiagramPath(folder, noteFile.basename,
      (p) => vault.getAbstractFileByPath(p) !== null);
    const created = await vault.create(path, plan.fileContent);
    // Honors the user's link preferences; prepend the embed `!` if absent.
    const link = plugin.app.fileManager.generateMarkdownLink(created, noteFile.path);
    const embed = link.startsWith('!') ? link : `!${link}`;
    // The note may have shifted during the awaited create — re-locate the
    // block at the planned line and verify it is still the same one before
    // replacing. On mismatch the created file is kept (harmless), only the
    // text edit is skipped.
    const editor = view.editor;
    const fresh = findBlockExtraction(editor.getValue(), plan.range.from.line);
    if (!fresh || fresh.body !== plan.body) {
      new Notice(`Drawio: the note changed — "${created.path}" was created, ` +
        'but the code block was not replaced.');
      return;
    }
    editor.replaceRange(embed, fresh.range.from, fresh.range.to);
  } catch (err) {
    new Notice(`Drawio: could not extract the diagram — ${String(err)}`);
  }
}

/** Replace a `![[….drawio]]` embed with a ```drawio block holding the file's
 * XML. Any `#page` / `|alias` parts are dropped; the file itself is kept. */
async function embedToCodeBlock(
  plugin: DrawioPlugin, view: MarkdownView, conv: EmbedConversion,
): Promise<void> {
  const noteFile = view.file;
  if (!noteFile) return;
  const target = plugin.app.metadataCache.getFirstLinkpathDest(conv.linkpath, noteFile.path);
  if (!target) {
    new Notice(`Drawio: cannot find "${conv.linkpath}" in this vault.`);
    return;
  }
  try {
    const xml = await plugin.app.vault.read(target);
    // Same drift guard as extractBlockToFile: only replace if the line still
    // holds the same embed after the awaited read.
    const editor = view.editor;
    const fresh = findEmbedConversion(editor.getValue(), conv.range.from.line);
    if (!fresh || fresh.linkpath !== conv.linkpath) {
      new Notice('Drawio: the note changed — the embed was not converted.');
      return;
    }
    editor.replaceRange(buildBlockReplacementText(xml, fresh), fresh.range.from, fresh.range.to);
  } catch (err) {
    new Notice(`Drawio: could not convert the embed — ${String(err)}`);
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
