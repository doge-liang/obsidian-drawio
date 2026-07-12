import { FileSystemAdapter, Notice, TFolder } from 'obsidian';
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
