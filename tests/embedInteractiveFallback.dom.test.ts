import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/preview/viewer.min.txt', () => ({
  default: 'window.GraphViewer = window.GraphViewer || undefined;',
}));
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

import { TFile } from 'obsidian';
import { registerDrawioEmbeds } from '../src/file/EmbedRenderer';
import type DrawioPlugin from '../src/main';

const XML = '<mxfile>' +
  '<diagram id="0" name="Page-1"><mxGraphModel/></diagram>' +
  '<diagram id="1" name="Page-2"><mxGraphModel/></diagram>' +
  '</mxfile>';

type Processor = (
  el: HTMLElement,
  ctx: { sourcePath: string; addChild: (child: unknown) => void },
) => void;

function harness() {
  let processor: Processor | undefined;
  const openEditor = vi.fn();
  const file = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
  const plugin = {
    settings: { previewClickAction: 'interactive', editButtonAction: 'editor' },
    previewOpts: () => ({ dark: false }),
    app: {
      vault: { read: () => Promise.resolve(XML), on: vi.fn(() => ({})) },
      metadataCache: { getFirstLinkpathDest: () => file },
    },
    registerMarkdownPostProcessor: (fn: Processor) => { processor = fn; },
    openEditor,
  } as unknown as DrawioPlugin;
  registerDrawioEmbeds(plugin);
  return { processor: () => processor!, openEditor };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => { window.setTimeout(resolve, 0); });
}

describe('interactive embed fallback renderer', () => {
  it('mounts the controller, routes Edit, and rebinds page changes', async () => {
    const { processor, openEditor } = harness();
    const section = document.body.createDiv();
    const span = section.createSpan({ cls: 'internal-embed' });
    span.setAttribute('src', 'diagram.drawio');
    const addChild = vi.fn();
    processor()(section, { sourcePath: 'note.md', addChild });
    await tick();

    const preview = span.querySelector<HTMLElement>('.drawio-preview')!;
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(span.classList.contains('drawio-interactive-active')).toBe(true);
    expect(span.querySelector('.drawio-interactive-toolbar')).not.toBeNull();
    expect(addChild).toHaveBeenCalledTimes(1);
    span.querySelector<HTMLButtonElement>('[aria-label="Edit diagram"]')!.click();
    expect(openEditor).toHaveBeenCalledTimes(1);

    span.querySelectorAll<HTMLButtonElement>('.drawio-page-control button')[1]!.click();
    expect(preview.querySelector<SVGSVGElement>('svg')!.dataset.page).toBe('1');
    expect(preview.querySelector('svg')!.classList.contains('drawio-interactive-svg')).toBe(true);
    expect(span.classList.contains('drawio-interactive-active')).toBe(false);
  });
});
