import { describe, it, expect, afterEach, vi } from 'vitest';
import { Platform } from 'obsidian';
import { DrawioSettingTab } from '../src/settingsTab';
import { DEFAULT_SETTINGS } from '../src/settings';
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
      installedWebappVersion: async () => 'v30.0.4',
    }));
    tab.display();
    const row = statusRow(tab.containerEl)!;
    await vi.waitFor(() => {
      expect(row.querySelector('button')?.textContent).toBe('Reinstall');
      expect(row.querySelector('.setting-item-description')?.textContent).toContain('v30.0.4');
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
});
