import { describe, it, expect, vi } from 'vitest';

// A fake GraphViewer that renders the way the real one does: an <svg> sized ONLY
// by inline `width:100%`/`height:100%` plus `min-width`/`min-height` equal to the
// diagram bounds, with no viewBox/width/height attributes.
const fakeViewer = {
  createViewerForElement(mount: HTMLElement) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style',
      'left:0;top:0;width:100%;height:100%;display:block;min-width:185px;min-height:85px;');
    svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
    mount.appendChild(svg);
  },
};

vi.mock('../src/preview/loadViewer', () => ({
  ensureViewerLoaded: () => {},
  getGraphViewer: () => fakeViewer,
}));

import { renderPreview, VIEWBOX_CENTERING_SHIFT } from '../src/preview/ViewerRenderer';

function patchEl(el: HTMLElement) {
  (el as any).empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
  (el as any).createDiv = function (o: any) {
    const d = document.createElement('div');
    if (o?.cls) d.className = o.cls;
    if (o?.text) d.textContent = o.text;
    (d as any).empty = (el as any).empty;
    (d as any).createDiv = (el as any).createDiv;
    this.appendChild(d); return d;
  };
}

describe('renderPreview standalone-svg sizing', () => {
  it('gives the lifted svg explicit viewBox/width/height and strips inline 100% sizing', () => {
    const el = document.createElement('div');
    patchEl(el);

    const ok = renderPreview(el, '<mxfile></mxfile>', { dark: false });
    expect(ok).toBe(true);

    const svg = el.querySelector('svg');
    expect(svg).toBeTruthy();
    // Size comes from the GraphViewer min-width/min-height (185x85); the origin
    // is shifted negative to re-centre the diagram, which GraphViewer itself
    // leaves 8px left-of-centre (see VIEWBOX_CENTERING_SHIFT and
    // tests/viewerBorderContract.dom.test.ts).
    const o = -VIEWBOX_CENTERING_SHIFT;
    expect(svg!.getAttribute('viewBox')).toBe(`${o} ${o} 185 85`);
    expect(svg!.getAttribute('width')).toBe('185');
    expect(svg!.getAttribute('height')).toBe('85');
    // The inline width/height:100% (which would stretch a standalone svg) is gone.
    expect(svg!.style.width).toBe('');
    expect(svg!.style.height).toBe('');
    expect(svg!.style.minWidth).toBe('');
  });

  it('threads opts.page into the data-mxgraph config passed to GraphViewer', () => {
    const el = document.createElement('div');
    patchEl(el);
    let capturedConfig: any = null;
    const originalCreate = fakeViewer.createViewerForElement;
    fakeViewer.createViewerForElement = (mount: HTMLElement) => {
      capturedConfig = JSON.parse(mount.getAttribute('data-mxgraph')!);
      originalCreate(mount);
    };

    renderPreview(el, '<mxfile></mxfile>', { dark: false, page: 2 });

    expect(capturedConfig.page).toBe(2);
    fakeViewer.createViewerForElement = originalCreate;
  });

  it('defaults opts.page to 0 when not passed', () => {
    const el = document.createElement('div');
    patchEl(el);
    let capturedConfig: any = null;
    const originalCreate = fakeViewer.createViewerForElement;
    fakeViewer.createViewerForElement = (mount: HTMLElement) => {
      capturedConfig = JSON.parse(mount.getAttribute('data-mxgraph')!);
      originalCreate(mount);
    };

    renderPreview(el, '<mxfile></mxfile>', { dark: false });

    expect(capturedConfig.page).toBe(0);
    fakeViewer.createViewerForElement = originalCreate;
  });
});
