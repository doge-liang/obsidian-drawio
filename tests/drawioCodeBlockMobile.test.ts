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
import { registerDrawioCodeBlock } from '../src/codeblock/DrawioCodeBlock';
import type { PreviewClickAction } from '../src/settings';
import type DrawioPlugin from '../src/main';

type Processor = (source: string, el: HTMLElement, ctx: unknown) => void | Promise<void>;

function fakePlugin(
  openEditor: DrawioPlugin['openEditor'],
  previewClickAction: PreviewClickAction = 'editor',
  app: Record<string, unknown> = {},
) {
  let processor: Processor | undefined;
  const raw = {
    app,
    settings: { previewClickAction, editButtonAction: 'editor' },
    previewOpts: () => ({ dark: false }),
    openEditor,
    registerMarkdownCodeBlockProcessor: (_lang: string, cb: Processor) => { processor = cb; },
  };
  return {
    plugin: raw as unknown as DrawioPlugin,
    // Load added children the way Obsidian's real ctx.addChild does for a
    // live section — the interactive mount is queued on that load.
    run: async (source: string, el: HTMLElement, ctx: unknown) => processor!(source, el, {
      ...(ctx as object),
      addChild: vi.fn((child: unknown) => { (child as { load?: () => void }).load?.(); }),
    }),
  };
}

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel/></diagram></mxfile>';
const MULTI_PAGE_XML = '<mxfile>' +
  '<diagram id="0" name="Page-1"><mxGraphModel/></diagram>' +
  '<diagram id="1" name="Page-2"><mxGraphModel/></diagram>' +
  '</mxfile>';

