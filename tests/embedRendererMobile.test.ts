import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub the raw-text import so the module loads fast under vitest and avoids
// jsdom-eval incompatibilities in the real vendored viewer (see
// tests/drawioMobileFileView.test.ts for the same pattern).
vi.mock('../src/preview/viewer.min.txt', () => ({ default: 'window.GraphViewer = window.GraphViewer || undefined;' }));

import { Platform, TFile } from 'obsidian';
import { registerDrawioEmbeds } from '../src/file/EmbedRenderer';
import type DrawioPlugin from '../src/main';

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel/></diagram></mxfile>';

type Creator = (ctx: { containerEl: HTMLElement }, file: TFile, subpath?: string) => { loadFile: () => Promise<void> };

function fakePlugin(openEditor: DrawioPlugin['openEditor']) {
  let creator: Creator | undefined;
  const file = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
  const raw = {
    app: {
      embedRegistry: {
        registerExtension: (_ext: string, c: Creator) => { creator = c; },
      },
      vault: { read: async () => XML, on: vi.fn(() => ({})) },
    },
    previewOpts: () => ({ dark: false, align: 'center' as const }),
    openEditor,
    register: vi.fn(),
  };
  return {
    plugin: raw as unknown as DrawioPlugin,
    create: (containerEl: HTMLElement) => creator!({ containerEl }, file, undefined),
  };
}

describe('drawio embed — mobile click behavior', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  it('opens the editor on click and shows the edit hint on desktop', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, create } = fakePlugin(openEditor);
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();
    containerEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(containerEl.querySelector('.drawio-edit-hint')).not.toBeNull();
  });

  it('shows a Notice instead of opening the editor on mobile, with no edit hint', async () => {
    Platform.isDesktopApp = false;
    const openEditor = vi.fn();
    const { plugin, create } = fakePlugin(openEditor);
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();
    containerEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(containerEl.querySelector('.drawio-edit-hint')).toBeNull();
  });
});
