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

import { Platform } from 'obsidian';
import { registerDrawioCodeBlock } from '../src/codeblock/DrawioCodeBlock';
import type { PreviewClickAction } from '../src/settings';
import type DrawioPlugin from '../src/main';

type Processor = (source: string, el: HTMLElement, ctx: unknown) => void | Promise<void>;

function fakePlugin(openEditor: DrawioPlugin['openEditor'], previewClickAction: PreviewClickAction = 'editor') {
  let processor: Processor | undefined;
  const raw = {
    app: {},
    settings: { previewClickAction, editButtonAction: 'editor' },
    previewOpts: () => ({ dark: false }),
    openEditor,
    registerMarkdownCodeBlockProcessor: (_lang: string, cb: Processor) => { processor = cb; },
  };
  return {
    plugin: raw as unknown as DrawioPlugin,
    run: async (source: string, el: HTMLElement, ctx: unknown) => processor!(source, el, {
      ...(ctx as object),
      addChild: vi.fn(),
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

  it('opens the editor on click and shows the edit hint on desktop', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor);
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.drawio-edit-hint')).not.toBeNull();
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

  it('does nothing on click under "none", with no edit hint', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor, 'none');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(el.querySelector('.drawio-edit-hint')).toBeNull();
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
    const explore = wrapper.querySelector<HTMLElement>('.drawio-edit-hint')!;
    expect(explore.hidden).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(explore.hidden).toBe(false);
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

  it('shows a Notice instead of opening the editor on mobile, with no edit hint', async () => {
    Platform.isDesktopApp = false;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor);
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    await run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(el.querySelector('.drawio-edit-hint')).toBeNull();
  });
});
