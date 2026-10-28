import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const hasAssets = existsSync(join(process.cwd(), 'src/preview/viewer.min.txt')) &&
  existsSync(join(process.cwd(), 'src/preview/stencils.generated.txt'));

vi.mock('../src/preview/viewer.min.txt', async () => {
  const { readFileSync } = await import('node:fs');
  const { sanitizeViewerSource } = await import('../scripts/sanitize-viewer.mjs');
  return { default: sanitizeViewerSource(readFileSync('src/preview/viewer.min.txt', 'utf8')) };
});
// Exercise the actual generated data, not a hand-maintained subset.
vi.mock('../src/preview/stencils.generated.txt', () => ({
  default: readFileSync('src/preview/stencils.generated.txt', 'utf8'),
}));

import { ensureViewerLoaded } from '../src/preview/loadViewer';
import { renderPreview } from '../src/preview/ViewerRenderer';
import * as math from '../src/preview/mathTypesetting';
import { deflateSync, strToU8 } from 'fflate';

describe.skipIf(!hasAssets)('bundled offline library stencils', () => {
  it('renders the reported Office key icon as paths without requesting any resources', () => {
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {
      throw new Error('Preview attempted network access');
    });
    const script = vi.spyOn(document, 'createElement');
    const el = document.body.createDiv();
    const xml = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/>' +
      '<mxCell id="1" parent="0"/><mxCell id="2" parent="1" vertex="1" ' +
      'style="shape=mxgraph.office.security.key_permissions;fillColor=#ff0000;">' +
      '<mxGeometry x="0" y="0" width="80" height="80" as="geometry"/>' +
      '</mxCell></root></mxGraphModel></diagram></mxfile>';
    expect(renderPreview(el, xml, { dark: false })).toBe(true);
    expect(el.querySelectorAll('svg path').length).toBeGreaterThan(0);
    expect(el.querySelector('path[fill="#ff0000"]')).not.toBeNull();
    expect(xhr).not.toHaveBeenCalled();
    expect(script.mock.calls.some(([name]) => name === 'script')).toBe(false);
    xhr.mockRestore();
    script.mockRestore();
  });

  it('loads once per library and never fetches unknown stencils', () => {
    ensureViewerLoaded(document);
    const registry = (window as any).mxStencilRegistry;
    const parse = vi.spyOn(registry, 'parseStencilSet');
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
    expect(registry.getStencil('mxgraph.cisco.security.firewall')).toBeTruthy();
    const count = parse.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    expect(registry.getStencil('mxgraph.cisco.security.firewall')).toBeTruthy();
    expect(parse).toHaveBeenCalledTimes(count);
    expect(registry.getStencil('mxgraph.nonexistent.no_such_shape')).toBeFalsy();
    expect(registry.loadStencil('https://example.com/untrusted.xml')).toBeNull();
    expect(xhr).not.toHaveBeenCalled();
    expect(registry.dynamicLoading).toBe(false);
    expect(registry.allowEval).toBe(false);
    parse.mockRestore();
    xhr.mockRestore();
  });

  it('uses the selected page math flag, including compressed diagrams', () => {
    const typeset = vi.spyOn(math, 'typesetPreviewMath').mockResolvedValue();
    const model = (enabled: number) => `<mxGraphModel math="${enabled}"><root>` +
      '<mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" vertex="1" ' +
      'value="$$x^2$$" style="html=1;whiteSpace=wrap;">' +
      '<mxGeometry x="0" y="0" width="120" height="80" as="geometry"/>' +
      '</mxCell></root></mxGraphModel>';
    const compressed = btoa(String.fromCharCode(...deflateSync(strToU8(encodeURIComponent(model(1))))));
    const xml = `<mxfile><diagram name="Off">${model(0)}</diagram><diagram name="On">${compressed}</diagram></mxfile>`;
    const el = document.body.createDiv();
    renderPreview(el, xml, { dark: false, page: 0 });
    expect(typeset).not.toHaveBeenCalled();
    renderPreview(el, xml, { dark: false, page: 1 });
    expect(typeset).toHaveBeenCalledTimes(1);
    expect(typeset.mock.calls[0]![0]).toBe(el.querySelector('svg'));
    renderPreview(el, xml, { dark: false, page: 0 });
    expect(typeset).toHaveBeenCalledTimes(1);
    typeset.mockRestore();
  });
});
