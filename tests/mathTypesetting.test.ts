import { describe, it, expect, vi, afterEach } from 'vitest';
import * as obsidian from 'obsidian';
import { typesetPreviewMath } from '../src/preview/mathTypesetting';

function preview(text: string, doc = document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const foreign = doc.createElementNS(svg.namespaceURI, 'foreignObject');
  const label = doc.createElement('div');
  label.textContent = text;
  foreign.appendChild(label);
  svg.appendChild(foreign);
  return svg;
}

afterEach(() => vi.restoreAllMocks());

describe('preview mathematical typesetting', () => {
  it('renders draw.io TeX delimiters, preserving surrounding text and dollar amounts', async () => {
    const render = vi.spyOn(obsidian, 'renderMath');
    const finish = vi.spyOn(obsidian, 'finishRenderMath');
    const svg = preview(String.raw`Cost $5; \(x^2\), $$\frac{1}{2}$$ and \[y=3\].`);
    await typesetPreviewMath(svg);
    expect(render.mock.calls).toEqual([['x^2', false], [String.raw`\frac{1}{2}`, true], ['y=3', true]]);
    expect(svg.querySelectorAll('mjx-container')).toHaveLength(3);
    expect(svg.textContent).toContain('Cost $5;');
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('does not load math for ordinary labels or typeset already-rendered formulas again', async () => {
    const load = vi.spyOn(obsidian, 'loadMathJax');
    const svg = preview('plain text and $20');
    await typesetPreviewMath(svg);
    expect(load).not.toHaveBeenCalled();
    const math = preview(String.raw`\(x\)`);
    await typesetPreviewMath(math);
    await typesetPreviewMath(math);
    expect(math.querySelectorAll('mjx-container')).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('waits for the engine without replacing a newer preview', async () => {
    let ready!: () => void;
    vi.spyOn(obsidian, 'loadMathJax').mockImplementation(() => new Promise<void>((r) => { ready = r; }));
    const host = document.createElement('div');
    const old = preview('$$x$$');
    host.appendChild(old);
    const pending = typesetPreviewMath(old);
    const current = preview('new page');
    host.replaceChildren(current);
    ready();
    await pending;
    expect(host.firstChild).toBe(current);
    expect(host.textContent).toBe('new page');
  });

  it('sanitizes math output and imports it into the preview document', async () => {
    const foreignDoc = document.implementation.createHTMLDocument('popout');
    vi.spyOn(obsidian, 'renderMath').mockImplementation(() => {
      const result = document.createElement('span');
      result.innerHTML = '<svg onload="alert(1)"><a href="javascript:alert(1)"><path d="M0 0L1 1"/></a></svg>';
      return result;
    });
    const svg = preview('$$x$$', foreignDoc);
    await typesetPreviewMath(svg);
    expect(svg.querySelector('path')?.ownerDocument).toBe(foreignDoc);
    expect(svg.querySelector('[onload]')).toBeNull();
    expect(svg.querySelector('[href]')).toBeNull();
  });

  it('keeps a failed formula readable while rendering the other formulas', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(obsidian, 'renderMath').mockImplementationOnce(() => { throw new Error('Bad TeX'); });
    const svg = preview('$$bad$$ and $$good$$');
    await typesetPreviewMath(svg);
    expect(svg.textContent).toBe('$$bad$$ and good');
    expect(svg.querySelectorAll('mjx-container')).toHaveLength(1);
  });
});
