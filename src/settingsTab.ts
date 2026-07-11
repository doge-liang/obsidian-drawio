import { App, ButtonComponent, Platform, PluginSettingTab, Setting } from 'obsidian';
import type DrawioPlugin from './main';
import { DRAWIO_VERSION } from './constants';
import { formatInstallProgress, type WebappInstallState } from './model/installStatus';
import type { DrawioMode, NewDiagramLocation, PreviewAlignment, PreviewClickAction } from './settings';

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

    if (Platform.isDesktopApp) {
      new Setting(containerEl)
        .setName('Editor source')
        .setDesc(
          'Offline (default) uses the bundled editor served locally — fully offline, no network. ' +
          'Online loads the editor from diagrams.net. Or point at a custom embed URL. The offline ' +
          'editor requires a one-time install — see below when Offline is selected.',
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

      // Offline-editor install status + one-click installer.
      if (s.drawioMode === 'offline') {
        this.renderOfflineEditorStatus(containerEl);
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
        .setName('Open diagram files read-only')
        .setDesc(
          'Show a static preview instead of the embedded editor when opening .drawio files. ' +
          'Applies to newly opened tabs. Pair with "Preview click action" below for a ' +
          'drawio-desktop-centred workflow.',
        )
        .addToggle((t) => t
          .setValue(s.readonlyFileView)
          .onChange((v) => { s.readonlyFileView = v; save(); }));

      new Setting(containerEl)
        .setName('Preview click action')
        .setDesc(
          'What clicking a diagram preview does (embeds and read-only file tabs). Code blocks ' +
          'have no underlying file, so they always open the built-in editor unless ' +
          '"Do nothing" is selected.',
        )
        .addDropdown((d) => d
          .addOption('editor', 'Open built-in editor')
          .addOption('defaultApp', 'Open in system default app')
          .addOption('none', 'Do nothing')
          .setValue(s.previewClickAction)
          .onChange((v) => { s.previewClickAction = v as PreviewClickAction; save(); }));
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
      button.removeCta();
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
        if (version && version !== DRAWIO_VERSION) {
          // A plugin update bumped the pinned drawio version; previews already
          // use the new bundled viewer, so nudge the webapp to match. Updating
          // is the same pipeline as installing (always installs the pin).
          setting.setDesc(
            `Installed (drawio ${version}). Update available: this plugin version ` +
            `bundles drawio ${DRAWIO_VERSION}.`,
          );
          button.setButtonText('Update').setCta().setDisabled(false);
        } else {
          setting.setDesc(version ? `Installed (drawio ${version}).` : 'Installed.');
          button.setButtonText('Reinstall').setDisabled(false);
        }
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
}
