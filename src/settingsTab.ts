import { App, PluginSettingTab, Setting } from 'obsidian';
import type DrawioPlugin from './main';
import type { DrawioMode, NewDiagramLocation, PreviewAlignment } from './settings';

/**
 * Settings tab, rendered with the classic imperative `display()` API.
 *
 * NOTE (compatibility): 0.3.0 briefly used Obsidian's declarative
 * `getSettingDefinitions()` API, but that API — along with `setControlValue`
 * and `refreshDomState` — is `@since 1.13.0`, which at time of writing is only a
 * Catalyst (early-access) build; the latest *public* Obsidian is 1.12.x. To keep
 * the plugin usable on public Obsidian, `minAppVersion` is 1.4.0 and the settings
 * tab uses `display()`, which is the correct (non-deprecated) pattern below
 * 1.13.0. Conditional rows are handled by re-rendering on the gating change.
 */
export class DrawioSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DrawioPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = () => { void this.plugin.saveSettings(); };

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
            this.plugin.rebuildServer();
          });
      });
  }
}
