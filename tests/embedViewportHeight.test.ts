import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import {
  readEmbedViewportHeight, writeEmbedViewportHeight,
} from '../src/preview/embedViewportHeight';
import type { App, MarkdownPostProcessorContext } from 'obsidian';

function harness(text: string, links: Array<{ link: string; original: string; offset: number }>) {
  const state = { text };
  const note = Object.assign(new TFile(), { path: 'note.md', basename: 'note' });
  const target = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => path === note.path ? note : null,
      cachedRead: () => Promise.resolve(state.text),
      process: (_file: TFile, fn: (data: string) => string) => {
        state.text = fn(state.text);
        return Promise.resolve(state.text);
      },
    },
    metadataCache: {
      getCache: () => ({
        embeds: links.map((item) => ({
          link: item.link,
          original: item.original,
          position: {
            start: { offset: item.offset },
            end: { offset: item.offset + item.original.length },
          },
        })),
      }),
      getFirstLinkpathDest: () => target,
    },
  } as unknown as App;
  return { app, note, target, state };
}

describe('embed viewport height Markdown metadata', () => {
  it('reads and updates the comment without changing subpath or alias', async () => {
    const embed = '![[diagram.drawio#Page-2|Architecture]]';
    const text = `<!-- drawio-viewer: height=320 -->\n${embed}`;
    const { app, target, state } = harness(text, [{ link: 'diagram.drawio#Page-2', original: embed, offset: 43 }]);
    expect(await readEmbedViewportHeight(app, 'note.md', target, '#Page-2')).toBe(320);
    expect(await writeEmbedViewportHeight(app, 'note.md', target, '#Page-2', 540)).toBe('written');
    expect(state.text).toBe(`<!-- drawio-viewer: height=540 -->\n${embed}`);
  });

  it('keeps two pages of the same file independent', async () => {
    const first = '![[diagram.drawio#Page-1]]';
    const second = '![[diagram.drawio#Page-2]]';
    const text = `${first}\n${second}`;
    const { app, target, state } = harness(text, [
      { link: 'diagram.drawio#Page-1', original: first, offset: 0 },
      { link: 'diagram.drawio#Page-2', original: second, offset: first.length + 1 },
    ]);
    expect(await writeEmbedViewportHeight(app, 'note.md', target, '#Page-2', 600)).toBe('written');
    expect(state.text).toBe(`${first}\n<!-- drawio-viewer: height=600 -->\n${second}`);
  });

  it('uses the original wikilink subpath when the metadata link omits it', async () => {
    const first = '![[diagram.drawio#Page-1]]';
    const second = '![[diagram.drawio#Page-2]]';
    const text = `${first}\n${second}`;
    const { app, target, state } = harness(text, [
      { link: 'diagram.drawio', original: first, offset: 0 },
      { link: 'diagram.drawio', original: second, offset: first.length + 1 },
    ]);
    expect(await writeEmbedViewportHeight(app, 'note.md', target, '#Page-2', 620)).toBe('written');
    expect(state.text).toBe(`${first}\n<!-- drawio-viewer: height=620 -->\n${second}`);
  });

  it('refuses to guess between identical duplicate embeds', async () => {
    const embed = '![[diagram.drawio]]';
    const text = `${embed}\n${embed}`;
    const { app, target, state } = harness(text, [
      { link: 'diagram.drawio', original: embed, offset: 0 },
      { link: 'diagram.drawio', original: embed, offset: embed.length + 1 },
    ]);
    expect(await writeEmbedViewportHeight(app, 'note.md', target, undefined, 700)).toBe('ambiguous');
    expect(state.text).toBe(text);
  });

  it('writes the selected occurrence when the render surface identifies it', async () => {
    const embed = '![[diagram.drawio#Page-1]]';
    const text = `${embed}\nbetween\n${embed}`;
    const secondOffset = text.lastIndexOf(embed);
    const { app, target, state } = harness(text, [
      { link: 'diagram.drawio', original: embed, offset: 0 },
      { link: 'diagram.drawio', original: embed, offset: secondOffset },
    ]);
    expect(await writeEmbedViewportHeight(
      app, 'note.md', target, '#Page-1', 680, undefined, undefined, 1,
    )).toBe('written');
    expect(state.text).toBe(`${embed}\nbetween\n<!-- drawio-viewer: height=680 -->\n${embed}`);
  });

  it('uses the Live Preview source offset before the DOM occurrence fallback', async () => {
    const embed = '![[diagram.drawio#Page-1]]';
    const text = `${embed}\nbetween\n${embed}`;
    const secondOffset = text.lastIndexOf(embed);
    const { app, target, state } = harness(text, [
      { link: 'diagram.drawio', original: embed, offset: 0 },
      { link: 'diagram.drawio', original: embed, offset: secondOffset },
    ]);
    expect(await writeEmbedViewportHeight(
      app, 'note.md', target, '#Page-1', 720,
      undefined, undefined, 0, secondOffset + 1,
    )).toBe('written');
    expect(state.text).toBe(`${embed}\nbetween\n<!-- drawio-viewer: height=720 -->\n${embed}`);
  });

  it('uses section info to distinguish identical embeds in Reading view', async () => {
    const embed = '![[diagram.drawio]]';
    const text = `before\n${embed}\nbetween\n${embed}\nafter`;
    const secondOffset = text.lastIndexOf(embed);
    const { app, target, state } = harness(text, [
      { link: 'diagram.drawio', original: embed, offset: text.indexOf(embed) },
      { link: 'diagram.drawio', original: embed, offset: secondOffset },
    ]);
    const el = document.createElement('span');
    const ctx = {
      getSectionInfo: vi.fn(() => ({ lineStart: 3, lineEnd: 3 })),
    } as unknown as MarkdownPostProcessorContext;
    expect(await writeEmbedViewportHeight(
      app, 'note.md', target, undefined, 760, ctx, el,
    )).toBe('written');
    expect(state.text).toBe(`before\n${embed}\nbetween\n<!-- drawio-viewer: height=760 -->\n${embed}\nafter`);
  });
});
