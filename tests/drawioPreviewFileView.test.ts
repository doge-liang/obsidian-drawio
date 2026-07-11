import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock the viewer.min.txt file to avoid needing to fetch it
vi.mock('../src/preview/viewer.min.txt', () => ({ default: 'window.GraphViewer = window.GraphViewer || undefined;' }));

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
    settings: { previewClickAction },
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

  it('renders the page switcher for multi-page diagrams', () => {
    Platform.isDesktopApp = true;
    const view = makeView(fakePlugin());
    view.setViewData(MULTI_PAGE_XML, true);
    expect(view.contentEl.querySelector('.drawio-page-control')).not.toBeNull();
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
