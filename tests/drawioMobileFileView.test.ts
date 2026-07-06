import { describe, it, expect, vi } from 'vitest';

// Mock the viewer.min.txt file to avoid needing to fetch it
vi.mock('../src/preview/viewer.min.txt', () => ({ default: 'window.GraphViewer = window.GraphViewer || undefined;' }));

import { DrawioMobileFileView } from '../src/preview/DrawioMobileFileView';
import type DrawioPlugin from '../src/main';

function fakePlugin(): DrawioPlugin {
  return {
    previewOpts: () => ({ dark: false, align: 'center' as const }),
  } as unknown as DrawioPlugin;
}

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" ' +
  'gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" ' +
  'pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">' +
  '<root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

describe('DrawioMobileFileView', () => {
  it('renders the fixed banner and the diagram, with no iframe', () => {
    const view = new DrawioMobileFileView({} as never, fakePlugin());
    view.setViewData(XML, true);
    const banner = view.contentEl.querySelector('.drawio-mobile-banner');
    expect(banner?.textContent).toContain('preview only on mobile');
    expect(view.contentEl.querySelector('.drawio-preview')).not.toBeNull();
    expect(view.contentEl.querySelector('iframe')).toBeNull();
  });

  it('getViewData returns the last data set (no write path)', () => {
    const view = new DrawioMobileFileView({} as never, fakePlugin());
    view.setViewData(XML, true);
    expect(view.getViewData()).toBe(XML);
  });

  it('clear() empties the content element and resets the data', () => {
    const view = new DrawioMobileFileView({} as never, fakePlugin());
    view.setViewData(XML, true);
    view.clear();
    expect(view.contentEl.children.length).toBe(0);
    expect(view.getViewData()).toBe('');
  });

  it('reports the shared drawio view type and a pencil-ruler icon', () => {
    const view = new DrawioMobileFileView({} as never, fakePlugin());
    expect(view.getViewType()).toBe('drawio-file-view');
    expect(view.getIcon()).toBe('pencil-ruler');
  });
});
