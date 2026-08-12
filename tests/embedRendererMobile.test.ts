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
const heightMetadata = vi.hoisted(() => ({
  read: vi.fn((_app: unknown, _sourcePath: string) => Promise.resolve<number | null>(null)),
  write: vi.fn((
    _app: unknown,
    _sourcePath: string,
    _file: unknown,
    _subpath: string | undefined,
    _height: number,
    _ctx?: unknown,
    _el?: HTMLElement,
    _occurrence?: number,
  ) => Promise.resolve<'written'>('written')),
}));
vi.mock('../src/preview/embedViewportHeight', () => ({
  readEmbedViewportHeight: heightMetadata.read,
  writeEmbedViewportHeight: heightMetadata.write,
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

type Creator = (
  ctx: { containerEl: HTMLElement; sourcePath?: string },
  file: TFile,
  subpath?: string,
) => { loadFile: () => Promise<void> };

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
    create: (containerEl: HTMLElement, sourcePath?: string) =>
      creator!({ containerEl, sourcePath }, file, undefined),
    openWithDefaultApp,
  };
}

describe('drawio embed — mobile click behavior', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => {
    Platform.isDesktopApp = originalIsDesktopApp;
    heightMetadata.read.mockReset();
    heightMetadata.read.mockResolvedValue(null);
    heightMetadata.write.mockReset();
    heightMetadata.write.mockResolvedValue('written');
  });

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

  it('restores and commits the height of a Markdown embed insertion', async () => {
    Platform.isDesktopApp = true;
    heightMetadata.read.mockResolvedValue(360);
    const { plugin, create } = fakePlugin(vi.fn(), 'interactive');
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl, 'note.md');
    await embed.loadFile();
    const preview = containerEl.querySelector<HTMLElement>('.drawio-preview')!;
    expect(preview.style.height).toBe('360px');
    expect(heightMetadata.read).toHaveBeenCalledTimes(1);

    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const handle = containerEl.querySelector<HTMLElement>('.drawio-interactive-resize-handle')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 360 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 500 }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 500 }));
    expect(heightMetadata.write).toHaveBeenCalledTimes(1);
    expect(heightMetadata.write.mock.calls[0]?.[1]).toBe('note.md');
    expect(heightMetadata.write.mock.calls[0]?.[4]).toBe(500);
  });

  it('re-reads persisted height after the embed is bound to its render surface', async () => {
    Platform.isDesktopApp = true;
    heightMetadata.read.mockResolvedValueOnce(null).mockResolvedValueOnce(470);
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const { plugin, create } = fakePlugin(vi.fn(), 'interactive');
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    await create(containerEl, 'note.md').loadFile();
    expect(frames).toHaveLength(1);
    frames.shift()!(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(containerEl.querySelector<HTMLElement>('.drawio-preview')!.style.height).toBe('470px');
    raf.mockRestore();
  });

  it('does not read persisted height outside Interactive Viewer mode', async () => {
    Platform.isDesktopApp = true;
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const { plugin, create } = fakePlugin(vi.fn(), 'editor');
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    await create(containerEl, 'note.md').loadFile();
    frames.shift()?.(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(heightMetadata.read).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it('does not construct the interactive controller outside Interactive Viewer mode', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create } = fakePlugin(vi.fn(), 'editor');
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    await create(containerEl, 'note.md').loadFile();
    expect(containerEl.querySelector('.drawio-interactive-toolbar')).toBeNull();
    expect(containerEl.classList.contains('drawio-interactive')).toBe(false);
  });

  it('does not leak the previous controller when renders overlap', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create } = fakePlugin(vi.fn(), 'interactive');
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl, 'note.md');
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    await Promise.all([embed.loadFile(), embed.loadFile()]);
    const added = addSpy.mock.calls.filter((call) => call[0] === 'keydown').length;
    const removed = removeSpy.mock.calls.filter((call) => call[0] === 'keydown').length;
    addSpy.mockRestore();
    removeSpy.mockRestore();
    // Exactly one live controller: the superseded render must not have
    // constructed (and leaked) a second set of document-level listeners.
    expect(added - removed).toBe(1);
    expect(containerEl.querySelectorAll('.drawio-interactive-toolbar')).toHaveLength(1);
  });

  it('coalesces bursts of note edits into one stored-height read', async () => {
    Platform.isDesktopApp = true;
    heightMetadata.read.mockResolvedValue(360);
    const modifyHandlers: Array<(f: TFile) => void> = [];
    const openWithDefaultApp = vi.fn();
    const file = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
    let creator: Creator | undefined;
    const plugin = {
      app: {
        embedRegistry: { registerExtension: (_ext: string, c: Creator) => { creator = c; } },
        vault: {
          read: async () => XML,
          on: (_event: string, cb: (f: TFile) => void) => { modifyHandlers.push(cb); return {}; },
        },
        openWithDefaultApp,
      },
      settings: { previewClickAction: 'interactive', editButtonAction: 'editor' },
      previewOpts: () => ({ dark: false }),
      openEditor: vi.fn(),
      register: vi.fn(),
    } as unknown as DrawioPlugin;
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = creator!({ containerEl, sourcePath: 'note.md' }, file, undefined) as unknown as {
      loadFile: () => Promise<void>; load: () => void; unload: () => void;
    };
    embed.load(); // Obsidian loads the embed component, registering vault events
    await embed.loadFile();
    heightMetadata.read.mockClear();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const note = Object.assign(new TFile(), { path: 'note.md', basename: 'note' });
      for (let burst = 0; burst < 5; burst += 1) {
        for (const handler of modifyHandlers) handler(note);
      }
      expect(heightMetadata.read).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(heightMetadata.read).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      embed.unload();
    }
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
