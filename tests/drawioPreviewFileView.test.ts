import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock the viewer.min.txt file to avoid needing to fetch it
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
import { DrawioPreviewFileView } from '../src/preview/DrawioPreviewFileView';
import type { PreviewClickAction } from '../src/settings';
import type DrawioPlugin from '../src/main';

function fakePlugin(
  previewClickAction: PreviewClickAction = 'editor',
  openEditor = vi.fn(),
  app: Record<string, unknown> = {},
): DrawioPlugin {
  return {
    app,
    settings: { previewClickAction, editButtonAction: 'editor' },
    previewOpts: () => ({ dark: false }),
    openEditor,
  } as unknown as DrawioPlugin;
}

function makeView(plugin: DrawioPlugin, withFile = true): DrawioPreviewFileView {
  const view = new DrawioPreviewFileView({} as never, plugin);
  if (withFile) {
    view.file = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
  }
  return view;
}

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" ' +
  'gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" ' +
  'pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">' +
  '<root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

const MULTI_PAGE_XML = '<mxfile>' +
  '<diagram id="0" name="Page-1"><mxGraphModel/></diagram>' +
  '<diagram id="1" name="Page-2"><mxGraphModel/></diagram>' +
  '</mxfile>';

describe('DrawioPreviewFileView', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  it('on mobile renders the fixed banner and the diagram, with no iframe and no hint', () => {
    Platform.isDesktopApp = false;
    const view = makeView(fakePlugin());
    view.setViewData(XML, true);
    const banner = view.contentEl.querySelector('.drawio-mobile-banner');
    expect(banner?.textContent).toContain('preview only on mobile');
    expect(view.contentEl.querySelector('.drawio-preview')).not.toBeNull();
    expect(view.contentEl.querySelector('iframe')).toBeNull();
    expect(view.contentEl.querySelector('.drawio-edit-hint')).toBeNull();
  });

  it('on mobile ignores clicks (no editor, no default app)', () => {
    Platform.isDesktopApp = false;
    const openEditor = vi.fn();
    const openWithDefaultApp = vi.fn();
    const view = makeView(fakePlugin('editor', openEditor, { openWithDefaultApp }));
    view.setViewData(XML, true);
    view.contentEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(openWithDefaultApp).not.toHaveBeenCalled();
  });

  it('on desktop skips the banner and opens the modal editor on click ("editor")', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const view = makeView(fakePlugin('editor', openEditor));
    view.setViewData(XML, true);
    expect(view.contentEl.querySelector('.drawio-mobile-banner')).toBeNull();
    const hintLabels = Array.from(view.contentEl.querySelectorAll('.drawio-edit-hint span'));
    expect(hintLabels.some((s) => s.textContent === 'Edit')).toBe(true);
    view.contentEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('on desktop opens the system default app on click ("defaultApp")', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const openWithDefaultApp = vi.fn();
    const view = makeView(fakePlugin('defaultApp', openEditor, { openWithDefaultApp }));
    view.setViewData(XML, true);
    const hintLabels = Array.from(view.contentEl.querySelectorAll('.drawio-edit-hint span'));
    expect(hintLabels.some((s) => s.textContent === 'Open')).toBe(true);
    view.contentEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openWithDefaultApp).toHaveBeenCalledWith('diagram.drawio');
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('on desktop does nothing on click ("none"), with no hint', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const openWithDefaultApp = vi.fn();
    const view = makeView(fakePlugin('none', openEditor, { openWithDefaultApp }));
    view.setViewData(XML, true);
    expect(view.contentEl.querySelector('.drawio-edit-hint')).toBeNull();
    view.contentEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(openWithDefaultApp).not.toHaveBeenCalled();
  });

  it('mounts the interactive viewer and routes its Edit button', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const view = makeView(fakePlugin('interactive', openEditor));
    view.setViewData(XML, true);
    const preview = view.contentEl.querySelector<HTMLElement>('.drawio-preview')!;
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(view.contentEl.classList.contains('drawio-interactive-active')).toBe(true);
    expect(view.contentEl.querySelector('.drawio-interactive-toolbar')).not.toBeNull();
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Edit diagram"]')!.click();
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('rebinds the interactive viewer after a file-view page flip', () => {
    Platform.isDesktopApp = true;
    const view = makeView(fakePlugin('interactive'));
    view.setViewData(MULTI_PAGE_XML, true);
    const preview = view.contentEl.querySelector<HTMLElement>('.drawio-preview')!;
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Establish a viewport height by resizing (jsdom measures 0, so the
    // automatic height stays deferred until a real layout or a manual resize).
    const handle = view.contentEl.querySelector<HTMLElement>('.drawio-interactive-resize-handle')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 400 }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 400 }));
    const height = preview.style.height;
    view.contentEl.querySelectorAll<HTMLButtonElement>('.drawio-page-control button')[1]!.click();
    const replacement = preview.querySelector('svg')!;
    expect(replacement.dataset.page).toBe('1');
    expect(replacement.classList.contains('drawio-interactive-svg')).toBe(true);
    expect(preview.style.height).toBe(height);
    expect(view.contentEl.classList.contains('drawio-interactive-active')).toBe(false);
  });

  it('renders the page switcher for multi-page diagrams', () => {
    Platform.isDesktopApp = true;
    const view = makeView(fakePlugin());
    view.setViewData(MULTI_PAGE_XML, true);
    expect(view.contentEl.querySelector('.drawio-page-control')).not.toBeNull();
  });

  it('anchors the edit hint to the preview wrapper, not the tab-filling container', () => {
    Platform.isDesktopApp = true;
    const view = makeView(fakePlugin());
    view.setViewData(XML, true);
    const hint = view.contentEl.querySelector('.drawio-edit-hint');
    expect(hint?.parentElement?.classList.contains('drawio-preview-wrap')).toBe(true);
  });

  it('keeps the edit hint after flipping pages (renderPreview empties only .drawio-preview)', () => {
    Platform.isDesktopApp = true;
    const view = makeView(fakePlugin());
    view.setViewData(MULTI_PAGE_XML, true);
    const nextBtn = view.contentEl.querySelectorAll<HTMLButtonElement>('.drawio-page-control button')[1];
    expect(nextBtn?.textContent).toBe('›');
    nextBtn?.click();
    expect(view.contentEl.querySelector('.drawio-edit-hint')).not.toBeNull();
  });

  it('getViewData returns the last data set (no write path)', () => {
    Platform.isDesktopApp = false;
    const view = makeView(fakePlugin());
    view.setViewData(XML, true);
    expect(view.getViewData()).toBe(XML);
  });

  it('clear() empties the content element and resets the data', () => {
    Platform.isDesktopApp = false;
    const view = makeView(fakePlugin());
    view.setViewData(XML, true);
    view.clear();
    expect(view.contentEl.children.length).toBe(0);
    expect(view.getViewData()).toBe('');
  });

  it('reports the shared drawio view type and a pencil-ruler icon', () => {
    const view = makeView(fakePlugin(), false);
    expect(view.getViewType()).toBe('drawio-file-view');
    expect(view.getIcon()).toBe('pencil-ruler');
  });
});
