import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { pinEmbedPage } from '../src/file/pinEmbedPage';

function makeFile(path: string): TFile {
  return Object.assign(new TFile(), { path, basename: path.replace(/\.\w+$/, '') });
}

/** In-memory note + metadata cache with offsets computed from the text. */
function makeApp(notePath: string, noteText: string, target: TFile) {
  const state = { text: noteText };
  const noteFile = makeFile(notePath);
  const embeds = () => {
    const out: { link: string; original: string; position: { start: { offset: number }; end: { offset: number } } }[] = [];
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
  const process = vi.fn((f: TFile, fn: (data: string) => string) => {
    if (f !== noteFile) throw new Error('unexpected file');
    state.text = fn(state.text);
    return Promise.resolve(state.text);
  });
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (p === notePath ? noteFile : null),
      process,
    },
    metadataCache: {
      getCache: (p: string) => (p === notePath ? { embeds: embeds() } : null),
      getFirstLinkpathDest: (path: string) => (path === target.path ? target : null),
    },
  } as unknown as App;
  return { app, state, process };
}

describe('pinEmbedPage', () => {
  const target = makeFile('multi.drawio');

  it('rewrites the single matching link and reports pinned', async () => {
    const { app, state } = makeApp('note.md', 'x ![[multi.drawio]] y', target);
    const outcome = await pinEmbedPage(app, 'note.md', target, undefined, 'Page-2');
    expect(outcome).toBe('pinned');
    expect(state.text).toBe('x ![[multi.drawio#Page-2]] y');
  });

  it('selects by the original subpath among several links to the same file', async () => {
    const { app, state } = makeApp('note.md', '![[multi.drawio]] ![[multi.drawio#Page-2]]', target);
    const outcome = await pinEmbedPage(app, 'note.md', target, 'Page-2', 'Page-3');
    expect(outcome).toBe('pinned');
    expect(state.text).toBe('![[multi.drawio]] ![[multi.drawio#Page-3]]');
  });

  it('leaves the note untouched and reports ambiguous on identical duplicates', async () => {
    const text = '![[multi.drawio]] ![[multi.drawio]]';
    const { app, state } = makeApp('note.md', text, target);
    const outcome = await pinEmbedPage(app, 'note.md', target, undefined, 'Page-2');
    expect(outcome).toBe('ambiguous');
    expect(state.text).toBe(text);
  });

  it('reports no-match when the note has no link to the file', async () => {
    const { app, state } = makeApp('note.md', 'no embeds here', target);
    const outcome = await pinEmbedPage(app, 'note.md', target, undefined, 'Page-2');
    expect(outcome).toBe('no-match');
    expect(state.text).toBe('no embeds here');
  });

  it('reports error without writing when the page name cannot form a link', async () => {
    const { app, state, process } = makeApp('note.md', '![[multi.drawio]]', target);
    const outcome = await pinEmbedPage(app, 'note.md', target, undefined, 'bad|name');
    expect(outcome).toBe('error');
    expect(process).not.toHaveBeenCalled();
    expect(state.text).toBe('![[multi.drawio]]');
  });

  it('reports error when the note file or cache is unavailable', async () => {
    const { app } = makeApp('note.md', '![[multi.drawio]]', target);
    const outcome = await pinEmbedPage(app, 'other.md', target, undefined, 'Page-2');
    expect(outcome).toBe('error');
  });

  it('reports error when the vault write fails', async () => {
    const { app } = makeApp('note.md', '![[multi.drawio]]', target);
    (app.vault.process as unknown as { mockRejectedValue: (e: Error) => void })
      .mockRejectedValue(new Error('disk full'));
    const outcome = await pinEmbedPage(app, 'note.md', target, undefined, 'Page-2');
    expect(outcome).toBe('error');
  });
});
