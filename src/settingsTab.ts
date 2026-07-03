import { App, PluginSettingTab, Setting } from 'obsidian';
import type { DrawioMode, NewDiagramLocation, PreviewAlignment } from './settings';
import type DrawioPlugin from './main';

export class DrawioSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DrawioPlugin) { super(app, plugin); }

  // Uses display() rather than the declarative getSettingDefinitions() API: the
  // latter requires Obsidian 1.13+, and we keep a low minAppVersion for broad
  // compatibility. (display() is marked deprecated but remains supported.)
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Editor source')
      .setDesc('Offline (default) uses the bundled editor served locally — fully offline, no network. Online loads the editor from diagrams.net. Or point at a custom embed URL. If Offline is selected but the bundled webapp isn\'t installed, the online editor is used automatically.')
      .addDropdown((d) => d
        .addOption('online', 'Online (diagrams.net)')
        .addOption('offline', 'Offline (bundled webapp)')
        .addOption('custom', 'Custom URL')
        .setValue(this.plugin.settings.drawioMode)
        .onChange(async (v) => {
          this.plugin.settings.drawioMode = v as DrawioMode;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.drawioMode === 'online') {
      new Setting(containerEl).setDesc(
        'The editor UI is loaded from diagrams.net. Your diagram content stays in the browser and is not uploaded; only the editor assets are fetched over the network.',
      );
    }

    if (this.plugin.settings.drawioMode === 'custom') {
      new Setting(containerEl)
        .setName('Custom drawio URL')
        .setDesc('Embed URL, e.g. https://embed.diagrams.net/')
        .addText((t) => t
          .setValue(this.plugin.settings.customDrawioUrl)
          .onChange(async (v) => { this.plugin.settings.customDrawioUrl = v.trim(); await this.plugin.saveSettings(); }));
    }

    new Setting(containerEl)
      .setName('New diagram location')
      .setDesc('Where the command and the ribbon button create new diagrams. The folder context menu always creates in the clicked folder.')
      .addDropdown((d) => d
        .addOption('root', 'Vault root')
        .addOption('current', 'Same folder as current note')
        .addOption('folder', 'Folder specified below')
        .setValue(this.plugin.settings.newDiagramLocation)
        .onChange(async (v) => {
          this.plugin.settings.newDiagramLocation = v as NewDiagramLocation;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.newDiagramLocation === 'folder') {
      new Setting(containerEl)
        .setName('New diagram folder')
        .setDesc('Created automatically if it doesn\'t exist, e.g. Diagrams/drawio')
        .addText((t) => t
          .setValue(this.plugin.settings.newDiagramFolder)
          .onChange(async (v) => { this.plugin.settings.newDiagramFolder = v.trim(); await this.plugin.saveSettings(); }));
    }

    new Setting(containerEl)
      .setName('Preview alignment')
      .setDesc('How rendered previews (embeds and code blocks) are aligned. Applies when a note is re-rendered.')
      .addDropdown((d) => d
        .addOption('center', 'Center')
        .addOption('left', 'Left')
        .setValue(this.plugin.settings.previewAlignment)
        .onChange(async (v) => {
          this.plugin.settings.previewAlignment = v as PreviewAlignment;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Follow Obsidian theme')
      .addToggle((t) => t
        .setValue(this.plugin.settings.followObsidianTheme)
        .onChange(async (v) => { this.plugin.settings.followObsidianTheme = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Show shape libraries')
      .addToggle((t) => t
        .setValue(this.plugin.settings.showLibraries)
        .onChange(async (v) => { this.plugin.settings.showLibraries = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Server idle timeout (seconds)')
      .setDesc('Stop the local drawio server after this idle period (minimum 5). Only used in Offline mode.')
      .addText((t) => t
        .setValue(String(this.plugin.settings.serverIdleTimeout))
        .onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 5) {
            this.plugin.settings.serverIdleTimeout = n;
            await this.plugin.saveSettings();
            this.plugin.rebuildServer();
          } else if (v.trim() !== '') {
            // Reject invalid/too-small values: restore the stored value.
            t.setValue(String(this.plugin.settings.serverIdleTimeout));
          }
        }));
  }
}
