import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub the raw-text import so the module loads fast under vitest and avoids
// jsdom-eval incompatibilities in the real vendored viewer (see
// tests/drawioMobileFileView.test.ts for the same pattern).
vi.mock('../src/preview/viewer.min.txt', () => ({ default: 'window.GraphViewer = window.GraphViewer || undefined;' }));
vi.mock('../src/preview/ViewerRenderer', () => ({
  renderPreview: (el: HTMLElement, _xml: string, opts: { page?: number }) => {
    el.empty();
    const svg = el.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', opts.page === 1 ? '10 20 400 300' : '0 0 200 100');
    svg.dataset.page = String(opts.page ?? 0);
    el.appendChild(svg);
    return true;
  },
}));

import { Platform, TFile } from 'obsidian';
import { registerDrawioEmbeds } from '../src/file/EmbedRenderer';
import type { PreviewClickAction } from '../src/settings';
import type DrawioPlugin from '../src/main';

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel/></diagram></mxfile>';
const MULTI_PAGE_XML = '<mxfile>' +
  '<diagram id="0" name="Page-1"><mxGraphModel/></diagram>' +
  '<diagram id="1" name="Page-2"><mxGraphModel/></diagram>' +
  '</mxfile>';

type Creator = (ctx: { containerEl: HTMLElement }, file: TFile, subpath?: string) => { loadFile: () => Promise<void> };

function fakePlugin(
  openEditor: DrawioPlugin['openEditor'],
  previewClickAction: PreviewClickAction = 'editor',
  xml = XML,
) {
  let creator: Creator | undefined;
  const openWithDefaultApp = vi.fn();
  const file = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
  const raw = {
    app: {
      embedRegistry: {
        registerExtension: (_ext: string, c: Creator) => { creator = c; },
      },
      vault: { read: async () => xml, on: vi.fn(() => ({})) },
      openWithDefaultApp,
    },
    settings: { previewClickAction, editButtonAction: 'editor' },
    previewOpts: () => ({ dark: false }),
    openEditor,
    register: vi.fn(),
  };
  return {
    plugin: raw as unknown as DrawioPlugin,
    create: (containerEl: HTMLElement) => creator!({ containerEl }, file, undefined),
    openWithDefaultApp,
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

  it('opens the system default app on click under "defaultApp"', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, create, openWithDefaultApp } = fakePlugin(openEditor, 'defaultApp');
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();
    containerEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openWithDefaultApp).toHaveBeenCalledWith('diagram.drawio');
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('does nothing on click under "none", with no edit hint', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, create, openWithDefaultApp } = fakePlugin(openEditor, 'none');
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();
    containerEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(openWithDefaultApp).not.toHaveBeenCalled();
    expect(containerEl.querySelector('.drawio-edit-hint')).toBeNull();
  });

  it('mounts the interactive viewer and opens the file editor from its Edit button', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, create } = fakePlugin(openEditor, 'interactive');
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();

    containerEl.querySelector<HTMLElement>('.drawio-preview')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(containerEl.classList.contains('drawio-interactive-active')).toBe(true);
    expect(containerEl.querySelector('.drawio-interactive-toolbar')).not.toBeNull();
    expect(containerEl.querySelector<HTMLElement>('.drawio-edit-hint')!.hidden).toBe(true);
    containerEl.querySelector<HTMLButtonElement>('[aria-label="Edit diagram"]')!.click();
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('routes the interactive Edit button to the system app for file embeds', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create, openWithDefaultApp } = fakePlugin(vi.fn(), 'interactive');
    plugin.settings.editButtonAction = 'defaultApp';
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();
    containerEl.querySelector<HTMLElement>('.drawio-preview')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    containerEl.querySelector<HTMLButtonElement>('[aria-label="Edit diagram"]')!.click();
    expect(openWithDefaultApp).toHaveBeenCalledWith('diagram.drawio');
  });

  it('keeps activation state isolated between two embeds', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create } = fakePlugin(vi.fn(), 'interactive');
    registerDrawioEmbeds(plugin);
    const first = document.createElement('div');
    const second = document.createElement('div');
    await create(first).loadFile();
    await create(second).loadFile();

    first.querySelector<HTMLElement>('.drawio-preview')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(first.classList.contains('drawio-interactive-active')).toBe(true);
    expect(second.classList.contains('drawio-interactive-active')).toBe(false);
    expect(first.querySelectorAll('.drawio-interactive-toolbar')).toHaveLength(1);
    expect(second.querySelectorAll('.drawio-interactive-toolbar')).toHaveLength(1);
  });

  it('rebinds a multi-page embed without changing its viewport height', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create } = fakePlugin(vi.fn(), 'interactive', MULTI_PAGE_XML);
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();
    const preview = containerEl.querySelector<HTMLElement>('.drawio-preview')!;
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const handle = containerEl.querySelector<HTMLElement>('.drawio-interactive-resize-handle')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 420 }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 420 }));
    const height = preview.style.height;

    const buttons = containerEl.querySelectorAll<HTMLButtonElement>('.drawio-page-control button');
    buttons[1]!.click();
    const replacement = preview.querySelector('svg')!;
    expect(replacement.dataset.page).toBe('1');
    expect(replacement.classList.contains('drawio-interactive-svg')).toBe(true);
    expect(preview.style.height).toBe(height);
    expect(containerEl.classList.contains('drawio-interactive-active')).toBe(false);
    expect(containerEl.querySelectorAll('.drawio-interactive-toolbar')).toHaveLength(1);
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
