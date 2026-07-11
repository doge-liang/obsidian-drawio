import { describe, it, expect, vi } from 'vitest';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Real vendored viewer (not the stub): the behavior under test is its
// self-executing bootstrap, which the stub doesn't have. Needs
// `npm run fetch-drawio` first (same prerequisite as a build); without it
// the suite skips instead of failing.
const hasViewer = existsSync(join(process.cwd(), 'src/preview/viewer.min.txt'));

vi.mock('../src/preview/viewer.min.txt', async () => {
  const { existsSync: exists, readFileSync: read } = await import('node:fs');
  const { join: joinPath } = await import('node:path');
  const p = joinPath(process.cwd(), 'src/preview/viewer.min.txt');
  return { default: exists(p) ? read(p, 'utf8') : '' };
});

import { ensureViewerLoaded } from '../src/preview/loadViewer';

// viewer.min.js ends with a self-executing bootstrap: unless the page defines
// `window.onDrawioViewerLoad`, it calls GraphViewer.processElements(), which
// scans the WHOLE document for `.mxgraph` elements, wipes each (innerText='')
// and instantiates a viewer on it. Loading the viewer must never touch mounts
// it didn't create — renderPreview drives each mount itself.
describe.skipIf(!hasViewer)('viewer load bootstrap', () => {
  it('disables the document-wide .mxgraph auto-scan via onDrawioViewerLoad', () => {
    const foreign = document.body.createDiv({ cls: 'mxgraph' });
    foreign.setAttribute('data-mxgraph', JSON.stringify({
      xml: '<mxfile><diagram id="d1" name="Page-1"><mxGraphModel><root>'
        + '<mxCell id="0"/><mxCell id="1" parent="0"/>'
        + '</root></mxGraphModel></diagram></mxfile>',
    }));
    foreign.createSpan({ text: 'placeholder' });

    ensureViewerLoaded(document);

    // The bootstrap's escape hatch must be armed BEFORE the eval, or the
    // scan has already run. (jsdom can't observe the scan's DOM damage —
    // innerText is unimplemented and the viewer instantiation throws — so
    // assert the contract: hook defined ⇒ processElements() not called.)
    const hook = (window as unknown as { onDrawioViewerLoad?: unknown }).onDrawioViewerLoad;
    expect(typeof hook).toBe('function');

    // Belt and braces: the foreign mount is still intact.
    expect(foreign.querySelector('svg')).toBeNull();
    expect(foreign.textContent).toBe('placeholder');
  });
});
