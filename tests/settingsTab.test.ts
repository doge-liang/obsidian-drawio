import { describe, it, expect, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { DrawioSettingTab } from '../src/settingsTab';
import { DEFAULT_SETTINGS } from '../src/settings';
import type DrawioPlugin from '../src/main';

function fakePlugin(): DrawioPlugin {
  return {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
    updateServerIdleTimeout: () => {},
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
    expect(names).toContain('Preview alignment');
    expect(names).toContain('Follow Obsidian theme');
  });
});
