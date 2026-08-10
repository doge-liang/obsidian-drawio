import { describe, it, expect, vi } from 'vitest';

// Stub viewer: renderPreview degrades to an error placeholder, but the page
// control (the subject here) renders regardless.
vi.mock('../src/preview/viewer.min.txt', () => ({ default: 'window.GraphViewer = window.GraphViewer || undefined;' }));

import { TFile } from 'obsidian';
import { registerDrawioEmbeds } from '../src/file/EmbedRenderer';
import type DrawioPlugin from '../src/main';

const XML = '<mxfile pages="2">'
  + '<diagram id="p1" name="Page-1"><mxGraphModel/></diagram>'
  + '<diagram id="p2" name="Page-2"><mxGraphModel/></diagram>'
  + '</mxfile>';

type Creator = (
  ctx: { containerEl: HTMLElement; sourcePath?: string },
  file: TFile,
  subpath?: string,
) => { loadFile: () => Promise<void> };

type PostProcessor = (
  el: HTMLElement,
  ctx: { sourcePath: string; addChild: (child: unknown) => void },
) => void;

// `registry: false` omits the embedRegistry so registerDrawioEmbeds falls
// back to the reading-view post-processor (exercised in the fallback suite).
function makeHarness(noteText: string, opts: { registry: boolean } = { registry: true }) {
  const target = Object.assign(new TFile(), { path: 'multi.drawio', basename: 'multi' });
  const noteFile = Object.assign(new TFile(), { path: 'note.md', basename: 'note' });
  const state = { text: noteText };
  const embeds = () => {
    const out: unknown[] = [];
    const re = /!\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(state.text))) {
      out.push({
        link: m[1]!.split('|')[0]!,
        original: m[0],
        position: { start: { offset: m.index }, end: { offset: m.index + m[0].length } },
      });
    }
    return out;
  };
  let creator: Creator | undefined;
  let postProcessor: PostProcessor | undefined;
  const plugin = {
    settings: { previewClickAction: 'editor' },
    previewOpts: () => ({ dark: false }),
    registerMarkdownPostProcessor: (fn: PostProcessor) => { postProcessor = fn; },
    app: {
      ...(opts.registry
        ? { embedRegistry: { registerExtension: (_e: string, c: Creator) => { creator = c; } } }
        : {}),
      vault: {
        read: () => Promise.resolve(XML),
        on: () => ({}),
        getAbstractFileByPath: (p: string) => (p === 'note.md' ? noteFile : null),
        process: (f: TFile, fn: (d: string) => string) => {
          if (f !== noteFile) throw new Error('unexpected file');
          state.text = fn(state.text);
          return Promise.resolve(state.text);
        },
      },
      metadataCache: {
        getCache: (p: string) => (p === 'note.md' ? { embeds: embeds() } : null),
        getFirstLinkpathDest: (path: string) => (path === 'multi.drawio' ? target : null),
      },
    },
    register: () => {},
    openEditor: () => {},
  } as unknown as DrawioPlugin;
  registerDrawioEmbeds(plugin);
  return { creator, postProcessor, target, state };
}

async function tick(): Promise<void> {
  await new Promise((r) => { window.setTimeout(r, 0); });
}

describe('embed pin wiring (registry path)', () => {
  it('pins the flipped page back into the note link', async () => {
    const { creator, target, state } = makeHarness('x ![[multi.drawio]] y');
    const el = document.body.createDiv();
    const embed = creator!({ containerEl: el, sourcePath: 'note.md' }, target, undefined);
    await embed.loadFile();

    const pin = el.querySelector<HTMLButtonElement>('.drawio-pin')!;
    expect(pin).not.toBeNull();
    expect(pin.disabled).toBe(true); // shown page == linked page

    const [, next] = Array.from(el.querySelectorAll<HTMLButtonElement>('.drawio-page-control button'));
    next!.click();
    expect(pin.disabled).toBe(false);
    pin.click();
    await tick();
    expect(state.text).toBe('x ![[multi.drawio#Page-2]] y');
  });

  it('offers no pin button when Obsidian gave the creator no sourcePath', async () => {
    const { creator, target } = makeHarness('x ![[multi.drawio]] y');
    const el = document.body.createDiv();
    const embed = creator!({ containerEl: el }, target, undefined);
    await embed.loadFile();
    expect(el.querySelector('.drawio-page-control')).not.toBeNull();
    expect(el.querySelector('.drawio-pin')).toBeNull();
  });
});

describe('embed pin wiring (post-processor fallback path)', () => {
  it('pins through the fallback renderer too', async () => {
    const { postProcessor, state } = makeHarness('a ![[multi.drawio]] b', { registry: false });
    const section = document.body.createDiv();
    const span = section.createSpan({ cls: 'internal-embed' });
    span.setAttribute('src', 'multi.drawio');
    postProcessor!(section, { sourcePath: 'note.md', addChild: () => {} });
    await tick();

    const [, next] = Array.from(span.querySelectorAll<HTMLButtonElement>('.drawio-page-control button'));
    next!.click();
    const pin = span.querySelector<HTMLButtonElement>('.drawio-pin')!;
    pin.click();
    await tick();
    expect(state.text).toBe('a ![[multi.drawio#Page-2]] b');
  });
});
