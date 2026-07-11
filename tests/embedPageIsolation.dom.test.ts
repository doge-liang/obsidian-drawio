import { describe, it, expect, vi, beforeEach } from 'vitest';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Load the REAL vendored viewer (not the usual stub): this suite is a
// regression guard for cross-preview page-state leaks, and the leak surface
// under suspicion (GraphViewer's window-global `urlParams.page` handshake)
// only exists in the real viewer. Needs `npm run fetch-drawio` first (same
// prerequisite as a build); without it the suite skips instead of failing.
const VIEWER_PATH = join(process.cwd(), 'src/preview/viewer.min.txt');
const hasViewer = existsSync(VIEWER_PATH);

vi.mock('../src/preview/viewer.min.txt', async () => {
  const { existsSync: exists, readFileSync: read } = await import('node:fs');
  const { join: joinPath } = await import('node:path');
  const p = joinPath(process.cwd(), 'src/preview/viewer.min.txt');
  return { default: exists(p) ? read(p, 'utf8') : '' };
});

import { registerDrawioEmbeds } from '../src/file/EmbedRenderer';
import { __resetViewerForTests } from '../src/preview/loadViewer';
import { TFile } from 'obsidian';
import type DrawioPlugin from '../src/main';

// ---- fixtures: two distinct 2-page diagrams with unmistakable page labels ----

// jsdom can't measure text (no canvas), so labels don't survive the render.
// Pages are told apart by shape geometry instead: page 1 draws a 160-wide
// rect, page 2 a 320-wide one — widths GraphViewer reproduces faithfully.
const PAGE_WIDTHS = { PAGE1: '160', PAGE2: '320' } as const;

function mxfile(prefix: string): string {
  const model = (width: string) =>
    `<mxGraphModel dx="800" dy="600"><root>` +
    `<mxCell id="0"/><mxCell id="1" parent="0"/>` +
    `<mxCell id="2" style="rounded=0;whiteSpace=wrap;html=1" vertex="1" parent="1">` +
    `<mxGeometry x="40" y="40" width="${width}" height="60" as="geometry"/></mxCell>` +
    `</root></mxGraphModel>`;
  return `<mxfile pages="2">` +
    `<diagram name="Page-1" id="${prefix}1">${model(PAGE_WIDTHS.PAGE1)}</diagram>` +
    `<diagram name="Page-2" id="${prefix}2">${model(PAGE_WIDTHS.PAGE2)}</diagram>` +
    `</mxfile>`;
}

function makeFile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.basename = path.replace(/\.drawio$/, '');
  f.extension = 'drawio';
  return f;
}

type EmbedCreator = (
  ctx: { containerEl: HTMLElement },
  file: TFile,
  subpath?: string,
) => { loadFile(file?: TFile): Promise<void> };

function makePluginStub(contents: Map<string, string>): DrawioPlugin {
  return {
    settings: { previewClickAction: 'editor' },
    previewOpts: () => ({ dark: false }),
    app: {
      vault: {
        read: (f: TFile) => Promise.resolve(contents.get(f.path) ?? ''),
        on: () => ({}),
      },
    },
    register: () => {},
    openEditor: () => {},
  } as unknown as DrawioPlugin;
}

/** Register the embeds against a captured fake registry and hand back the creator. */
function captureEmbedCreator(plugin: DrawioPlugin): EmbedCreator {
  let creator: EmbedCreator | undefined;
  (plugin.app as unknown as Record<string, unknown>).embedRegistry = {
    registerExtension: (_ext: string, c: EmbedCreator) => { creator = c; },
    unregisterExtension: () => {},
  };
  registerDrawioEmbeds(plugin);
  if (!creator) throw new Error('embed creator was not registered');
  return creator;
}

function indicatorOf(el: HTMLElement): string {
  return el.querySelector('.drawio-page-control span')?.textContent ?? '(none)';
}

function nextButtonOf(el: HTMLElement): HTMLButtonElement {
  const btns = el.querySelectorAll<HTMLButtonElement>('.drawio-page-control button');
  return btns[1]!;
}

function prevButtonOf(el: HTMLElement): HTMLButtonElement {
  const btns = el.querySelectorAll<HTMLButtonElement>('.drawio-page-control button');
  return btns[0]!;
}

