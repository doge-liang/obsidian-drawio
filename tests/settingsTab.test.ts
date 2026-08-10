import { describe, it, expect, afterEach, vi } from 'vitest';
import { Platform } from 'obsidian';
import { DrawioSettingTab } from '../src/settingsTab';
import { DEFAULT_SETTINGS } from '../src/settings';
import { DRAWIO_VERSION } from '../src/constants';
import { InstallStatus } from '../src/model/installStatus';
import type DrawioPlugin from '../src/main';

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
    expect(names).toContain('Open diagram files read-only');
    expect(names).toContain('Preview click action');
    expect(names).not.toContain('Edit button action');
  });

  it('shows Edit button action only when Interactive viewer is selected', () => {
    Platform.isDesktopApp = true;
    const plugin = fakePlugin();
    plugin.settings.previewClickAction = 'interactive';
    const tab = new DrawioSettingTab({} as never, plugin);
    tab.display();
    const names = rowNames(tab.containerEl);
    expect(names).toContain('Edit button action');
    expect(names).not.toContain('File diagrams');
    expect(names).not.toContain('Inline code blocks');
    const group = tab.containerEl.querySelector<HTMLElement>('.drawio-edit-action-settings')!;
    const rows = Array.from(group.querySelectorAll<HTMLElement>('.drawio-edit-action-row'));
    expect(rows.map((row) =>
      row.querySelector('.drawio-edit-action-label')?.textContent,
    )).toEqual(['File diagrams', 'Inline code blocks']);
    const fileRow = rows[0]!;
    const inlineRow = rows[1]!;
    expect(fileRow.querySelector<HTMLSelectElement>('select')!.disabled).toBe(false);
    expect(fileRow.querySelectorAll('option')).toHaveLength(2);
    expect(inlineRow.querySelector<HTMLSelectElement>('select')!.disabled).toBe(true);
    expect(inlineRow.querySelector<HTMLSelectElement>('select')!.value).toBe('editor');
    expect(inlineRow.querySelectorAll('option')).toHaveLength(1);
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
    expect(names).not.toContain('Open diagram files read-only');
    expect(names).not.toContain('Preview click action');
    expect(names).not.toContain('Edit button action');
    expect(names).toContain('Preview alignment');
    expect(names).toContain('Follow Obsidian theme');
  });
});

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
      installedWebappVersion: async () => DRAWIO_VERSION,
    }));
    tab.display();
    const row = statusRow(tab.containerEl)!;
    await vi.waitFor(() => {
      expect(row.querySelector('button')?.textContent).toBe('Reinstall');
      expect(row.querySelector('.setting-item-description')?.textContent).toContain(DRAWIO_VERSION);
    });
  });

  it('offers Update (with CTA) when the installed version differs from the pinned one', async () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin({
      isWebappInstalled: async () => true,
      installedWebappVersion: async () => 'v29.0.0',
    }));
    tab.display();
    const row = statusRow(tab.containerEl)!;
    await vi.waitFor(() => {
      const button = row.querySelector<HTMLButtonElement>('button')!;
      expect(button.textContent).toBe('Update');
      expect(button.classList.contains('mod-cta')).toBe(true);
      const desc = row.querySelector('.setting-item-description')?.textContent ?? '';
      expect(desc).toContain('v29.0.0');
      expect(desc).toContain(DRAWIO_VERSION);
    });
  });

  it('keeps Reinstall (no update prompt) when the installed version is unknown', async () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin({
      isWebappInstalled: async () => true,
      installedWebappVersion: async () => null,
    }));
    tab.display();
    const row = statusRow(tab.containerEl)!;
    await vi.waitFor(() => {
      const button = row.querySelector<HTMLButtonElement>('button')!;
      expect(button.textContent).toBe('Reinstall');
      expect(button.classList.contains('mod-cta')).toBe(false);
      expect(row.querySelector('.setting-item-description')?.textContent).toBe('Installed.');
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

  it('drops the CTA styling once the button leaves the Install state', async () => {
    Platform.isDesktopApp = true;
    const plugin = fakePlugin();
    const tab = new DrawioSettingTab({} as never, plugin);
    tab.display();
    const row = statusRow(tab.containerEl)!;
    const button = row.querySelector<HTMLButtonElement>('button')!;
    await vi.waitFor(() => {
      expect(button.textContent).toBe('Install');
      expect(button.classList.contains('mod-cta')).toBe(true);
    });
    (plugin as unknown as { webappInstallStatus: InstallStatus }).webappInstallStatus
      .set({ status: 'installing', progressText: 'Downloading… 10%' });
    expect(button.textContent).toBe('Installing…');
    expect(button.classList.contains('mod-cta')).toBe(false);
  });
});
