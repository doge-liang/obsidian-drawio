import { FileSystemAdapter, Notice, TFile, TFolder } from 'obsidian';
import { join } from 'node:path';
import { ServerManager } from '../server/ServerManager';
import { createNewDiagram } from '../file/createDiagram';
import { DualFormatFileSource } from '../file/DualFormatFileSource';
import { dualFormatOf } from '../model/dualFormat';
import { exportDiagramToFile, isExportableDiagram } from './exportDiagram';
import { registerDualFormatOpen } from './dualFormatOpen';
import { openMigrateLegacy } from './migrateLegacySvg';
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

  // "New drawio diagram" on folder context menus, creating in that folder;
  // "Edit drawio diagram" on dual-format image files (which open in
  // Obsidian's own image view, so they need an explicit editor entry);
  // "Export diagram as SVG/PNG" on every diagram file.
  plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
    if (file instanceof TFolder) {
      menu.addItem((item) => item
        .setTitle('New drawio diagram')
        .setIcon('workflow')
        .onClick(() => { void createNewDiagram(plugin, file); }));
    } else if (file instanceof TFile) {
      const format = dualFormatOf(file.path);
      if (format) {
        menu.addItem((item) => item
          .setTitle('Edit drawio diagram')
          .setIcon('workflow')
          .onClick(() => {
            plugin.openEditor(new DualFormatFileSource(plugin.app, file, format));
          }));
      }
      if (isExportableDiagram(file)) {
        for (const target of ['svg', 'png'] as const) {
          menu.addItem((item) => item
            .setTitle(`Export diagram as ${target.toUpperCase()}`)
            .setIcon('download')
            .onClick(() => { void exportDiagramToFile(plugin, file, target); }));
        }
      }
    }
  }));

  registerDualFormatOpen(plugin);

  plugin.addCommand({
    id: 'migrate-legacy-diagrams',
    name: 'Migrate diagrams from the old Diagrams plugin',
    callback: () => { void openMigrateLegacy(plugin); },
  });

  plugin.addCommand({
    id: 'edit-dual-format-diagram',
    name: 'Edit diagram in the current image file',
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      const format = file ? dualFormatOf(file.path) : null;
      if (!file || !format) return false;
      if (!checking) plugin.openEditor(new DualFormatFileSource(plugin.app, file, format));
      return true;
    },
  });

  // Plain-image export of the active diagram file (.drawio or dual-format):
  // a standalone .svg/.png — no embedded diagram data — next to the source.
  for (const format of ['svg', 'png'] as const) {
    plugin.addCommand({
      id: `export-diagram-${format}`,
      name: `Export diagram as ${format.toUpperCase()}`,
      checkCallback: (checking) => {
        const file = plugin.app.workspace.getActiveFile();
        if (!file || !isExportableDiagram(file)) return false;
        if (!checking) void exportDiagramToFile(plugin, file, format);
        return true;
      },
    });
  }

  // Lifecycle detection: offline mode selected but the webapp isn't installed.
  // One notice per plugin load — the settings tab carries the actual installer.
  if (plugin.settings.drawioMode === 'offline' && !(await plugin.isWebappInstalled())) {
    new Notice(
      "Drawio: the offline editor isn't installed — open the plugin settings to " +
      'install it, or switch the editor source to Online.',
      10000,
    );
  }
}