describe('drawio code block — mobile click behavior', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  it('opens the editor on click on desktop', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor);
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('still opens the built-in editor under "defaultApp" (code blocks have no file)', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor, 'defaultApp');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('does nothing on click under "none"', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor, 'none');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('mounts the walking skeleton without opening the editor under "interactive"', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor, 'interactive');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    const wrapper = el.querySelector<HTMLElement>('.drawio-codeblock')!;
    wrapper.querySelector<HTMLElement>('.drawio-preview')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(wrapper.classList.contains('drawio-interactive-active')).toBe(true);
    expect(wrapper.querySelector('.drawio-interactive-toolbar')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrapper.classList.contains('drawio-interactive-active')).toBe(false);
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('opens the built-in editor from the interactive toolbar Edit button', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor, 'interactive');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    const wrapper = el.querySelector<HTMLElement>('.drawio-codeblock')!;
    wrapper.querySelector<HTMLElement>('.drawio-preview')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    wrapper.querySelector<HTMLButtonElement>('[aria-label="Edit diagram"]')!.click();

    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('rebinds the viewer after a page change without changing the viewport height', async () => {
    Platform.isDesktopApp = true;
    const { plugin, run } = fakePlugin(vi.fn(), 'interactive');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(MULTI_PAGE_XML, el, { sourcePath: 'note.md' });
    const wrapper = el.querySelector<HTMLElement>('.drawio-codeblock')!;
    const preview = wrapper.querySelector<HTMLElement>('.drawio-preview')!;
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const handle = wrapper.querySelector<HTMLElement>('.drawio-interactive-resize-handle')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 420 }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 420 }));
    const height = preview.style.height;
    const firstSvg = preview.querySelector('svg');

    const pageButtons = wrapper.querySelectorAll<HTMLButtonElement>('.drawio-page-control button');
    pageButtons[1]!.click();
    const replacement = preview.querySelector('svg')!;

    expect(replacement).not.toBe(firstSvg);
    expect(replacement.dataset.page).toBe('1');
    expect(replacement.getAttribute('viewBox')).toBe('10 20 400 300');
    expect(replacement.classList.contains('drawio-interactive-svg')).toBe(true);
    expect(preview.style.height).toBe(height);
    expect(wrapper.classList.contains('drawio-interactive-active')).toBe(false);
    expect(wrapper.querySelectorAll('.drawio-interactive-toolbar')).toHaveLength(1);
  });

  it('renders the diagram even when the stored-height read fails', async () => {
    Platform.isDesktopApp = true;
    const app = { vault: { getAbstractFileByPath: () => { throw new Error('metadata boom'); } } };
    const { plugin, run } = fakePlugin(vi.fn(), 'interactive', app);
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    expect(el.querySelector('.drawio-preview svg')).not.toBeNull();
    expect(el.querySelector('.drawio-interactive-toolbar')).not.toBeNull();
  });

  it('constructs no interactive controller outside Interactive Viewer mode', async () => {
    Platform.isDesktopApp = true;
    const { plugin, run } = fakePlugin(vi.fn(), 'editor');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    const wrapper = el.querySelector<HTMLElement>('.drawio-codeblock')!;
    expect(wrapper.querySelector('.drawio-interactive-toolbar')).toBeNull();
    expect(wrapper.classList.contains('drawio-interactive')).toBe(false);
  });

  it('activates lazily with the stored height after switching to Interactive viewer', async () => {
    Platform.isDesktopApp = true;
    const note = Object.assign(new TFile(), { path: 'note.md', basename: 'note' });
    const doc = `<!-- drawio-viewer: height=333 -->\n\`\`\`drawio\n${XML}\n\`\`\``;
    const app = {
      vault: {
        getAbstractFileByPath: (p: string) => (p === 'note.md' ? note : null),
        cachedRead: () => Promise.resolve(doc),
      },
    };
    const { plugin, run } = fakePlugin(vi.fn(), 'editor', app);
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md', getSectionInfo: () => null });
    const wrapper = el.querySelector<HTMLElement>('.drawio-codeblock')!;
    expect(wrapper.classList.contains('drawio-interactive')).toBe(false);

    plugin.settings.previewClickAction = 'interactive';
    const preview = wrapper.querySelector<HTMLElement>('.drawio-preview')!;
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(wrapper.classList.contains('drawio-interactive-active')).toBe(true);
    expect(wrapper.querySelector('.drawio-interactive-toolbar')).not.toBeNull();
    await new Promise((resolve) => { window.setTimeout(resolve, 0); });
    expect(preview.style.height).toBe('333px');
  });

  it('never mounts the controller when the owning section is already torn down', async () => {
    Platform.isDesktopApp = true;
    const { plugin } = fakePlugin(vi.fn(), 'interactive');
    let processor: ((s: string, e: HTMLElement, c: unknown) => void | Promise<void>) | undefined;
    (plugin as unknown as {
      registerMarkdownCodeBlockProcessor: (lang: string, cb: Processor) => void;
    }).registerMarkdownCodeBlockProcessor = (_lang, cb) => { processor = cb; };
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    const addSpy = vi.spyOn(document, 'addEventListener');
    // addChild stores the child but never loads it — exactly what Obsidian
    // does when the section was unloaded while the processor awaited.
    await processor!(XML, el, { sourcePath: 'note.md', addChild: vi.fn() });
    const added = addSpy.mock.calls.filter((call) => call[0] === 'keydown').length;
    addSpy.mockRestore();
    expect(added).toBe(0);
    expect(el.querySelector('.drawio-interactive-toolbar')).toBeNull();
    expect(el.querySelector<HTMLElement>('.drawio-codeblock')!.classList.contains('drawio-interactive'))
      .toBe(false);
  });

  it('constructs lazily on a drag start (pointerdown), matching eager activation', async () => {
    Platform.isDesktopApp = true;
    const { plugin, run } = fakePlugin(vi.fn(), 'editor');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    const wrapper = el.querySelector<HTMLElement>('.drawio-codeblock')!;
    plugin.settings.previewClickAction = 'interactive';
    wrapper.querySelector<HTMLElement>('.drawio-preview')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(wrapper.classList.contains('drawio-interactive-active')).toBe(true);
  });

  it('keeps the lazy listeners armed while the preview has no SVG yet', async () => {
    Platform.isDesktopApp = true;
    const { plugin, run } = fakePlugin(vi.fn(), 'editor');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    const wrapper = el.querySelector<HTMLElement>('.drawio-codeblock')!;
    const preview = wrapper.querySelector<HTMLElement>('.drawio-preview')!;
    plugin.settings.previewClickAction = 'interactive';

    const svg = preview.querySelector('svg')!;
    svg.remove(); // deferred render: nothing to bind yet
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(wrapper.classList.contains('drawio-interactive')).toBe(false);

    preview.appendChild(svg); // render finalized — the same listeners still work
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(wrapper.classList.contains('drawio-interactive-active')).toBe(true);
  });

  it('shows a Notice instead of opening the editor on mobile', async () => {
    Platform.isDesktopApp = false;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor);
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
  });
});
