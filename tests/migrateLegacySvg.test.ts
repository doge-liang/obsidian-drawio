import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { buildInitialSvg } from '../src/model/dualFormat';
import {
  countReferencesToFile, migrateLegacyDrawioSvgs, scanLegacyDrawioSvgs,
} from '../src/desktop/migrateLegacySvg';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  f.extension = dot < 0 ? '' : name.slice(dot + 1);
  f.basename = dot < 0 ? name : name.slice(0, dot);
  return f;
}

const MXFILE = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>';

function fakeApp(opts: {
  files: { file: TFile; body?: string }[];
  markdown?: { path: string; embeds?: { link: string }[]; links?: { link: string }[] }[];
  rename?: (file: TFile, dest: string) => Promise<void>;
}) {
  const files = opts.files.map((e) => e.file);
  const bodies = new Map(opts.files.map((e) => [e.file.path, e.body ?? '']));
  const markdown = opts.markdown ?? [];
  const rename = opts.rename ?? (async (file, dest) => { file.path = dest; });
  return {
    vault: {
      getFiles: () => files.slice(),
      getMarkdownFiles: () => markdown.map((m) => tfile(m.path)),
      getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null,
      cachedRead: async (file: TFile) => bodies.get(file.path) ?? '',
    },
    metadataCache: {
      getCache: (path: string) => {
        const md = markdown.find((m) => m.path === path);
        return md ? { embeds: md.embeds ?? [], links: md.links ?? [] } : null;
      },
      getFirstLinkpathDest: (linkpath: string, _source: string) =>
        files.find((f) => f.path === linkpath || f.path.endsWith(`/${linkpath}`)) ?? null,
    },
    fileManager: { renameFile: rename },
  };
}

describe('countReferencesToFile', () => {
  it('counts embeds and links that resolve to the file', () => {
    const svg = tfile('dia.svg');
    const app = fakeApp({
      files: [{ file: svg }],
      markdown: [
        { path: 'a.md', embeds: [{ link: 'dia.svg' }, { link: 'other.svg' }] },
        { path: 'b.md', links: [{ link: 'dia.svg#Page-1' }] },
      ],
    });
    expect(countReferencesToFile(app as never, svg)).toBe(2);
  });
});

describe('scanLegacyDrawioSvgs', () => {
  it('lists only plain svgs whose content is drawio XML', async () => {
    const legacy = tfile('Untitled Diagram.svg');
    const dual = tfile('already.drawio.svg');
    const picture = tfile('logo.svg');
    const app = fakeApp({
      files: [
        { file: legacy, body: buildInitialSvg(MXFILE) },
        { file: dual, body: buildInitialSvg(MXFILE) },
        { file: picture, body: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      ],
    });
    const items = await scanLegacyDrawioSvgs(app as never);
    expect(items.map((i) => i.from)).toEqual(['Untitled Diagram.svg']);
    expect(items[0]?.to).toBe('Untitled Diagram.drawio.svg');
  });

  it('numbers the target when the preferred name is already taken', async () => {
    const legacy = tfile('a.svg');
    const taken = tfile('a.drawio.svg');
    const app = fakeApp({
      files: [
        { file: legacy, body: buildInitialSvg(MXFILE) },
        { file: taken, body: buildInitialSvg(MXFILE) },
      ],
    });
    const items = await scanLegacyDrawioSvgs(app as never);
    expect(items[0]?.to).toBe('a 2.drawio.svg');
  });
});

describe('migrateLegacyDrawioSvgs', () => {
  it('renames each file and continues after a single failure', async () => {
    const one = tfile('one.svg');
    const two = tfile('two.svg');
    const rename = vi.fn(async (file: TFile, dest: string) => {
      if (file.path === 'one.svg') throw new Error('locked');
      file.path = dest;
    });
    const app = fakeApp({
      files: [
        { file: one, body: buildInitialSvg(MXFILE) },
        { file: two, body: buildInitialSvg(MXFILE) },
      ],
      rename,
    });
    const items = await scanLegacyDrawioSvgs(app as never);
    const result = await migrateLegacyDrawioSvgs(app as never, items);
    expect(result.renamed).toEqual(['two.drawio.svg']);
    expect(result.failed).toEqual([{ path: 'one.svg', message: 'locked' }]);
    expect(rename).toHaveBeenCalledTimes(2);
  });
});
