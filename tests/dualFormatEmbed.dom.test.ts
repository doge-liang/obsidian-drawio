import { describe, it, expect, vi, afterEach } from 'vitest';

// Same viewer stub as the other embed tests: keep the module load fast and off
// the real vendored viewer under jsdom.
vi.mock('../src/preview/viewer.min.txt', () => ({ default: 'window.GraphViewer = window.GraphViewer || undefined;' }));
vi.mock('../src/preview/ViewerRenderer', () => ({
  renderPreview: () => true,
}));

import { Platform, TFile } from 'obsidian';
import { registerDualFormatEmbeds } from '../src/file/EmbedRenderer';
import { DualFormatFileSource } from '../src/file/DualFormatFileSource';
import type { PreviewClickAction } from '../src/settings';
import type DrawioPlugin from '../src/main';

type PostProcessor = (el: HTMLElement, ctx: { sourcePath: string }) => void;

function fakePlugin(previewClickAction: PreviewClickAction = 'editor') {
  let processor: PostProcessor | undefined;
  const openEditor = vi.fn();
  const openWithDefaultApp = vi.fn();
  const files = new Map<string, TFile>();
  const raw = {
    app: {
      metadataCache: {
        getFirstLinkpathDest: (path: string) => {
          const existing = files.get(path);
          if (existing) return existing;
          // Any linkpath resolves to a TFile with that path (enough for these tests).
          const f = Object.assign(new TFile(), { path, basename: path.replace(/\.[^.]+$/, '') });
          files.set(path, f);
          return f;
        },
      },
      openWithDefaultApp,
    },
    settings: { previewClickAction },
    openEditor,
    registerMarkdownPostProcessor: (cb: PostProcessor) => { processor = cb; },
  };
  return {
    plugin: raw as unknown as DrawioPlugin,
    run: (el: HTMLElement) => processor!(el, { sourcePath: 'note.md' }),
    openEditor,
    openWithDefaultApp,
  };
}

/** Build a Reading-view-like image embed span with an inner <img>. */
function makeEmbed(src: string): { span: HTMLElement; img: HTMLElement } {
  const container = document.createElement('div');
  const span = document.createElement('div');
  span.className = 'internal-embed media-embed image-embed';
  span.setAttribute('src', src);
  const img = document.createElement('img');
  span.appendChild(img);
  container.appendChild(span);
  return { span, img };
}

describe('dual-format image embeds — click-to-edit', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  it('decorates a .drawio.svg embed and opens the editor on click', () => {
    Platform.isDesktopApp = true;
    const { plugin, run, openEditor } = fakePlugin('editor');
    registerDualFormatEmbeds(plugin);

    const { span, img } = makeEmbed('diagram.drawio.svg');
    run(span.parentElement as HTMLElement);

    expect(span.classList.contains('drawio-dualformat-embed')).toBe(true);
    expect(span.dataset.drawioDualformat).toBe('1');
    expect(span.getAttribute('title')).toBe('Click to edit diagram');

    // A click on the inner <img> is caught by our capture-phase handler.
    img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(openEditor.mock.calls[0]?.[0]).toBeInstanceOf(DualFormatFileSource);
  });

  it('opens the default app under the "defaultApp" action', () => {
    Platform.isDesktopApp = true;
    const { plugin, run, openEditor, openWithDefaultApp } = fakePlugin('defaultApp');
    registerDualFormatEmbeds(plugin);

    const { span, img } = makeEmbed('pic.drawio.png');
    run(span.parentElement as HTMLElement);
    img.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(openWithDefaultApp).toHaveBeenCalledWith('pic.drawio.png');
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('does nothing on click under "none"', () => {
    Platform.isDesktopApp = true;
    const { plugin, run, openEditor, openWithDefaultApp } = fakePlugin('none');
    registerDualFormatEmbeds(plugin);

    const { span, img } = makeEmbed('diagram.drawio.svg');
    run(span.parentElement as HTMLElement);

    expect(span.classList.contains('drawio-no-action')).toBe(true);
    img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(openWithDefaultApp).not.toHaveBeenCalled();
  });

  it('falls back to the editor under "interactive" — a native <img> has no SVG to explore', () => {
    Platform.isDesktopApp = true;
    const { plugin, run, openEditor } = fakePlugin('interactive');
    registerDualFormatEmbeds(plugin);

    const { span, img } = makeEmbed('diagram.drawio.svg');
    run(span.parentElement as HTMLElement);

    expect(span.getAttribute('title')).toBe('Click to edit diagram');
    img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('ignores plain images and .drawio embeds', () => {
    Platform.isDesktopApp = true;
    const { plugin, run } = fakePlugin('editor');
    registerDualFormatEmbeds(plugin);

    for (const src of ['photo.svg', 'chart.png', 'diagram.drawio']) {
      const { span } = makeEmbed(src);
      run(span.parentElement as HTMLElement);
      expect(span.classList.contains('drawio-dualformat-embed')).toBe(false);
      expect(span.dataset.drawioDualformat).toBeUndefined();
    }
  });

  it('does nothing on mobile — the native image is left untouched', () => {
    Platform.isDesktopApp = false;
    const { plugin, run, openEditor } = fakePlugin('editor');
    registerDualFormatEmbeds(plugin);

    const { span, img } = makeEmbed('diagram.drawio.svg');
    run(span.parentElement as HTMLElement);

    expect(span.classList.contains('drawio-dualformat-embed')).toBe(false);
    img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('is idempotent — a re-processed span is not double-decorated', () => {
    Platform.isDesktopApp = true;
    const { plugin, run } = fakePlugin('editor');
    registerDualFormatEmbeds(plugin);

    const { span } = makeEmbed('diagram.drawio.svg');
    const parent = span.parentElement as HTMLElement;
    run(parent);
    run(parent);
    expect(parent.querySelectorAll('.drawio-dualformat-embed').length).toBe(1);
    expect(span.dataset.drawioDualformat).toBe('1');
  });
});
