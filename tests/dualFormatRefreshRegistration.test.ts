import { afterEach, expect, it, vi } from 'vitest';
import { Platform } from 'obsidian';

vi.mock('../src/file/dualFormatRefresh', () => ({ registerDualFormatRefresh: vi.fn() }));
import DrawioPlugin from '../src/main';
import { registerDualFormatRefresh } from '../src/file/dualFormatRefresh';
import { DEFAULT_SETTINGS } from '../src/settings';

const desktop = Platform.isDesktopApp;
afterEach(() => { Platform.isDesktopApp = desktop; });

it('registers native image refresh on plugin load, including preview-only platforms', async () => {
  Platform.isDesktopApp = false;
  const plugin = Object.assign(new DrawioPlugin({} as never, {} as never), {
    app: { workspace: { on: vi.fn() } },
    settings: { ...DEFAULT_SETTINGS },
    loadSettings: vi.fn(async () => {}),
    registerView: vi.fn(),
    registerExtensions: vi.fn(),
    registerMarkdownCodeBlockProcessor: vi.fn(),
    registerMarkdownPostProcessor: vi.fn(),
    registerEvent: vi.fn(),
    register: vi.fn(),
    addCommand: vi.fn(),
    addSettingTab: vi.fn(),
    applyPreviewAlignment: vi.fn(),
  });

  await plugin.onload();

  expect(registerDualFormatRefresh).toHaveBeenCalledWith(plugin);
});