function shownPage(el: HTMLElement): string {
  const w = el.querySelector('.drawio-preview rect')?.getAttribute('width');
  if (w === PAGE_WIDTHS.PAGE1) return 'PAGE1';
  if (w === PAGE_WIDTHS.PAGE2) return 'PAGE2';
  return `NONE(${w ?? 'no rect'})`;
}

beforeEach(() => {
  __resetViewerForTests();
  document.body.innerHTML = '';
});

// Mirrors the real-world repro note: two multi-page embeds of two different
// files, the second targeting its second page via a #Page-2 subpath. Flipping
// one embed's page must not move any other embed — page state is strictly
// per-embed (a first-flip in a note once appeared to advance every pageable
// preview at once).
describe.skipIf(!hasViewer)('embed page-flip isolation', () => {
  it('keeps each embed on its own page when another embed flips', async () => {
    const fileA = makeFile('multipage-a.drawio');
    const fileB = makeFile('multipage-b.drawio');
    const plugin = makePluginStub(new Map([
      [fileA.path, mxfile('A')],
      [fileB.path, mxfile('B')],
    ]));
    const creator = captureEmbedCreator(plugin);

    const elA = document.body.createDiv();
    const elB = document.body.createDiv();
    const embedA = creator({ containerEl: elA }, fileA, undefined);
    const embedB = creator({ containerEl: elB }, fileB, '#Page-2');
    await embedA.loadFile();
    await embedB.loadFile();

    // Initial state: A on its first page, B resolved to page 2 via subpath.
    expect(shownPage(elA)).toBe('PAGE1');
    expect(indicatorOf(elA)).toBe('1 / 2');
    expect(shownPage(elB)).toBe('PAGE2');
    expect(indicatorOf(elB)).toBe('2 / 2');

    // Flip A forward: only A moves.
    nextButtonOf(elA).click();
    expect(shownPage(elA)).toBe('PAGE2');
    expect(indicatorOf(elA)).toBe('2 / 2');
    expect(shownPage(elB)).toBe('PAGE2');
    expect(indicatorOf(elB)).toBe('2 / 2');

    // Flip B back: only B moves, A keeps its flipped page.
    prevButtonOf(elB).click();
    expect(shownPage(elB)).toBe('PAGE1');
    expect(indicatorOf(elB)).toBe('1 / 2');
    expect(shownPage(elA)).toBe('PAGE2');
    expect(indicatorOf(elA)).toBe('2 / 2');
  });

  it('re-renders (e.g. after a file modify) keep their own page, not the last flipped one', async () => {
    const fileA = makeFile('multipage-a.drawio');
    const fileB = makeFile('multipage-b.drawio');
    const plugin = makePluginStub(new Map([
      [fileA.path, mxfile('A')],
      [fileB.path, mxfile('B')],
    ]));
    const creator = captureEmbedCreator(plugin);

    const elA = document.body.createDiv();
    const elB = document.body.createDiv();
    const embedA = creator({ containerEl: elA }, fileA, undefined);
    const embedB = creator({ containerEl: elB }, fileB, undefined);
    await embedA.loadFile();
    await embedB.loadFile();

    // A flips to page 2, leaving the viewer's window-global page cursor at 1.
    nextButtonOf(elA).click();
    expect(shownPage(elA)).toBe('PAGE2');

    // B re-renders (same path Obsidian takes on vault modify): it must come
    // back on ITS page (1), not inherit A's page from any global.
    await embedB.loadFile();
    expect(shownPage(elB)).toBe('PAGE1');
    expect(indicatorOf(elB)).toBe('1 / 2');
  });

  it('leaves no page cursor behind in the viewer\'s window-global urlParams', async () => {
    const fileA = makeFile('multipage-a.drawio');
    const plugin = makePluginStub(new Map([[fileA.path, mxfile('A')]]));
    const creator = captureEmbedCreator(plugin);

    const elA = document.body.createDiv();
    const embedA = creator({ containerEl: elA }, fileA, undefined);
    await embedA.loadFile();
    nextButtonOf(elA).click();
    expect(shownPage(elA)).toBe('PAGE2');

    // GraphViewer's init writes the instance page into the window-global
    // urlParams.page (its internal mxfile page-selection handshake). Leaving
    // "1" behind would steer any later mxfile parse in this window that
    // doesn't set a page first — renderPreview must restore it.
    const urlParams = (window as unknown as { urlParams?: { page?: unknown } }).urlParams;
    expect(urlParams?.page ?? 0).toBe(0);
  });
});
